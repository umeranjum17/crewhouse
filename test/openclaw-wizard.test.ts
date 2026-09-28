// The sign-in wizard drive, against the contract the pinned gateway actually speaks (2026.8.1):
// steps are delivered only by pulling wizard.next — wizard.status answers {status, error} and never
// carries a step (the .10 F2 deadlock) — and a session left running holds the engine's single setup
// admission, so a sign-in that gives up must wizard.cancel its own session.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawGateway } from '../src/openclaw/gateway.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';

test('real gateway: wizard.status carries no step, wizard.next pulls one, cancel frees admission', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-wizard-'));
  const gateway = new OpenClawGateway(state);
  try {
    const client = await gateway.start();
    await client.request('agents.create', { name: 'm1', workspace: join(state, 'openclaw/workspaces/m1') });
    const started = await client.request<{ sessionId: string; done?: boolean; status?: string }>('openclaw.setup.auth.start',
      { sessionId: 'crewhouse-test-wizard', agentId: 'm1', authChoice: 'openai-device-code' }, { timeoutMs: 60_000 });
    assert.equal(started.done, false);
    assert.equal(started.status, 'running');
    // The contract that deadlocked the old poll loop: status alone never yields a step.
    const status = await client.request<Record<string, unknown>>('wizard.status', { sessionId: started.sessionId }, { timeoutMs: 20_000 });
    assert.ok(!('step' in status), `wizard.status carried a step: ${JSON.stringify(status)}`);
    assert.equal(status.status, 'running');
    // Pulling does: the first step arrives (pre-network progress; a device-code note when the provider answers).
    const pulled = await client.request<{ done?: boolean; step?: any }>('wizard.next', { sessionId: started.sessionId }, { timeoutMs: 120_000 });
    assert.equal(pulled.done, false);
    assert.ok(pulled.step?.id && pulled.step?.type, `wizard.next yielded no step: ${JSON.stringify(pulled)}`);
    // Supported cancellation of this session only — and the setup admission is free again right after.
    const cancelled = await client.request<{ status?: string }>('wizard.cancel', { sessionId: started.sessionId }, { timeoutMs: 10_000 });
    assert.equal(cancelled.status, 'cancelled');
    const retry = await (async () => {
      for (let waited = 0; waited < 15_000; waited += 500) {
        const ok = await client.request<{ sessionId: string }>('openclaw.setup.auth.start',
          { sessionId: 'crewhouse-test-wizard-2', agentId: 'm1', authChoice: 'openai-device-code' }, { timeoutMs: 30_000 }).catch(() => undefined);
        if (ok) return ok;
        await new Promise((r) => setTimeout(r, 500));
      }
      return undefined;
    })();
    assert.ok(retry, 'setup admission still busy 15s after wizard.cancel');
    await client.request('wizard.cancel', { sessionId: retry.sessionId }, { timeoutMs: 10_000 }).catch(() => {});
  } finally { await gateway.stop(); }
});

/** A GatewayClient stand-in that speaks the wizard contract from a script, recording every method. */
function scripted(handlers: Record<string, (params: any, opts?: any) => unknown>) {
  const calls: { method: string; params?: any }[] = [];
  return {
    calls,
    async request(method: string, params?: any, opts?: any) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected method ${method}`);
      return await handler(params, opts);
    },
  };
}

const DEVICE_STEP = { id: 'step-device', type: 'note', executor: 'client',
  deviceCode: { code: 'CREW-2026', expiresInMinutes: 15 }, externalUrl: 'https://auth.openai.com/codex/device' };

test('sign-in: the code is pulled and shown, the card finishes when the engine does', async () => {
  const runtime = new OpenClawRuntime(join(mkdtempSync(join(tmpdir(), 'crewhouse-wizloop-')), 'state'));
  const fake = scripted({
    'agents.list': () => ({ agents: [{ id: 'm1' }] }),
    'openclaw.setup.auth.start': () => ({ sessionId: 'crewhouse-fake-1', done: false, status: 'running' }),
    'wizard.next': (() => {
      let answered = false, waiting = 0;
      return (params: any) => {
        if (params.answer) { answered = true; return { done: false, step: { id: 'step-wait', type: 'progress', message: 'Waiting for authorization', executor: 'gateway' } }; }
        if (!answered) return { done: false, step: DEVICE_STEP };
        if (waiting++ === 0) return { done: false, step: { id: 'step-wait', type: 'progress', message: 'Waiting for authorization', executor: 'gateway' } };
        return { done: true, status: 'done', modelActivation: { modelRef: 'openai/gpt-5.1' } };
      };
    })(),
  });
  (runtime as any).client = fake;
  const seen = new Promise<any>((resolve) => {
    runtime.signIn(1, 'chatgpt', 'code', (step) => { if (!step.waiting) resolve(step); });
  });
  const end = await seen;
  assert.equal(end.done, true, `expected done, got ${JSON.stringify(end)}`);
  assert.deepEqual(fake.calls.map((c) => c.method).filter((m, i, a) => a.indexOf(m) === i), ['agents.list', 'openclaw.setup.auth.start', 'wizard.next'],
    'the drive pulls steps; wizard.status is not part of it');
  assert.match(fake.calls[1].params.sessionId, /^crewhouse-/);
  assert.equal(fake.calls[1].params.authChoice, 'openai-device-code');
  const ack = fake.calls.find((c) => c.params?.answer);
  assert.equal(ack?.params.answer.stepId, 'step-device', 'the shown device-code note is the step acknowledged');
  const shown = fake.calls.filter((c) => c.method === 'openclaw.setup.auth.start');
  assert.equal(shown.length, 1, 'the session is started once');
});

test('sign-in: giving up cancels its own wizard session, so a retry is not locked out', async () => {
  const runtime = new OpenClawRuntime(join(mkdtempSync(join(tmpdir(), 'crewhouse-wizloop-')), 'state'));
  const fake = scripted({
    'agents.list': () => ({ agents: [{ id: 'm1' }] }),
    'openclaw.setup.auth.start': () => ({ sessionId: 'crewhouse-fake-2', done: false, status: 'running' }),
    // A wizard that never yields a step: the drive runs out its budget instead of waiting forever.
    'wizard.next': () => ({ done: false }),
    'wizard.cancel': () => ({ status: 'cancelled', error: 'cancelled' }),
  });
  (runtime as any).client = fake;
  const end = await new Promise<any>((resolve) => {
    runtime.signIn(1, 'chatgpt', 'code', (step) => { if (!step.waiting) resolve(step); });
  });
  assert.match(end.error ?? '', /took too long/);
  const cancels = fake.calls.filter((c) => c.method === 'wizard.cancel');
  assert.deepEqual(cancels.map((c) => c.params.sessionId), ['crewhouse-fake-2'], 'only this task-owned session is cancelled');
});

test('sign-in: the person cancels, the wizard session is cancelled with it', async () => {
  const runtime = new OpenClawRuntime(join(mkdtempSync(join(tmpdir(), 'crewhouse-wizloop-')), 'state'));
  let pulls = 0;
  const fake = scripted({
    'agents.list': () => ({ agents: [{ id: 'm1' }] }),
    'openclaw.setup.auth.start': () => ({ sessionId: 'crewhouse-fake-3', done: false, status: 'running' }),
    'wizard.next': (_params: any, opts?: any) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ done: false, step: { id: `p${pulls++}`, type: 'progress', message: 'polling', executor: 'gateway' } }), 5_000);
      opts?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }),
    'wizard.cancel': () => ({ status: 'cancelled', error: 'cancelled' }),
  });
  (runtime as any).client = fake;
  const handle = runtime.signIn(1, 'chatgpt', 'code', () => {});
  await new Promise((r) => setTimeout(r, 100));
  handle.cancel();
  for (let waited = 0; waited < 5_000 && !fake.calls.some((c) => c.method === 'wizard.cancel'); waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const cancels = fake.calls.filter((c) => c.method === 'wizard.cancel');
  assert.deepEqual(cancels.map((c) => c.params.sessionId), ['crewhouse-fake-3']);
});
