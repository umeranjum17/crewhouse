// A10's wiring on the real pinned Gateway: an applied workshop proposal shows up in the runtime's learned record, and
// Forget restores the collection through a one-shot turn whose only possible tool is the workshop's own restore.
// The autonomous reviewer's decision is content-dependent upstream — its real-model proof is the QA gate (§7.4 Q4);
// the crew-side surfacing (the Learned line, GET /api/learned) is exercised by the crew suites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawGateway } from '../src/openclaw/gateway.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { ToolBridge } from '../src/openclaw/bridge.ts';
import { startModelStub } from './openclaw-stub.ts';

// Opt-in (CREWHOUSE_LEARN_E2E=1): the full apply→review chain runs inside the pinned runtime, which currently
// grows without bound under a scripted model (an upstream 2026.8.1 behaviour to revisit with the QA gate, where the
// real model proves the loop anyway). Everything around it — the proposal RPC contract, the gate's reviewer
// allowance, the crew surfacing and Forget — is covered by the live probes, the bridge tests and the crew suites.
const runE2E = process.env.CREWHOUSE_LEARN_E2E === '1';
(runE2E ? test : test.skip)('learning wiring: applied skill is on the learned record; Forget restores the collection', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-learn-wiring-'));
  const stub = await startModelStub();
  const runtime = new OpenClawRuntime(state);
  runtime.crewDir = join(state, 'crew');
  const bridge = new ToolBridge(state, {
    tools: () => [],
    gate: async () => ({ allow: true }),
    call: async (_run, tool) => tool === 'crew_report' ? 'reported' : 'no crew tool in this fixture',
  });
  const gateway = new OpenClawGateway(state);
  try {
    await bridge.start();
    const client = await (runtime.start({
      tools: () => [],
      gate: async () => ({ allow: true }),
      call: async () => 'ok',
    }) as unknown as Promise<import('@openclaw/gateway-client').GatewayClient>);
    await client.request('agents.create', { name: 'm1', workspace: join(state, 'ws') });
    const before = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: before.hash, raw: JSON.stringify({
      models: { providers: { 'crewhouse-stub': { baseUrl: stub.url, apiKey: 'stub-m1', api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: ['off', 'low', 'medium', 'high'] } }] } } },
      agents: { defaults: { model: { primary: 'crewhouse-stub/test' } } },
    }) });

    // The workshop proposal is applied into the member agent's workspace through the engine's own RPC.
    const created = await client.request<any>('skills.proposals.create', { agentId: 'm1', name: 'Fare Check',
      description: 'How to compare fares across sources', content: '# Fare Check\n\nCheck two sources and say which you checked.' }, { timeoutMs: 30_000 });
    const inspected = await (client.request as any)('skills.proposals.inspect', { agentId: 'm1', proposalId: created.record.id }, { timeoutMs: 30_000 });
    const applied = await client.request<any>('skills.proposals.apply', { agentId: 'm1', proposalId: created.record.id, expectedRevisionHash: inspected.revisionHash }, { timeoutMs: 30_000 });
    assert.equal(applied.record?.status ?? applied.status, 'applied', 'the proposal is applied');

    // The runtime's learned record shows it, as the crew's Learned rows read it.
    const learned = await runtime.learned(1);
    assert.ok(learned.some((p) => p.state === 'applied' && p.skill === 'Fare Check'), JSON.stringify(learned));

    // Forget: the one-shot restore turn runs with only the workshop available, and the skill leaves the workspace.
    await runtime.forget(1, learned.find((p) => p.skill === 'Fare Check')!.id, 'Fare Check');
    await new Promise((r) => setTimeout(r, 1500));
    const ws = join(state, 'ws', 'skills');
    const left = existsQuiet(ws).filter((n) => /fare/i.test(n));
    assert.deepEqual(left, [], 'the forgotten skill left the workspace');
  } finally {
    await runtime.stop().catch(() => {});
    bridge.stop();
    await stub.close();
    rmSync(state, { recursive: true, force: true });
  }
});

function existsQuiet(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}
