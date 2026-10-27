// Owned real-product lab: node native-delegation.ts <scratch> <ready.json> --key-file <dedicated key>
// CI uses --scripted explicitly: real Gateway and real app host, synthetic retained auth + loopback HTTP provider.
// Live mode never loads the scripted provider or an installed CLI login. TERM stops this lab's server and engine.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { OpenClawRuntime } from '../../src/openclaw/runtime.ts';
import { join } from 'node:path';
import { createServer as createHttp, request as httpRequest } from 'node:http';
const [scratch, ready, mode, keyFile] = process.argv.slice(2);
if (!scratch || !ready || !['--scripted', '--key-file'].includes(mode)) throw Error('Choose --scripted or --key-file <dedicated key path>');
for (const p of ['home', 'tmp', 'state', 'crew', 'tools']) mkdirSync(join(scratch, p), { recursive: true });
Object.assign(process.env, { HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'), CREWHOUSE_RUN_MODE: 'test', CREWHOUSE_RUN_HOME: join(scratch, 'home'), CREWHOUSE_STATE_DIR: join(scratch, 'state'), CREWHOUSE_CREW_DIR: join(scratch, 'crew'), CREWHOUSE_TOOLS_DIR: join(scratch, 'tools'), CREWHOUSE_GOOGLE_CLIENT: join(scratch, 'absent-google.json'), CREWHOUSE_PORT: mode === '--key-file' ? process.argv[6] || '0' : '0', CREWHOUSE_LINK_PORT: process.env.LAB_LINK_PORT ?? '0', XDG_STATE_HOME: join(scratch, 'home/state'), XDG_CONFIG_HOME: join(scratch, 'home/config'), XDG_CACHE_HOME: join(scratch, 'home/cache'), XDG_DATA_HOME: join(scratch, 'home/data'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${scratch}/no-bus` });
for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
let helperId = '', helperName = '';
const HI = process.env.LAB_HI_REPLY;
let stub: Awaited<ReturnType<typeof import('../../test/openclaw-stub.ts')['startModelStub']>> | undefined;
if (mode === '--scripted') {
  const { startModelStub } = await import('../../test/openclaw-stub.ts');
  stub = await startModelStub(undefined, (body, text) => {
    const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    // Legwork: a spawned child answers its one item after its tool calls; Chief spawns, then answers when the reports are in.
    // LAB_HI_REPLY (phone-reconnect-reply.mjs): Chief answers a bare "Hi" with these words, streamed in two parts below.
    if (HI && system.includes('Your id in Crewhouse is chief.') && /^Hi[.!]?$/.test(text.trim())) return { reply: HI };
    const item = /\bitem=(\w+)/.exec(text)?.[1];
    if (item) return { text, reply: `LEGWORK-DONE ${item}` };
    const reports = [...new Set(JSON.stringify(body.messages.filter((m: any) => m.role !== 'system')).match(/LEGWORK-DONE \w+/g) ?? [])];
    // The reports come back in a turn of the engine's own, without Chief's persona.
    if (reports.length) return { reply: `Legwork is in: ${reports.map((r) => r.split(' ')[1]).sort().join(', ')}.` };
    if (system.includes('Your id in Crewhouse is chief.') && /say hello back/i.test(text)) return { reply: 'Good morning, Umer. The crew is ready when you are.' }; // chief-reply-engine.sh
    if (!system.includes('Your id in Crewhouse is chief.')) return text.includes('cannot do it') ? { fail: 'The helper’s own job could not be done.' } : { text };
    if (/\[legwork(-hold)?\]/.test(text)) {
      const hold = text.lastIndexOf('[legwork-hold]') > text.lastIndexOf('[legwork]'); // the latest ask, not an earlier job Chief's prompt recalls: one lookup whose report never comes, for the restart proof to kill under
      const own = /agentId "([a-z0-9-]+)"/.exec(system)?.[1] ?? 'm1', call = (input: object) => `[tool sessions_spawn ${JSON.stringify(input)}]`;
      const read = (name: string) => `item=${name} [tool crew_profile {"text":"forbidden legwork change"}] [tool web_fetch {"url":"http://example.invalid/${name}"}]${hold ? ' ask permission' : ''}`;
      return { text: [...hold ? [] : [call({ agentId: own, task: 'cwd is not allowed', cwd: '/' }), call({ agentId: 'not-an-agent', task: 'wrong agent' })], ...(hold ? ['held'] : ['alpha', 'beta', 'gamma']).map((name) => call({ agentId: own, task: read(name), label: name })), '[tool sessions_yield {"message":"Answer in one plain sentence."}]'].join(' ') };
    }
    const report = body.messages.findLast((m: any) => m.role !== 'system' && JSON.stringify(m.content).includes(`stub ${helperId}:`) && JSON.stringify(m.content).includes('BLUE-42'));
    if (report) return { reply: `${helperName} checked the file. Umer owns the blue folder. Reference BLUE-42.` };
    const key = new RegExp(`${helperId}: (agent:[^\\s]+)`).exec(system)?.[1];
    if (!key) return { reply: 'No helper session was offered.' };
    // A model that does not wait: it hands the job on and keeps working in the same turn, going after the helper's file
    // for the report. The crew holds the run while the helper has the job, so the model is told to wait, ends its turn,
    // and the report arrives in the next turn.
    if (body.messages.filter((m: any) => m.role === 'tool').length >= 3) return { reply: 'Waiting for the helper.' };
    const outcome = text.includes('uncertain proof') ? '[tool crew_outcome {"worked":false,"seen":"The requested result could not be confirmed."}] ' : '';
    // A helper whose own job fails: the brief carries the marker, so the helper's own turn fails and Chief's hand-off
    // has to settle on its own (the lane-reset proof: the job must not wait for the engine).
    const fail = text.includes('cannot do it') ? 'cannot do it ' : '';
    return { text: `[tool sessions_send ${JSON.stringify({ sessionKey: 'agent:m1:not-a-helper', message: 'Do not admit this target', timeoutSeconds: 0 })}] ` +
      `[tool sessions_send ${JSON.stringify({ sessionKey: key, message: `Read the file and report what it says. ${fail}${outcome}[tool crew_profile {"text":"forbidden helper change"}] [tool crew_read {"path":"facts.txt"}]`, timeoutSeconds: 0 })}] ` +
      `[tool crew_read {"path":"files/facts.txt"}]` };
  });
  let base = stub.url;
  if (HI) { // the first sentence of Chief's "Hi" reply streams at once and the rest 8 s later, so a link cut can land between them
    const up = new URL(stub.url), [first] = HI.split(/(?<=\.) /), quoted = JSON.stringify(HI);
    const slow = createHttp((req, res) => req.pipe(httpRequest({ host: up.hostname, port: up.port, path: req.url, method: req.method, headers: req.headers }, async (u) => {
      let text = ''; for await (const c of u) text += c;
      res.writeHead(u.statusCode ?? 500, u.headers);
      const at = text.indexOf(quoted), cut = text.lastIndexOf('data: ', at);
      if (at < 0) return void res.end(text);
      const line = text.slice(cut, text.indexOf('\n\n', at) + 2);
      res.write(text.slice(0, cut) + line.replace(quoted, JSON.stringify(first)));
      setTimeout(() => res.end(line.replace('"role":"assistant",', '').replace(quoted, JSON.stringify(HI.slice(first.length))) + text.slice(cut + line.length)), 8000);
    })));
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(slow.address() as { port: number }).port}${up.pathname}`;
  }
  process.env.CREWHOUSE_ENGINE_BASE_URL = base; process.env.CREWHOUSE_ENGINE_API_KEY = 'native-fixture-only';
  const legacy = join(scratch, 'state/people/1/engine/auth.json'); mkdirSync(join(legacy, '..'), { recursive: true });
  if (!existsSync(join(scratch, 'state/crew.db'))) writeFileSync(legacy, (await import('../../test/migrate-house.ts')).legacyAuth()); // a rebooted lab keeps its household
}
if (mode === '--key-file') {
  const { createServer } = await import('node:net');
  const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  process.env.CREWHOUSE_LINK_PORT = String((reserve.address() as { port: number }).port); process.env.CREWHOUSE_LINK_HOST = '127.0.0.1';
  await new Promise<void>(resolve => reserve.close(() => resolve()));
}
const { Crew } = await import('../../src/crew.ts'), { Store } = await import('../../src/db.ts'), { loadConfig } = await import('../../src/config.ts'), disk = await import('../../src/bots.ts'), { startServer } = await import('../../src/server.ts');
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('learning', 'off')");
const until = async (label: string, condition: () => unknown | Promise<unknown>, ms = 300_000) => { const end = Date.now() + ms; while (!await condition()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await new Promise(r => setTimeout(r, 50)); } };
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let stopLab!: () => void, turnUpperBound = 0;
const stop = new Promise<void>(resolve => { stopLab = resolve; process.once('SIGTERM', () => resolve()); process.once('SIGINT', () => resolve()); });
const countTurn = () => { if (++turnUpperBound >= 60) { console.error('Live proof stopped at its conservative lifecycle/host-tool activity ceiling.'); stopLab(); } };
if (mode === '--key-file') db.onEvent(e => { if (e.kind === 'run.call') countTurn(); });
(crew.runtime as OpenClawRuntime).kit.onEvent('byokit.delegated', e => appendFileSync(`${ready}.delegated.jsonl`, JSON.stringify({ type: e.type, reason: e.type === 'ended' ? e.reason : undefined, session: e.run.sessionKey, run: e.run.runId, root: e.run.root.runId }) + '\n'));
if (mode === '--key-file') (crew.runtime as OpenClawRuntime).kit.onEvent('agent', e => {
  if (e.stream === 'lifecycle' || e.stream === 'tool') appendFileSync(`${ready}.native.jsonl`, JSON.stringify({ at: Date.now(), ...e }) + '\n');
  if ((e.stream === 'lifecycle' && e.data?.phase === 'start') || (e.stream === 'tool' && e.data?.phase === 'result')) {
    countTurn();
  }
});
try {
  crew.init(); await until('engine ready', () => crew.runtime.engine?.().phase === 'ready');
  if (stub) await until('Crew has configured its scripted provider and learning mode', () => {
    const file = join(cfg.stateDir, 'openclaw/openclaw.json'); if (!existsSync(file)) return false;
    const active = JSON.parse(readFileSync(file, 'utf8'));
    return crew.runtime.engine?.().phase === 'ready' && active.models?.providers?.['crewhouse-stub'] && active.skills?.workshop?.autonomous?.mode === 'off';
  });
  else {
    if (!await crew.accounts.signedIn('minimax')) { await crew.accounts.login('minimax', 'key'); await crew.accounts.paste('minimax', readFileSync(keyFile, 'utf8').trim()); await crew.accounts.finished('minimax'); }
    if (!await crew.accounts.signedIn('minimax')) throw Error(`MiniMax sign-in failed: ${crew.accounts.view('minimax')?.error ?? 'not ready'}`);
    crew.pickModel('minimax', 'MiniMax-M3');
  }
  if (!crew.person().onboarded) crew.onboard('Umer'); crew.updatePerson({ name: 'Umer', share: 'full' });
  const helper = crew.bots().find(b => b.template === 'scout') ?? crew.recruit('scout', undefined, 'person'); helperId = helper.id; helperName = helper.display; disk.setGrants(cfg, helper.id, ['files']);
  const facts = join(disk.botDir(cfg, helper.id), 'facts.txt'); if (!existsSync(facts)) writeFileSync(facts, 'Umer owns the blue folder. Reference BLUE-42.\n');
  server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  writeFileSync(ready, JSON.stringify({ pid: process.pid, base, authorityFile: join(cfg.stateDir, 'person.key'), stateDir: cfg.stateDir, crewDir: cfg.crewDir, mode, helper: helper.id, link: crew.phoneLink?.status() }));
  console.log(`READY ${base} ${mode === '--scripted' ? 'scripted HTTP model' : 'live MiniMax M3'}`);
  await stop;
} finally {
  server?.closeAllConnections(); server?.close(); await crew.phoneLink?.close();
  writeFileSync(`${ready}.delegated-runs.json`, JSON.stringify([...(crew.runtime as OpenClawRuntime).kit.delegatedRuns()].map(r => r.sessionKey)));
  await crew.stop();
  writeFileSync(`${ready}.events.json`, JSON.stringify(db.all('SELECT * FROM events ORDER BY seq')));
  if (stub) writeFileSync(`${ready}.provider.json`, JSON.stringify(stub.calls.map(c => ({ path: c.path, body: c.body }))));
  db.close(); await stub?.close(); console.log('STOPPED');
}
