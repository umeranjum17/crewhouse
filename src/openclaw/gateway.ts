import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { GatewayClient } from '@openclaw/gateway-client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repo = resolve(import.meta.dirname, '../..');
const runtime = join(repo, 'runtime/openclaw');
/** The pinned engine, installed scripts-off into runtime/openclaw (spec §3.1). Bump it like any dependency, with the tests as the gate. */
export const ENGINE_VERSION = '2026.8.1';

export function isolatedEnv(stateDir: string, token: string): NodeJS.ProcessEnv {
  const root = join(stateDir, 'openclaw');
  const home = join(root, 'home');
  return {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home,
    OPENCLAW_HOME: home, OPENCLAW_STATE_DIR: join(root, 'state'),
    OPENCLAW_CONFIG_PATH: join(root, 'openclaw.json'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'),
    CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    TMPDIR: join(root, 'tmp'),
    OPENCLAW_NO_RESPAWN: '1', OPENCLAW_SKIP_CHANNELS: '1',
    OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
    OPENCLAW_LOAD_SHELL_ENV: '0', OPENCLAW_GATEWAY_TOKEN: token,
    CREWHOUSE_SOCK: join(root, 'crewd.sock'),
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => address && typeof address !== 'string' ? yes(address.port) : no(new Error('No port')));
    });
  });
}

export class OpenClawGateway {
  private child?: ChildProcess;
  private client?: GatewayClient;
  private closing = false;
  private restart?: NodeJS.Timeout;
  private failures = 0;
  private listeners = new Set<(event: { event: string; payload?: any }) => void>();
  onEvent(listener: (event: { event: string; payload?: any }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  readonly root: string;
  readonly stateDir: string;
  /** Where the household's crew folder lives, so the install policy recognizes the bots' own skills. */
  crewDir = '';
  constructor(stateDir: string) { this.stateDir = stateDir; this.root = join(stateDir, 'openclaw'); }

  /** Install the pinned engine and lay the isolated state's base files, without launching. Idempotent, so the
   *  sign-in migration can run the engine's doctor in the offline window between this and start(): the doctor
   *  refuses to run while a gateway owns the state directory, and it is nothing without the installed engine. */
  async prepare(): Promise<void> {
    mkdirSync(join(this.root, 'home'), { recursive: true });
    const install = join(runtime, 'node_modules/openclaw/openclaw.mjs');
    if (!existsSync(install)) {
      const home = join(this.root, 'install-home');
      mkdirSync(home, { recursive: true });
      const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', runtime], {
        env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home,
          npm_config_cache: join(this.root, 'npm-cache'), OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL: '1' },
        stdio: 'pipe', timeout: 300_000,
      });
      if (result.status !== 0) throw new Error(`Engine install failed: ${result.stderr?.toString().slice(-500)}`);
    }
    // Experimental only: loading from this symlink did not provide trusted Codex registration.
    const extensions = join(this.root, 'extensions');
    mkdirSync(extensions, { recursive: true });
    const codex = join(extensions, 'codex');
    if (!existsSync(codex)) symlinkSync(join(runtime, 'node_modules/@openclaw/codex'), codex, 'dir');
    mkdirSync(join(this.root, 'state'), { recursive: true });
    mkdirSync(join(this.root, 'tmp'), { recursive: true });
    mkdirSync(join(this.stateDir, 'logs'), { recursive: true });
    const tokenPath = join(this.root, 'token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600 });
    const token = readFileSync(tokenPath, 'utf8').trim();
    const portPath = join(this.root, 'port');
    const port = existsSync(portPath) ? Number(readFileSync(portPath, 'utf8')) : await freePort();
    if (!port || port === 18789) throw new Error('Invalid engine port');
    writeFileSync(portPath, `${port}\n`, { mode: 0o600 });
    const crewTools: string[] = JSON.parse(readFileSync(join(repo, 'src/openclaw/plugin/openclaw.plugin.json'), 'utf8')).contracts.tools;
    const config = {
      logging: { file: join(this.stateDir, 'logs/openclaw-events.log') },
      models: { catalogRefresh: { enabled: false } },
      update: { checkOnStart: false, auto: { enabled: false } },
      telemetry: { enabled: false },
      gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token: { source: 'env', provider: 'default', id: 'OPENCLAW_GATEWAY_TOKEN' } }, controlUi: { enabled: false }, tailscale: { mode: 'off' } },
      discovery: { mdns: { mode: 'off' } }, env: { shellEnv: { enabled: false } },
      agents: { defaults: { sandbox: { mode: 'off' }, models: { 'openai/*': { agentRuntime: { id: 'openclaw' } } }, modelPolicy: { allow: [] } } },
      tools: { profile: 'coding', alsoAllow: crewTools, deny: ['group:fs', 'group:runtime', 'group:automation', 'group:messaging', 'group:nodes', 'group:ui', 'sessions_send', 'sessions_spawn', 'conversations_send', 'conversations_turn', 'subagents', 'code_execution', 'gateway', 'openclaw', 'plugins', 'cron', 'ask_user', 'suggest_task'], fs: { workspaceOnly: true }, exec: { security: 'deny', ask: 'always' }, elevated: { enabled: false }, agentToAgent: { enabled: false }, sessions: { visibility: 'agent' } },
      plugins: {
        load: { paths: [join(repo, 'src/openclaw/plugin')] }, allow: ['crewhouse', 'memory-core', 'openai', 'codex'],
        entries: {
          crewhouse: { hooks: { timeouts: { before_tool_call: 200_000 } } },
          'memory-core': { config: { dreaming: { enabled: false } } },
          // Experimental only: native harness needs broader exec permission and lacks Crewhouse's gate.
          codex: { enabled: true },
        },
      },
      // Only skills reviewed against the tarball and this repo's own content may exist; installs go through the
      // operator policy (src/openclaw/policy.mjs) and fail closed without it. Learning ships off here; crewd flips it
      // to auto when the household's "Learn from how I work" is on (Crew.setLearning), which is its default.
      skills: { allowBundled: ['video-frames', 'openai-whisper', 'summarize', 'nano-pdf', 'diagram-maker'], workshop: { autonomous: { mode: 'off' }, approvalPolicy: 'auto' } },
      security: { installPolicy: { enabled: true, exec: {
        source: 'exec', command: process.execPath, args: [join(repo, 'src/openclaw/policy.mjs')],
        trustedDirs: [dirname(process.execPath), join(repo, 'src/openclaw')], timeoutMs: 10_000,
        passEnv: ['OPENCLAW_STATE_DIR'], env: { CREWHOUSE_CREW_DIR: this.crewDir },
      } } },
      channels: {},
    };
    const configPath = join(this.root, 'openclaw.json');
    if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    else {
      const saved = JSON.parse(readFileSync(configPath, 'utf8'));
      const before = JSON.stringify(saved);
      saved.agents ??= {};
      const defaults = saved.agents.defaults ??= {};
      defaults.models ??= {};
      defaults.models['openai/*'] = { ...defaults.models['openai/*'], agentRuntime: { id: 'openclaw' } };
      // An explicit model map must not narrow the family's other signed-in providers.
      defaults.modelPolicy ??= { allow: [] };
      if (defaults.modelPolicy.allow?.length && !defaults.modelPolicy.allow.includes('openai/*')) defaults.modelPolicy.allow.push('openai/*');
      if (JSON.stringify(saved) !== before) writeFileSync(configPath, JSON.stringify(saved, null, 2), { mode: 0o600 });
    }
  }

  async start(): Promise<GatewayClient> {
    if (this.client) return this.client;
    this.closing = false;
    await this.prepare();
    const token = readFileSync(join(this.root, 'token'), 'utf8').trim();
    const env = isolatedEnv(this.stateDir, token);
    const port = Number(readFileSync(join(this.root, 'port'), 'utf8'));
    const entry = resolve(createRequire(join(runtime, 'package.json')).resolve('openclaw'), '../../openclaw.mjs');
    const pidfile = join(this.root, 'gateway.pid');
    if (existsSync(pidfile)) {
      const pid = Number(readFileSync(pidfile, 'utf8'));
      // A reused PID must never cause us to kill another application.
      if (pid > 0 && pid !== process.pid) try {
        const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        if (command.includes(entry) && command.includes('gateway')) process.kill(-pid, 'SIGTERM');
      } catch { /* already gone */ }
    }
    const log = createWriteStream(join(this.stateDir, 'logs/openclaw.log'), { flags: 'a', mode: 0o600 });
    const launch = () => {
      const child = spawn(process.execPath, [entry, 'gateway', '--port', String(port)], { env, cwd: env.HOME, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });
      writeFileSync(pidfile, `${child.pid}\n`, { mode: 0o600 });
      this.child = child;
      return child;
    };
    launch();
    const identityPath = join(this.root, 'device.json');
    if (!existsSync(identityPath)) {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
      writeFileSync(identityPath, JSON.stringify({
        deviceId: createHash('sha256').update(raw).digest('hex'),
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }), { mode: 0o600 });
    }
    const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
    const client = new GatewayClient({
      url: `ws://127.0.0.1:${port}`, token, role: 'operator',
      scopes: ['operator.read', 'operator.write', 'operator.admin'], clientName: 'cli',
      deviceIdentity: identity,
      hostDeps: {
        signDevicePayload: (pem, payload) => sign(null, Buffer.from(payload), createPrivateKey(pem)).toString('base64url'),
        publicKeyRawBase64UrlFromPem: (pem) => createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url'),
      },
      caps: ['tool-events'],
      onEvent: (event) => { for (const listener of this.listeners) listener(event); },
      onHelloOk: () => { this.client = client; },
      onClose: () => { if (!this.closing) this.client = undefined; },
    });
    client.start();
    try {
      const until = Date.now() + 90_000;
      let repaired = false;
      while (!this.client && Date.now() < until) {
        if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
          if (this.child.exitCode === 78 && !repaired) {
            repaired = true;
            const result = spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'], { env, cwd: env.HOME, timeout: 60_000, stdio: 'pipe' });
            if (result.status === 0) { launch(); continue; }
          }
          throw new Error(`Engine exited (${this.child.exitCode}); see ${this.stateDir}/logs/openclaw.log`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!this.client) throw new Error('Engine handshake timed out');
      this.failures = 0;
      this.child?.once('exit', () => {
        if (this.closing) return;
        this.client?.stop(); this.client = undefined;
        const delay = Math.min(30_000, 1000 * 2 ** this.failures++);
        this.restart = setTimeout(() => { void this.start().catch(() => {}); }, delay);
      });
      return client;
    } catch (error) { await this.stop(); throw error; }
  }

  /** The context for an offline doctor run against the isolated state (the sign-in migration, exit-78 repair). */
  doctorContext(): { entry: string; env: NodeJS.ProcessEnv } {
    const entry = resolve(createRequire(join(runtime, 'package.json')).resolve('openclaw'), '../../openclaw.mjs');
    const token = readFileSync(join(this.root, 'token'), 'utf8').trim();
    return { entry, env: isolatedEnv(this.stateDir, token) };
  }

  async stop(): Promise<void> {
    this.closing = true;
    clearTimeout(this.restart);
    this.client?.stop(); this.client = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    // The fixture teardown (and crewd's own shutdown) must not race a child that is still writing its state dir:
    // wait for the exit, then escalate.
    const gone = new Promise<void>((yes) => child.once('exit', () => yes()));
    const pid = child.pid;
    const kill = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { /* already gone */ } };
    for (const [sig, ms] of [['SIGTERM', 3000], ['SIGKILL', 3000]] as [NodeJS.Signals, number][]) {
      if (await Promise.race([gone, sleep(ms)])) return;
      kill(sig);
    }
    await gone.catch(() => {});
  }
}
