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

test('a MiniMax key starts on Flash when its catalog lists it, the picker offers the key\'s models, and one catalog read serves all of it', async () => {
  const f = faked({}, { 'models.authStatus': (p: any) => ({ providers: p.agentId === 'byokit-key-m1' ? [{ provider: 'minimax' }] : [] }), 'models.list': () => ({ models: [
    { provider: 'minimax', id: 'minimax/MiniMax-M3', name: 'MiniMax M3', available: false, tags: ['default'] },
    { provider: 'minimax', id: 'minimax/MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', available: false },
  ] }) });
  try {
    await f.started;
    const steps: { done?: boolean; error?: string }[] = [];
    const signIn = f.runtime.signIn('minimax', 'key', (s) => steps.push(s));
    await signIn.paste('fixture-minimax-key');
    for (let i = 0; i < 100 && !steps.some((s) => s.done || s.error); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(steps.some((s) => s.done), JSON.stringify(steps));
    const end = await f.runtime.run({ ...runSpec('minimax', undefined, 6), thinking: 'low' }, () => {});
    assert.ok(end.ok, JSON.stringify(end));
    assert.equal((f.fake.calls.filter((c) => c.method === 'agent').at(-1)?.params as any)?.model, 'MiniMax-M3.1-Flash');
    const listed = await f.runtime.models('minimax');
    assert.deepEqual(listed.map((m) => m.id), ['MiniMax-M3', 'MiniMax-M3.1-Flash']);
    assert.deepEqual(listed.filter((m) => m.dflt).map((m) => m.id), ['MiniMax-M3.1-Flash'], 'the row the run takes with nothing picked is the one the app can name for a first sign-in');
    assert.equal(f.fake.calls.filter((c) => c.method === 'models.list').length, 1, 'the sign-in read the catalog; the run and the picker reused it');
  } finally { await f.done(); }
});

test('an OpenRouter key signs in through the kit and the picker lists the key\'s live models, an id with a colon included', async () => {
  const f = faked({}, { 'models.authStatus': (p: any) => ({ providers: p.agentId === 'byokit-key-m1' ? [{ provider: 'openrouter' }] : [] }), 'byokit.catalog': () => ({ ok: true, models: [
    { id: 'minimax/minimax-m3.1-flash:free', name: 'MiniMax M3.1 Flash (free)', api: 'openai-completions' },
    { id: 'deepseek/deepseek-v4', name: 'DeepSeek V4', api: 'openai-completions' },
  ] }) } as {});
  try {
    await f.started;
    const steps: { done?: boolean; error?: string }[] = [];
    const signIn = f.runtime.signIn('openrouter', 'key', (s) => steps.push(s));
    await signIn.paste('fixture-openrouter-key');
    for (let i = 0; i < 100 && !steps.some((s) => s.done || s.error); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(steps.some((s) => s.done), JSON.stringify(steps));
    assert.deepEqual((await f.runtime.models('openrouter')).map((m) => m.id), ['minimax/minimax-m3.1-flash:free', 'deepseek/deepseek-v4']);
  } finally { await f.done(); }
});
