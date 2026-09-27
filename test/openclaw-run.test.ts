import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawGateway } from '../src/openclaw/gateway.ts';
import { ToolBridge } from '../src/openclaw/bridge.ts';
import { modelStub } from './openclaw-model.ts';

test('real Gateway tool call crosses fail-closed Crewhouse gate', { timeout: 120_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-run-'));
  const stub = await modelStub();
  let gated = 0, called = 0;
  const bridge = new ToolBridge(state, {
    tools: () => [],
    gate: async (_run, tool) => { gated++; return ['crew_report', 'crew_web_fetch'].includes(tool) ? { allow: true } : { allow: false, reason: 'Unknown tool' }; },
    call: async (_run, tool, input) => { called++; return tool === 'crew_report' ? `Progress: ${input.text}` : 'Safe page'; },
  });
  const gateway = new OpenClawGateway(state);
  try {
    await bridge.start();
    const client = await gateway.start();
    const before = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: before.hash, raw: JSON.stringify({
      models: { catalogRefresh: { enabled: false }, providers: { 'crewhouse-stub': {
        baseUrl: stub.url, apiKey: 'stub-m1', api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
      } } },
      agents: { defaults: { model: { primary: 'crewhouse-stub/test' } } },
    }) });
    await client.request('agents.create', { name: 'm1', workspace: join(state, 'workspace') });
    await assert.rejects(client.request('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:cwd-probe',
      message: 'hello', cwd: join(state, 'bot'), idempotencyKey: 'cwd-probe' }), /cwd is reserved for plugin-owned subagent runs/);
    const key = 'agent:m1:crewhouse:chief:1';
    bridge.register({ key, member: 1, bot: 'chief', task: 1 });
    const streams: any[] = [];
    const unsubscribe = gateway.onEvent((event) => { if (event.event === 'agent') streams.push(event.payload); });
    const run = await client.request<any>('agent', { agentId: 'm1', sessionKey: key,
      message: '[tool crew_report {"text":"Working"}]',
      extraSystemPrompt: 'You are Chief. Your id in Crewhouse is chief.', idempotencyKey: 'test-1' });
    assert.ok(run.runId, JSON.stringify(run));
    const finished = await client.request<any>('agent.wait', { runId: run.runId, timeoutMs: 60_000 });
    assert.ok(finished, 'No run result');
    assert.ok(gated > 0, 'the hook was skipped');
    assert.equal(called, 1, 'tool bypassed the gate or failed to execute');
    assert.ok(stub.calls.length > 0);
    bridge.register({ key: 'agent:m1:crewhouse:scout:3', member: 1, bot: 'scout', task: 3 });
    const read = await client.request<any>('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:scout:3',
      message: '[tool crew_web_fetch {"url":"https://example.test/"}]', idempotencyKey: 'fetch-3' });
    const readDone = await client.request<any>('agent.wait', { runId: read.runId, timeoutMs: 60_000 });
    assert.ok(readDone.terminalReceipt?.successfulToolNames?.includes('crew_web_fetch'), JSON.stringify(readDone).slice(0, 600));
    assert.equal(called, 2, 'fenced web read did not use the Crewhouse copy');
    assert.ok(streams.some((event) => event.runId === run.runId && event.stream === 'tool'));
    unsubscribe();
    bridge.unregister(key);
    const denied = await client.request<any>('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:2',
      message: '[tool crew_report {"text":"Not authorized"}]', idempotencyKey: 'test-2' });
    const stopped = await client.request<any>('agent.wait', { runId: denied.runId, timeoutMs: 60_000 });
    assert.deepEqual(stopped.terminalReceipt?.successfulToolNames ?? [], []);
    assert.equal(called, 2);
  } finally { await gateway.stop(); bridge.stop(); await stub.close(); rmSync(state, { recursive: true, force: true }); }
});
