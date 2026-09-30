// Sign-in through the kit's drive of the engine's own wizard. The real-gateway half pins the contract the pinned
// engine speaks (2026.8.1): steps arrive only by pulling wizard.next — wizard.status answers {status, error} and never
// carries a step — and a session left running holds the engine's single setup admission, so a sign-in that gives up
// must wizard.cancel its own session. The scripted half checks the card words Crewhouse shows for each ending.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SignInStep } from '../src/runtime.ts';

const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => r(port)); }); });
process.env.CREWHOUSE_CALLBACK_PORT ??= String(await free());
const { OpenClawRuntime } = await import('../src/openclaw/runtime.ts');
const { faked } = await import('./kit-fake.ts');
const { CALLBACK_PORT } = await import('../src/callback-port.ts');

const ending = (start: (on: (s: SignInStep) => void) => unknown) => new Promise<SignInStep>((resolve) => { start((s) => { if (!s.waiting) resolve(s); }); });

test('real gateway: wizard.status carries no step, wizard.next pulls one, cancel frees admission', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-wizard-'));
  const runtime = new OpenClawRuntime(state);
  const { kit } = runtime;
  try {
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no runs here' }), call: async () => 'no calls here' });
    await kit.ensureMember('m1');
    const started = await kit.call('openclaw.setup.auth.start',
      { sessionId: 'crewhouse-test-wizard', agentId: 'm1', authChoice: 'openai-device-code' }, { timeoutMs: 60_000 }) as { sessionId: string; done?: boolean; status?: string };
    assert.equal(started.done, false);
    assert.equal(started.status, 'running');
    // The contract that deadlocked the old poll loop: status alone never yields a step.
    const status = await kit.call('wizard.status', { sessionId: started.sessionId }, { timeoutMs: 20_000 }) as Record<string, unknown>;
    assert.ok(!('step' in status), `wizard.status carried a step: ${JSON.stringify(status)}`);
    assert.equal(status.status, 'running');
    // Pulling does: the first step arrives (pre-network progress; a device-code note when the provider answers).
    const pulled = await kit.call('wizard.next', { sessionId: started.sessionId }, { timeoutMs: 120_000 }) as { done?: boolean; step?: any };
    assert.equal(pulled.done, false);
    assert.ok(pulled.step?.id && pulled.step?.type, `wizard.next yielded no step: ${JSON.stringify(pulled)}`);
    // Supported cancellation of this session only — and the setup admission is free again right after.
    const cancelled = await kit.call('wizard.cancel', { sessionId: started.sessionId }, { timeoutMs: 10_000 }) as { status?: string };
    assert.equal(cancelled.status, 'cancelled');
    let retry: { sessionId: string } | undefined;
    for (const until = Date.now() + 15_000; !retry && Date.now() < until;) {
      retry = await kit.call('openclaw.setup.auth.start', { sessionId: 'crewhouse-test-wizard-2', agentId: 'm1', authChoice: 'openai-device-code' },
        { timeoutMs: 30_000 }).catch(() => undefined) as { sessionId: string } | undefined;
      if (!retry) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(retry, 'setup admission still busy 15s after wizard.cancel');
    await kit.call('wizard.cancel', { sessionId: retry.sessionId }, { timeoutMs: 10_000 }).catch(() => {});
  } finally { await kit.stop(); rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});

test('sign-in: the code is shown, and the card finishes when the engine does', async () => {
  const f = faked();
  try {
    await f.started;
    const steps: SignInStep[] = [];
    const end = await ending((on) => f.runtime.signIn('chatgpt', 'code', (s) => { steps.push(s); on(s); }));
    assert.equal(end.done, true, JSON.stringify(end));
    assert.ok(steps.some((s) => s.code === 'CREW-2026' && s.waiting), 'the device code reached the card');
    const start = f.fake.calls.find((c) => c.method === 'openclaw.setup.auth.start')!.params as any;
    assert.deepEqual([start.agentId, start.authChoice], ['m1', 'openai-device-code']);
    assert.ok(!f.fake.calls.some((c) => c.method === 'wizard.status'), 'the drive pulls steps; wizard.status is not part of it');
    assert.equal(await f.runtime.signedIn('chatgpt'), true);
  } finally { await f.done(); }
});

test('sign-in: giving up cancels its own wizard session, in the account\'s own words', async () => {
  const f = faked({}, { 'wizard.next': () => ({ done: false }) });
  try {
    await f.started;
    const end = await ending((on) => f.runtime.signIn('grok', 'code', on));
    assert.match(end.error ?? '', /took too long.*Grok/);
    assert.doesNotMatch(end.error ?? '', /ChatGPT/);
    const cancels = f.fake.calls.filter((c) => c.method === 'wizard.cancel');
    assert.equal(cancels.length, 1, 'only this sign-in\'s own session is cancelled');
  } finally { await f.done(); }
});

test('sign-in: the browser comes back to the callback port, and the address reaches the wizard', async () => {
  let pasted = '';
  const f = faked({}, {
    'wizard.next': (p: any) => {
      if (!p.answer) return { done: false, step: { id: 'paste', type: 'text', externalUrl: 'https://auth.openai.com/oauth/authorize?x=1' } };
      pasted = p.answer.value;
      return { done: true, status: 'done' };
    },
  });
  try {
    await f.started;
    const steps: SignInStep[] = [];
    const finished = ending((on) => f.runtime.signIn('chatgpt', 'browser', (s) => { steps.push(s); on(s); }));
    let back: Response | undefined;
    for (const until = Date.now() + 5_000; !back && Date.now() < until;)
      back = await fetch(`http://127.0.0.1:${CALLBACK_PORT}/auth/callback?code=good&state=st`).catch(() => new Promise<undefined>((r) => setTimeout(r, 50)));
    assert.ok(back, 'the callback port answered');
    assert.match(await back.text(), /go back to the app now/);
    assert.equal((await finished).done, true);
    assert.match(pasted, /code=good&state=st/, 'the full redirect address went to the wizard');
  } finally { await f.done(); }
});

test('sign-in: a callback port already taken is said plainly, and blames no account', async () => {
  const f = faked();
  const taken = createServer();
  await new Promise<void>((r) => taken.listen(CALLBACK_PORT, '127.0.0.1', r));
  try {
    await f.started;
    const end = await ending((on) => f.runtime.signIn('chatgpt', 'browser', on));
    assert.match(end.error ?? '', /Another sign-in is already in progress/);
    assert.doesNotMatch(end.error ?? '', /ChatGPT/);
  } finally { taken.close(); await f.done(); }
});

test('sign-in: the person cancels, the wizard session is cancelled with it and the card stays quiet', async () => {
  const f = faked({}, { 'wizard.next': () => new Promise(() => {}) });
  try {
    await f.started;
    const steps: SignInStep[] = [];
    const handle = f.runtime.signIn('chatgpt', 'code', (s) => steps.push(s));
    for (const until = Date.now() + 5_000; !f.fake.calls.some((c) => c.method === 'wizard.next') && Date.now() < until;) await new Promise((r) => setTimeout(r, 20));
    handle.cancel();
    for (const until = Date.now() + 5_000; !f.fake.calls.some((c) => c.method === 'wizard.cancel') && Date.now() < until;) await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.fake.calls.filter((c) => c.method === 'wizard.cancel').length, 1);
    assert.ok(!steps.some((s) => s.error), 'a cancel is the person\'s own doing, not an error on the card');
  } finally { await f.done(); }
});
