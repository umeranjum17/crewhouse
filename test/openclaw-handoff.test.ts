// The hand-off that never reports, on the kit's fake Gateway (the engine stub: no engine, no network, no account, no
// live model). Chief's lane is reset when a helper's job fails or its report never comes, and a helper that finished is
// read rather than failed: the job settles with the helper's own result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { faked } from './kit-fake.ts';

process.env.CREWHOUSE_HANDOFF_MS ??= '400'; // the hand-off bound, shortened: a test never waits two minutes

const CHIEF = 'agent:m1:crewhouse:chief:1';
const helperOf = (bot: string) => `b${createHash('sha256').update(bot).digest('hex').slice(0, 15)}`;
const keyOf = (bot: string) => `agent:m1:h-${helperOf(bot)}:crewhouse:${bot}`;

/** An engine that takes Chief's turn and never ends it: the hand-off waits for a report that never comes. */
function waiting() {
  let release: ((v: unknown) => void) | undefined, told: (id: string) => void = () => {};
  const accepted = new Promise<string>((r) => { told = r; });
  const f = faked({ delegate: (parent, bot, key) => ({ key, bot, task: 2 }) }, {
    'models.authStatus': (p: any) => ({ providers: p.agentId === 'm1' ? [{ provider: 'openai' }] : [] }),
    agent: (p: any) => { told(String(p.idempotencyKey)); return { runId: 'chief-1', status: 'accepted' }; },
    'agent.wait': () => new Promise((resolve) => { release = resolve; }),
    'chat.abort': () => { release?.({ runId: 'chief-1', status: 'error', stopReason: 'rpc' }); return {}; },
  });
  // The member's own account, as the account index reads it: the hand-off runs on the member's agent.
  f.fake.handle('byokit.accounts', (p: any) => p.action === 'list' && p.agentId === 'm1'
    ? { ok: true, profiles: [{ provider: 'openai', profileId: 'openai:default', type: 'oauth', status: 'ok' }] } : { ok: false });
  return { f, accepted, end: () => release?.({ runId: 'chief-1', status: 'ok' }) };
}

/** Chief's turn, handed to Scout: the gate admits the hand-off, so the helper's job exists. */
async function handOff(f: ReturnType<typeof waiting>['f'], idem: string) {
  const gate = await f.ask({ kind: 'gate', key: CHIEF, tool: 'sessions_send', runId: idem,
    input: { sessionKey: keyOf('scout'), message: 'find it', timeoutSeconds: 0 } });
  assert.equal(gate.allow, true, 'the hand-off was admitted');
  assert.deepEqual(f.seen.delegated.map(([, bot, key]) => [bot, key]), [['scout', keyOf('scout')]], 'the job went to the helper');
  return { sessionKey: keyOf('scout'), member: 'm1', helper: helperOf('scout'), runId: 'child-1', agentId: 'm1',
    parent: { sessionKey: CHIEF, runId: idem }, root: { sessionKey: CHIEF, runId: idem }, tools: [] };
}

/** The job's own outcome, or a marker when Chief's lane was still held: the jam this file is about. */
async function settle(run: Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  const held = new Promise((r) => { timer = setTimeout(() => r({ ok: false, kind: 'held' }), 8_000); timer.unref(); });
  const end: any = await Promise.race([run, held]);
  clearTimeout(timer);
  return end;
}

const chiefRun = (f: ReturnType<typeof waiting>['f']) => f.runtime.run({ key: CHIEF, bot: 'chief', task: 1, account: 'chatgpt',
  cwd: '', system: 'Be brief.', message: 'Ask Scout to find it.', builtins: [], team: [{ bot: 'scout', system: 'You are Scout.', tools: [] }] }, () => {});

test('a helper whose job failed: Chief\'s lane is reset and the job settles at once', async () => {
  const { f, accepted } = waiting();
  try {
    await f.started;
    const run = chiefRun(f);
    const ref = await handOff(f, await accepted);
    f.fake.emit('byokit.delegated', { type: 'admitted', run: ref });
    f.fake.emit('byokit.delegated', { type: 'ended', run: ref, reason: 'error' });
    const end: any = await settle(run);
    assert.notEqual(end.kind, 'held', "the job is still waiting: a failed helper held Chief's lane");
    assert.ok(!end.ok, `the hand-off settled as a success: ${JSON.stringify(end)}`);
    assert.equal(end.kind, 'handoff');
    assert.match(end.message, /stopped before reporting back/);
    assert.ok(f.fake.calls.some((c) => c.method === 'chat.abort'), "Chief's lane was not reset");
  } finally { await f.done(); }
});

test('a helper that finished and never reported: Chief\'s lane is reset and the helper\'s result is read', async () => {
  const { f, accepted } = waiting();
  try {
    await f.started;
    const run = chiefRun(f);
    const ref = await handOff(f, await accepted);
    f.fake.emit('byokit.delegated', { type: 'admitted', run: ref });
    f.fake.emit('byokit.delegated', { type: 'event', run: ref, event: { stream: 'assistant', data: { text: 'Scout found it.' } } });
    f.fake.emit('byokit.delegated', { type: 'ended', run: ref, reason: 'terminal' });
    const end: any = await settle(run);
    assert.notEqual(end.kind, 'held', "the job is still waiting: a report that never came held Chief's lane");
    assert.ok(end.ok, `the hand-off settled as a failure: ${JSON.stringify(end)}`);
    assert.equal(end.text, 'Scout found it.', "the helper's own result is the job's result");
    assert.ok(f.fake.calls.some((c) => c.method === 'chat.abort'), "Chief's lane was not reset");
  } finally { await f.done(); }
});

test('a helper whose job failed after Chief\'s turn ended: the job settles with the hand-off\'s own words', async () => {
  const { f, accepted, end } = waiting();
  try {
    await f.started;
    const run = chiefRun(f);
    const ref = await handOff(f, await accepted);
    f.fake.emit('byokit.delegated', { type: 'admitted', run: ref });
    end(); // Chief's own turn is over: there is no lane left to hold
    f.fake.emit('byokit.delegated', { type: 'ended', run: ref, reason: 'error' });
    const out: any = await settle(run);
    assert.notEqual(out.kind, 'held', "the job is still waiting after Chief's turn ended");
    assert.ok(!out.ok, JSON.stringify(out));
    assert.equal(out.kind, 'handoff');
    assert.match(out.message, /stopped before reporting back/);
  } finally { await f.done(); }
});
