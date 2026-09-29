import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import type { RunSpec } from '../src/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';

const provider = (url: string, apiKey: string) => ({ baseUrl: url, apiKey, api: 'openai-completions',
  models: [{ id: 'test', name: 'Test', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] });

test('real Gateway tool call crosses fail-closed Crewhouse gate', { timeout: 420_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-run-'));
  const stub = await startModelStub();
  const gated: string[] = [];
  let called = 0;
  const runtime = new OpenClawRuntime(state);
  const { kit } = runtime;
  const spec = (key: string, member: number, bot: string, task: number, message: string): RunSpec =>
    ({ key, member, bot, task, account: 'chatgpt', cwd: '', system: `You are ${bot}. Your id in Crewhouse is ${bot}.`, message, builtins: [] });
  try {
    await runtime.start({
      tools: () => [],
      gate: async (_run, tool) => { gated.push(tool); return ['crew_report', 'crew_web_fetch'].includes(tool) ? { allow: true } : { allow: false, reason: 'Unknown tool' }; },
      call: async (_run, tool, input) => { called++; return tool === 'crew_report' ? `Progress: ${input.text}` : 'Safe page'; },
    });
    await runtime.configureModelProvider(stub.url, 'stub-m1');
    const { workspace } = await kit.ensureMember('m1');
    writeFileSync(join(workspace, 'MEMORY.md'), 'The blue lantern marks the kitchen door.');
    assert.equal(JSON.parse(readFileSync(join(state, 'openclaw/openclaw.json'), 'utf8')).memory.search.provider, 'none');
    await assert.rejects(kit.call('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:cwd-probe',
      message: 'hello', cwd: join(state, 'bot'), idempotencyKey: 'cwd-probe' } as any), /cwd is reserved for plugin-owned subagent runs/);
    const tools: string[] = [];
    const end = await runtime.run(spec('agent:m1:crewhouse:chief:1', 1, 'chief', 1, '[tool crew_report {"text":"Working"}]'),
      (e) => { if (e.type === 'tool') tools.push(`${e.name}:${e.phase}`); });
    assert.ok(end.ok, JSON.stringify(end));
    assert.ok(gated.includes('crew_report'), `the hook was skipped: ${JSON.stringify(end)} ${JSON.stringify(tools)} ${JSON.stringify(stub.calls.map((c) => c.path))}`);
    assert.equal(called, 1, 'tool bypassed the gate or failed to execute');
    assert.ok(tools.includes('crew_report:start'), JSON.stringify(tools));
    assert.ok(stub.calls.length > 0);
    // Keyword memory recall: free, never a paid embedding request.
    const keyword = await kit.call('tools.invoke', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:memory', name: 'memory_search', args: { query: 'blue lantern' } } as any) as any;
    assert.equal(keyword.ok, true, JSON.stringify(keyword).slice(0, 500));
    assert.ok(JSON.stringify(keyword.output).includes('blue lantern'), JSON.stringify(keyword).slice(0, 600));
    assert.ok(stub.calls.every((call) => !/embeddings/.test(call.path)), 'keyword-only memory attempted a paid embedding request');
    const read = await runtime.run(spec('agent:m1:crewhouse:scout:3', 1, 'scout', 3, '[tool crew_web_fetch {"url":"https://example.test/"}]'), () => {});
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(called, 2, 'fenced web read did not use the Crewhouse copy');
    // Every tool the engine runs crosses the gate, its own builtins included: a fenced helper's gate refuses the
    // engine's web_fetch (src/net.ts), and an unknown tool fails closed.
    const before = gated.length;
    await runtime.run(spec('agent:m1:crewhouse:scout:5', 1, 'scout', 5, '[tool web_fetch {"url":"https://example.test/"}]'), () => {});
    assert.deepEqual(gated.slice(before), ['web_fetch'], 'an engine builtin ran without the Crewhouse gate');

    // A5: a second member's agent carries its own credential; no request of its session ever uses member 1's key.
    await kit.ensureMember('m2');
    await kit.patchConfig({ models: { providers: { 'crewhouse-stub-two': provider(stub.url, 'stub-m2') } },
      agents: { entries: { m2: { model: { primary: 'crewhouse-stub-two/test' } } } } });
    const stubCallsBefore = stub.calls.length;
    await runtime.run(spec('agent:m2:crewhouse:scout:9', 2, 'scout', 9, 'hello from member two'), () => {});
    const m2Keys = stub.calls.slice(stubCallsBefore).map((c) => c.authorization);
    assert.ok(m2Keys.length > 0, "member two's run reached the stub provider");
    assert.ok(m2Keys.every((k) => k === 'Bearer stub-m2'), `member two's session only ever used its own key: ${m2Keys.join()}`);
    // A member never speaks in another member's session.
    const crossed = await runtime.run(spec('agent:m1:crewhouse:scout:9', 2, 'scout', 9, 'hello'), () => {});
    assert.ok(!crossed.ok && 'message' in crossed && /refused/.test(crossed.message), JSON.stringify(crossed));

    await kit.patchConfig({ memory: { search: { provider: 'ollama', model: 'local-test', remote: { baseUrl: stub.url.replace(/\/v1$/, '') } } } });
    await runtime.stop();
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no runs here' }), call: async () => 'no calls here' });
    const { workspace: ws3 } = await kit.ensureMember('m3');
    writeFileSync(join(ws3, 'MEMORY.md'), 'A green umbrella is by the door.');
    const local = await kit.call('tools.invoke', { agentId: 'm3', sessionKey: 'agent:m3:crewhouse:scout:local', name: 'memory_search', args: { query: 'green umbrella' } } as any) as any;
    assert.equal(local.ok, true, JSON.stringify(local).slice(0, 500));
    assert.ok(JSON.stringify(local.output).includes('green umbrella'), JSON.stringify(local).slice(0, 600));
    assert.ok(stub.calls.some((call) => call.path === '/api/embed'), `configured local embedding route was not used: ${JSON.stringify(local).slice(0, 500)}; paths ${stub.calls.map((c) => c.path).join(',')}`);
    assert.ok(stub.calls.every((call) => !/\/v1\/embeddings/.test(call.path)), 'API-billed embeddings were requested');

    // A session Crewhouse never registered: the gate refuses before any crew tool runs.
    const denied = await kit.call('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:2',
      message: '[tool crew_report {"text":"Not authorized"}]', idempotencyKey: 'test-2' } as any) as { runId: string };
    const stopped = await kit.call('agent.wait', { runId: denied.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 }) as any;
    assert.deepEqual(stopped.terminalReceipt?.successfulToolNames ?? [], []);
    assert.equal(called, 2);
  } finally { await runtime.stop(); await stub.close(); rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});
