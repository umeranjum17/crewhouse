// A10's wiring on the real pinned Gateway: an applied workshop proposal shows up in the runtime's learned record, and
// Forget restores the collection through a one-shot turn whose only possible tool is the workshop's own restore.
// The autonomous reviewer's decision is content-dependent upstream — its real-model proof is the QA gate (§7.4 Q4);
// the crew-side surfacing (the Learned line, GET /api/learned) is exercised by the crew suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';

// Opt-in (CREWHOUSE_LEARN_E2E=1): the full apply→review chain runs inside the pinned runtime, which currently
// grows without bound under a scripted model (an upstream 2026.8.1 behaviour to revisit with the QA gate, where the
// real model proves the loop anyway). Everything around it — the proposal RPC contract, the gate's reviewer
// allowance, the crew surfacing and Forget — is covered by the live probes, the bridge tests and the crew suites.
const runE2E = process.env.CREWHOUSE_LEARN_E2E === '1';
(runE2E ? test : test.skip)('learning wiring: applied skill is on the learned record; Forget restores the collection', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-learn-wiring-'));
  const stub = await startModelStub();
  const runtime = new OpenClawRuntime(state, join(state, 'crew'));
  const { kit } = runtime;
  try {
    await runtime.start({ tools: () => [], gate: async () => ({ allow: true }), call: async (_run, tool) => tool === 'crew_report' ? 'reported' : 'no crew tool in this fixture' });
    await kit.ensureMember('m1');
    await runtime.configureModelProvider(stub.url, 'stub-m1');

    // The workshop proposal is applied into the member agent's workspace through the engine's own RPC.
    const created = await kit.call('skills.proposals.create', { agentId: 'm1', name: 'Fare Check',
      description: 'How to compare fares across sources', content: '# Fare Check\n\nCheck two sources and say which you checked.' }, { timeoutMs: 30_000 }) as any;
    const inspected = await kit.call('skills.proposals.inspect', { agentId: 'm1', proposalId: created.record.id }, { timeoutMs: 30_000 }) as any;
    const applied = await kit.call('skills.proposals.apply', { agentId: 'm1', proposalId: created.record.id, expectedRevisionHash: inspected.revisionHash }, { timeoutMs: 30_000 }) as any;
    assert.equal(applied.record?.status ?? applied.status, 'applied', 'the proposal is applied');

    // The runtime's learned record shows it, as the crew's Learned rows read it.
    const learned = await runtime.learned();
    assert.ok(learned.some((p) => p.state === 'applied' && p.skill === 'Fare Check'), JSON.stringify(learned));

    // Forget: the one-shot restore turn runs with only the workshop available, and the skill leaves the workspace.
    await runtime.forget(learned.find((p) => p.skill === 'Fare Check')!.id, 'Fare Check');
    const left = () => existsQuiet(runtime.workspaceOf()).filter((n) => /fare/i.test(n));
    for (const until = Date.now() + 10_000; left().length && Date.now() < until;) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(left(), [], 'the forgotten skill left the workspace');
  } finally {
    await runtime.stop().catch(() => {});
    await stub.close();
    rmSync(state, { recursive: true, force: true });
  }
});

function existsQuiet(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}
