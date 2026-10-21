// A MiniMax key sign-in runs on the key lane (byokit-key-m1, auth apiKey), its abort names that lane, and an OAuth account
// still runs on the member agent. The kit's fake Gateway answers; no engine, no network, no account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faked } from './kit-fake.ts';

const runSpec = (account: string, model: string | undefined, n: number) => ({ key: `agent:m1:crewhouse:chief:${n}`, bot: 'chief', task: n, account,
  ...(model ? { model } : {}), cwd: '', system: '', message: 'hi', builtins: [] });

test('a MiniMax key run hits the key lane; abort names it; an OAuth account stays on the member agent', async () => {
  // The key lane reports its saved key as the provider's sign-in; the member agent has none.
  const f = faked({}, { 'models.authStatus': (p: any) => ({ providers: p.agentId === 'byokit-key-m1' ? [{ provider: 'minimax' }] : [] }) });
  try {
    await f.started;
    const steps: { done?: boolean; error?: string }[] = [];
    const signIn = f.runtime.signIn('minimax', 'key', (s) => steps.push(s));
    await signIn.paste('fixture-minimax-key');
    for (let i = 0; i < 100 && !steps.some((s) => s.done || s.error); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(steps.some((s) => s.done), JSON.stringify(steps));
    assert.equal(await f.runtime.signedIn('minimax'), true);

    const end = await f.runtime.run(runSpec('minimax', 'MiniMax-M3.1-Flash-Preview', 1), () => {});
    assert.ok(end.ok, JSON.stringify(end));
    const agent = f.fake.calls.filter((c) => c.method === 'agent').at(-1)?.params as any;
    assert.deepEqual([agent?.agentId, agent?.provider, agent?.model], ['byokit-key-m1', 'minimax', 'MiniMax-M3.1-Flash-Preview']);

    // Held: the fake's agent answers only after abort, so the run is still live when abort is called.
    let release = (): void => {};
    f.fake.handle('agent', () => new Promise((r) => { release = () => r({ status: 'aborted' }); }));
    const held = f.runtime.run(runSpec('minimax', 'MiniMax-M3.1-Flash-Preview', 2), () => {});
    for (let i = 0; i < 200 && !f.fake.calls.some((c) => c.method === 'agent' && (c.params as any)?.agentId === 'byokit-key-m1' && (c.params as any)?.sessionKey?.endsWith(':2')); i++) await new Promise((r) => setTimeout(r, 20));
    await f.runtime.abort('agent:m1:crewhouse:chief:2');
    const abort = f.fake.calls.filter((c) => c.method === 'chat.abort').at(-1)?.params as any;
    assert.ok(String(abort?.sessionKey ?? '').startsWith('agent:byokit-key-m1:'), JSON.stringify(abort));
    release();
    await held;
  } finally { await f.done(); }
});

test('an OAuth account signed in on the member agent runs without the key lane', async () => {
  const f = faked({}, { 'models.authStatus': () => ({ providers: [{ provider: 'openai' }] }) });
  try {
    await f.started;
    const end = await f.runtime.run(runSpec('chatgpt', undefined, 3), () => {});
    assert.ok(end.ok, JSON.stringify(end));
    const agent = f.fake.calls.filter((c) => c.method === 'agent').at(-1)?.params as any;
    assert.equal(agent?.agentId, 'm1');
    assert.equal(agent?.auth, undefined);
  } finally { await f.done(); }
});

test('low thinking is sent only to a model whose catalog lists it; a model that refuses off is never forced to', async () => {
  const levels = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
  const f = faked({}, { 'models.authStatus': () => ({ providers: [{ provider: 'minimax' }] }), 'models.list': () => ({ models: [
    { provider: 'minimax', id: 'refuses-off', thinkingLevels: levels('adaptive') },
    { provider: 'minimax', id: 'has-low', thinkingLevels: levels('off', 'low') },
  ] }) });
  try {
    await f.started;
    const thinking = async (model: string, n: number) => {
      const end = await f.runtime.run({ ...runSpec('chatgpt', model, n), account: 'minimax', thinking: 'low' }, () => {});
      assert.ok(end.ok, JSON.stringify(end));
      return (f.fake.calls.filter((c) => c.method === 'agent').at(-1)?.params as any)?.thinking;
    };
    assert.equal(await thinking('refuses-off', 4), undefined);
    assert.equal(await thinking('has-low', 5), 'low');
  } finally { await f.done(); }
});
