import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawGateway } from '../src/openclaw/gateway.ts';
import { ToolBridge } from '../src/openclaw/bridge.ts';
import { startModelStub } from './openclaw-stub.ts';

test('real Gateway tool call crosses fail-closed Crewhouse gate', { timeout: 420_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-run-'));
  const stub = await startModelStub();
  let gated = 0, called = 0;
  const bridge = new ToolBridge(state, {
    tools: () => [],
    gate: async (_run, tool) => { gated++; return ['crew_report', 'crew_web_fetch', 'memory_search'].includes(tool) ? { allow: true } : { allow: false, reason: 'Unknown tool' }; },
    call: async (_run, tool, input) => { called++; return tool === 'crew_report' ? `Progress: ${input.text}` : 'Safe page'; },
  });
  const gateway = new OpenClawGateway(state);
  try {
    await bridge.start();
    let client = await gateway.start();
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
    writeFileSync(join(state, 'workspace', 'MEMORY.md'), 'The blue lantern marks the kitchen door.');
    assert.equal(JSON.parse(readFileSync(join(state, 'openclaw/openclaw.json'), 'utf8')).memory.search.provider, 'none');
    await assert.rejects(client.request('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:cwd-probe',
      message: 'hello', cwd: join(state, 'bot'), idempotencyKey: 'cwd-probe' }), /cwd is reserved for plugin-owned subagent runs/);
    const key = 'agent:m1:crewhouse:chief:1';
    bridge.register({ key, member: 1, bot: 'chief', task: 1 });
    const streams: any[] = [];
    const unsubscribe = gateway.onEvent((event) => { if (event.event === 'agent') { const p = event.payload; streams.push({ runId: p?.runId, stream: p?.stream, name: p?.data?.name }); } });
    const run = await client.request<any>('agent', { agentId: 'm1', sessionKey: key,
      message: '[tool crew_report {"text":"Working"}]',
      extraSystemPrompt: 'You are Chief. Your id in Crewhouse is chief.', idempotencyKey: 'test-1' });
    assert.ok(run.runId, JSON.stringify(run));
    const finished = await client.request<any>('agent.wait', { runId: run.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 });
    assert.ok(finished, 'No run result');
    assert.ok(gated > 0, 'the hook was skipped');
    assert.equal(called, 1, 'tool bypassed the gate or failed to execute');
    assert.ok(stub.calls.length > 0);
    const memoryKey = 'agent:m1:crewhouse:chief:memory';
    bridge.register({ key: memoryKey, member: 1, bot: 'chief', task: 4 });
    const keyword = await client.request<any>('tools.invoke', { agentId: 'm1', sessionKey: memoryKey, name: 'memory_search', args: { query: 'blue lantern' } });
    assert.equal(keyword.ok, true, JSON.stringify(keyword).slice(0, 500));
    assert.ok(JSON.stringify(keyword.output).includes('blue lantern'), JSON.stringify(keyword).slice(0, 600));
    assert.ok(stub.calls.every((call) => !/embeddings/.test(call.path)), 'keyword-only memory attempted a paid embedding request');
    bridge.register({ key: 'agent:m1:crewhouse:scout:3', member: 1, bot: 'scout', task: 3 });
    const read = await client.request<any>('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:scout:3',
      message: '[tool crew_web_fetch {"url":"https://example.test/"}]', idempotencyKey: 'fetch-3' });
    const readDone = await client.request<any>('agent.wait', { runId: read.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 });
    assert.ok(readDone.terminalReceipt?.successfulToolNames?.includes('crew_web_fetch'), JSON.stringify(readDone).slice(0, 600));
    assert.equal(called, 2, 'fenced web read did not use the Crewhouse copy');
    assert.ok(streams.some((event) => event.runId === run.runId && event.stream === 'tool'), JSON.stringify(streams).slice(0, 200));

    // A5: a second member's agent carries its own credential; no request of its session ever uses member 1's key.
    await client.request('agents.create', { name: 'm2', workspace: join(state, 'ws2') });
    const cfgTwo = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: cfgTwo.hash, raw: JSON.stringify({
      models: { providers: { 'crewhouse-stub-two': {
        baseUrl: stub.url, apiKey: 'stub-m2', api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: false, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
      } } },
      agents: { entries: { m2: { model: { primary: 'crewhouse-stub-two/test' } } } },
    }) });
    const stubCallsBefore = stub.calls.length;
    bridge.register({ key: 'agent:m2:crewhouse:scout:9', member: 2, bot: 'scout', task: 9 });
    const m2 = await client.request<any>('agent', { agentId: 'm2', sessionKey: 'agent:m2:crewhouse:scout:9',
      message: 'hello from member two', idempotencyKey: 'm2-1' });
    await client.request('agent.wait', { runId: m2.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 });
    const m2Keys = stub.calls.slice(stubCallsBefore).map((c) => c.authorization);
    assert.ok(m2Keys.length > 0, "member two's run reached the stub provider");
    assert.ok(m2Keys.every((k) => k === 'Bearer stub-m2'), `member two's session only ever used its own key: ${m2Keys.join()}`);

    const localConfig = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: localConfig.hash, raw: JSON.stringify({
      memory: { search: { provider: 'ollama', model: 'local-test', remote: { baseUrl: stub.url.replace(/\/v1$/, '') } } },
    }) });
    await gateway.stop();
    client = await gateway.start();
    await client.request('agents.create', { name: 'm3', workspace: join(state, 'ws3') });
    writeFileSync(join(state, 'ws3', 'MEMORY.md'), 'A green umbrella is by the door.');
    const localKey = 'agent:m3:crewhouse:scout:local';
    bridge.register({ key: localKey, member: 3, bot: 'scout', task: 10 });
    const local = await client.request<any>('tools.invoke', { agentId: 'm3', sessionKey: localKey, name: 'memory_search', args: { query: 'green umbrella' } });
    assert.equal(local.ok, true, JSON.stringify(local).slice(0, 500));
    assert.ok(JSON.stringify(local.output).includes('green umbrella'), JSON.stringify(local).slice(0, 600));
    assert.ok(stub.calls.some((call) => call.path === '/api/embed'), `configured local embedding route was not used: ${JSON.stringify(local).slice(0, 500)}; paths ${stub.calls.map((c) => c.path).join(',')}`);
    assert.ok(stub.calls.every((call) => !/\/v1\/embeddings/.test(call.path)), 'API-billed embeddings were requested');

    unsubscribe();
    bridge.unregister(key);
    const denied = await client.request<any>('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:2',
      message: '[tool crew_report {"text":"Not authorized"}]', idempotencyKey: 'test-2' });
    const stopped = await client.request<any>('agent.wait', { runId: denied.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 });
    assert.deepEqual(stopped.terminalReceipt?.successfulToolNames ?? [], []);
    assert.equal(called, 2);
  } finally { await gateway.stop(); bridge.stop(); await stub.close(); rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});
