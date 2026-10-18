// Chief's personality is the engine's own SOUL.md: the person edits it in Settings and the very next turn the model
// sees it; Put back brings the template again. Real crewd, the pinned Gateway (crewd builds its own
// `new OpenClawRuntime`), and the scripted model: no account, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { temp } from './tmp.ts';
import { until } from './lab.ts';
import { startModelStub } from './openclaw-stub.ts';

test('a saved personality reaches Chief\'s next turn as SOUL.md, helpers keep their own, and Put back restores it', { timeout: 280_000 }, async () => {
  const root = temp('crewhouse-soul'), stub = await startModelStub();
  const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
  const daemon = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: '0',
    CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools'), CREWHOUSE_ENGINE_BASE_URL: stub.url, CREWHOUSE_ENGINE_API_KEY: 'stub-soul' } });
  after(async () => { daemon.kill(); await stub.close(); });
  let out = ''; daemon.stdout!.on('data', (d) => { out += d; });
  const api = async (method: string, path: string, body?: unknown) => (await fetch(`http://127.0.0.1:${port}${path}`, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`, 'content-type': 'application/json', 'x-crewhouse': '1' } })).json();
  // One message, answered: the system prompt the model saw for it.
  const turn = async (bot: string, text: string) => {
    const { task } = await api('POST', `/api/bots/${bot}/messages`, { text });
    let t: any;
    await until(`${bot} answered "${text}"`, async () => (t = (await api('GET', `/api/bots/${bot}`)).tasks.find((x: any) => x.id === task && !['queued', 'working'].includes(x.state))), 240_000);
    assert.equal(t.state, 'done', JSON.stringify(t));
    const asked = stub.calls.findLast((c) => JSON.stringify(c.body.messages ?? []).includes(text))!;
    return asked.body.messages.filter((m: any) => m.role === 'system').map((m: any) => typeof m.content === 'string' ? m.content : m.content.map((c: any) => c.text ?? '').join('')).join('\n') as string;
  };
  const template = readFileSync(join(import.meta.dirname, '..', 'templates', 'chief', 'soul.md'), 'utf8').trim();
  const readText = (p: string) => existsSync(p) ? readFileSync(p, 'utf8') : '';
  const once = (text: string, part: string) => text.split(part).length - 1;

  await until('the engine is up', () => out.includes('crewd engine ready'), 240_000);
  // crewd points the engine at the scripted model, then sets learning, after it is up: a turn before then races the config.
  await until('the scripted model is set', () => /crewhouse-stub[\s\S]*"autonomous"|"autonomous"[\s\S]*crewhouse-stub/.test(readText(join(root, 'state', 'openclaw', 'openclaw.json'))), 60_000);
  await api('POST', '/api/onboard', { address: 'Umer' });
  const first = await turn('chief', 'Plan my week');
  assert.equal(once(first, 'first mate of the Crewhouse'), 1, 'the default soul reaches the model once, as the engine\'s SOUL.md');
  assert.match(first, /SOUL\.md: persona\/tone[\s\S]*SOUL\.md\n# Chief[\s\S]*Call the person "Captain"/);
  assert.doesNotMatch(first, /You're not a chatbot|Bootstrap Pending|BOOTSTRAP\.md - Birth Sequence|pick something you like/, 'no stock OpenClaw persona or first-run ritual');

  // Settings › Chief's personality: the person's words, applied on the next turn, in place of the old ones.
  const mine = `${template.replace('"Captain"', '"Skipper"')}`;
  assert.equal((await api('PUT', '/api/bots/chief/soul', { text: mine })).soul, `${mine}\n`);
  const edited = await turn('chief', 'And next week?');
  assert.match(edited, /Call the person "Skipper"/);
  assert.doesNotMatch(edited, /"Captain"/);

  // A helper runs on the same engine agent: the house SOUL.md is Chief's, its own soul governs its work.
  await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
  const helper = await turn('scout', 'Compare two kettles');
  assert.match(helper, /Call the person "Skipper"[\s\S]*SOUL\.md is Chief's voice for the house; in your own work, who you are below comes first\.\n\n# Scout/);

  // Put back how Chief started: the template again, on the next turn.
  assert.equal((await api('POST', '/api/bots/chief/soul/reset')).soul.trim(), template);
  const back = await turn('chief', 'One more thing');
  assert.match(back, /Call the person "Captain"/);
  assert.doesNotMatch(back, /"Skipper"/);
});
