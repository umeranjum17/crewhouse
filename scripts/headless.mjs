// Headless Linux host; the kit may own the unit (setup --headless --install-only, then this runner).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIPv4 } from 'node:net';
import { tailscaleState } from '@byokit/reach';
import { keyPairFrom } from '@byokit/pair';
import { qrText } from '@byokit/ui-core/link';
import { loadConfig } from '../src/config.ts';
import { startRelay } from '../relay/main.ts';

const cfg = loadConfig(), repo = cfg.repoDir, relayPort = Number(process.env.CREWHOUSE_RELAY_PORT || 7300), publicRelay = process.env.CREWHOUSE_RELAY_PUBLIC;
const pause = () => new Promise(r => setTimeout(r, 100));
async function tailnet() {
  if (publicRelay) {
    const u = new URL(publicRelay);
    if (!/^(https?|wss?):$/.test(u.protocol) || !isIPv4(u.hostname) || !/^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|127\.)/.test(u.hostname) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('CREWHOUSE_RELAY_PUBLIC needs a tailnet or loopback relay origin, without credentials or a path.');
    return '0.0.0.0'; // operator-owned port publication; no Tailscale discovery in the container
  }
  const s = await tailscaleState({ timeoutMs: 5000 });
  const ip = s.ips.find(isIPv4);
  if (s.backendState !== 'Running' || s.reason || !ip || (s.keyExpiry && Date.parse(s.keyExpiry) <= Date.now())) throw new Error(s.reason || 'Sign in to Tailscale on this machine first.');
  return ip;
}
async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(`http://127.0.0.1:${cfg.port}/api/${path}`, { method, signal: AbortSignal.timeout(5000),
    headers: { 'x-crewhouse': '1', 'content-type': 'application/json', authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}` }, body: body && JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Crewhouse returned HTTP ${r.status}`);
  return data;
}
async function ready(check, child) {
  let cause;
  for (const end = Date.now() + 180000; Date.now() < end; await pause()) {
    if (child && (!child.pid || child.exitCode !== null)) throw new Error(`crewd could not run (${child.exitCode}); see the service log.`);
    try { const result = await check(); if (result) return result; } catch (e) { cause = e; }
  }
  throw new Error(`Crewhouse did not become ready: ${cause?.message || 'phone link not ready'}`);
}
async function health() {
  const ip = await tailnet(), state = await api('state'), link = await api('phones/link');
  const relay = await fetch(`http://${publicRelay ? '127.0.0.1' : ip}:${relayPort}/health`, { signal: AbortSignal.timeout(5000) });
  return !!state.person && (publicRelay ? link.hosts.length === 0 : link.hosts.includes(ip) && link.hosts.includes('127.0.0.1') && link.hosts.length === 2) && link.relayStatus === 'online' && relay.ok;
}
async function pair() {
  await ready(health);
  const offer = await api('phones/pair', { role: 'control', first: true });
  console.log(`Pairing code: ${offer.typed}\nWorks once; expires ${new Date(offer.expires).toISOString()}. Keep it private.\n${qrText(offer.qr)}`);
}
async function serve() {
  const ip = await tailnet();
  const relay = await startRelay({ host: ip, port: relayPort, dataDir: join(cfg.stateDir, 'relay') });
  const child = spawn(process.execPath, ['src/main.ts'], { cwd: repo, stdio: 'inherit', env: { ...process.env,
    CREWHOUSE_HEADLESS: '1', CREWHOUSE_HOST: '127.0.0.1', CREWHOUSE_LINK_HOST: `127.0.0.1,${ip}`, CREWHOUSE_LINK_PORT: publicRelay ? '0' : String(cfg.linkPort), CREWHOUSE_RELAY: relay.url, CREWHOUSE_FIRST_USE_TOOLS: '1' } });
  const exited = new Promise(r => { child.once('exit', r); child.once('error', e => { console.error(e.message); r(1); }); });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    await ready(() => api('state'), child);
    const keys = keyPairFrom(new Uint8Array(Buffer.from(JSON.parse(readFileSync(join(cfg.stateDir, 'link.key'), 'utf8')).sk, 'base64')));
    await relay.relay.admit(keys.publicKey, 'Crewhouse'); // enrol only this host; no public signup or owner routes
    await api('phones/relay', { url: null }, 'PUT');
    await ready(health, child);
    console.log('Crewhouse headless host ready. Run ./crewhouse headless pair to enrol your first phone.');
    process.exitCode = (await exited) ?? 1;
  } finally { stop(); await exited; await relay.close(); }
}
async function setup() {
  if (process.platform !== 'linux') throw new Error('Headless setup needs Linux and systemd.');
  await tailnet();
  if (process.argv.includes('--install-only')) { console.log('Headless files ready; start scripts/headless.mjs serve in your own unit, then run ./crewhouse headless pair.'); return; }
  const root = process.getuid() === 0, scope = root ? [] : ['--user'];
  const dir = root ? '/etc/systemd/system' : join(process.env.XDG_CONFIG_HOME || join(process.env.HOME, '.config'), 'systemd/user');
  execFileSync('systemctl', [...scope, 'show-environment'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (/[\r\n]/.test(repo)) throw new Error('The install path cannot contain a line break.');
  const quote = s => JSON.stringify(s).replaceAll('%', '%%');
  const env = Object.entries(process.env).filter(([k]) => /^(CREWHOUSE_|XDG_|HOME$|PATH$)/.test(k)).map(([k, v]) => `Environment=${quote(`${k}=${v}`)}`).join('\n');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'crewhouse-headless.service'), `[Unit]\nDescription=Crewhouse headless host and private relay\nAfter=network-online.target tailscaled.service\n[Service]\nWorkingDirectory=${repo.replaceAll('%', '%%')}\nExecStart=${quote(process.execPath)} ${quote(join(repo, 'scripts/headless.mjs'))} serve\nRestart=on-failure\nKillMode=mixed\nTimeoutStopSec=30\nUMask=0077\n${env}\n[Install]\nWantedBy=${root ? 'multi-user.target' : 'default.target'}\n`, { mode: 0o600 });
  execFileSync('systemctl', [...scope, 'daemon-reload'], { stdio: 'inherit' });
  execFileSync('systemctl', [...scope, 'enable', '--now', 'crewhouse-headless.service'], { stdio: 'inherit' });
  await pair(); // secrets go to the calling terminal, never the unit's journal
}
try {
  process.chdir(repo);
  const action = process.argv[2] || 'serve';
  if (action === 'setup') await setup();
  else if (action === 'serve') await serve();
  else if (action === 'pair') await pair();
  else if (action === 'health') { if (!await health()) throw new Error('The phone link or relay is not ready.'); console.log('Crewhouse headless host healthy.'); }
  else throw new Error('usage: ./crewhouse setup --headless [--install-only] | headless serve|pair|health');
} catch (e) { console.error(e.message); process.exitCode = 1; }
