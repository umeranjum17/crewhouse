import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import type { RunSpec, ToolHost } from '../src/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';

test('real Gateway tool call crosses fail-closed Crewhouse gate', { timeout: 420_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-run-'));
  const stub = await startModelStub();
  const gated: string[] = [];
  let called = 0;
  const runtime = new OpenClawRuntime(state);
  const { kit } = runtime;
  const spec = (key: string, bot: string, task: number, message: string): RunSpec =>
    ({ key, bot, task, account: 'chatgpt', cwd: '', system: `You are ${bot}. Your id in Crewhouse is ${bot}.`, message, builtins: [] });
  try {
    await runtime.start({
      tools: () => [],
      gate: async (_run, tool) => { gated.push(tool); return ['crew_report', 'crew_web_fetch', 'memory_search'].includes(tool) ? { allow: true } : { allow: false, reason: 'Unknown tool' }; },
      call: async (_run, tool, input) => { called++; return tool === 'crew_report' ? `Progress: ${input.text}` : 'Safe page'; },
    });
    await runtime.configureModelProvider(stub.url, 'stub-m1');
    const { workspace } = await kit.ensureMember('m1');
    writeFileSync(join(workspace, 'MEMORY.md'), 'The blue lantern marks the kitchen door.');
    assert.equal(JSON.parse(readFileSync(join(state, 'openclaw/openclaw.json'), 'utf8')).memory.search.provider, 'none');
    await assert.rejects(kit.call('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:cwd-probe',
      message: 'hello', cwd: join(state, 'bot'), idempotencyKey: 'cwd-probe' } as any), /cwd is reserved for plugin-owned subagent runs/);
    const tools: string[] = [];
    const end = await runtime.run(spec('agent:m1:crewhouse:chief:1', 'chief', 1, '[tool crew_report {"text":"Working"}]'),
      (e) => { if (e.type === 'tool') tools.push(`${e.name}:${e.phase}`); });
    assert.ok(end.ok, JSON.stringify(end));
    assert.ok(gated.includes('crew_report'), `the hook was skipped: ${JSON.stringify(end)} ${JSON.stringify(tools)} ${JSON.stringify(stub.calls.map((c) => c.path))}`);
    assert.equal(called, 1, 'tool bypassed the gate or failed to execute');
    assert.ok(tools.includes('crew_report:start'), JSON.stringify(tools));
    assert.ok(stub.calls.length > 0);
    // Keyword memory recall: free, never a paid embedding request.
    const outsider = await kit.call('tools.invoke', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:memory', name: 'memory_search', args: { query: 'blue lantern' } } as any) as any;
    assert.equal(outsider.ok, false, 'a session Crewhouse never registered cannot run even an engine builtin');
    const keyword = await runtime.run(spec('agent:m1:crewhouse:chief:4', 'chief', 4, '[tool memory_search {"query":"blue lantern"}]'), () => {});
    assert.ok(keyword.ok && keyword.text.includes('blue lantern'), JSON.stringify(keyword).slice(0, 600));
    assert.ok(stub.calls.every((call) => !/embeddings/.test(call.path)), 'keyword-only memory attempted a paid embedding request');
    const read = await runtime.run(spec('agent:m1:crewhouse:scout:3', 'scout', 3, '[tool crew_web_fetch {"url":"https://example.test/"}]'), () => {});
    assert.ok(read.ok, JSON.stringify(read));
    assert.equal(called, 2, 'fenced web read did not use the Crewhouse copy');
    // Every tool the engine runs crosses the gate, its own builtins included: a fenced helper's gate refuses the
    // engine's web_fetch (src/net.ts), and an unknown tool fails closed.
    const before = gated.length;
    await runtime.run(spec('agent:m1:crewhouse:scout:5', 'scout', 5, '[tool web_fetch {"url":"https://example.test/"}]'), () => {});
    assert.deepEqual(gated.slice(before), ['web_fetch'], 'an engine builtin ran without the Crewhouse gate');

    // A leftover agent's key is refused on m1.
    const beforeCrossed = stub.calls.length;
    const crossed = await runtime.run(spec('agent:m2:crewhouse:scout:9', 'scout', 9, 'hello'), () => {});
    assert.ok(!crossed.ok && 'message' in crossed && /refused/.test(crossed.message), JSON.stringify(crossed));
    assert.equal(stub.calls.length, beforeCrossed, 'a leftover session never reaches the provider on m1');

    // A session Crewhouse never registered: the gate refuses before any crew tool runs.
    const denied = await kit.call('agent', { agentId: 'm1', sessionKey: 'agent:m1:crewhouse:chief:2',
      message: '[tool crew_report {"text":"Not authorized"}]', idempotencyKey: 'test-2' } as any) as { runId: string };
    const stopped = await kit.call('agent.wait', { runId: denied.runId, timeoutMs: 240_000 }, { timeoutMs: 250_000 }) as any;
    assert.deepEqual(stopped.terminalReceipt?.successfulToolNames ?? [], []);
    assert.equal(called, 2);
  } finally { await runtime.stop(); await stub.close(); rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});

test('memory flush: crossing the soft threshold adds no silent provider turn; enabled control does', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-no-flush-'));
  // 64k context - 20k reserve - 4k soft = 40k flush threshold; below the 44k compaction threshold.
  // These are the local provider's scripted usage receipts, not a measurement from a real tokenizer.
  const receipt = (role: string, pid: number, home: string, port: string) => {
    if (!process.env.CREWHOUSE_GUARD_RECEIPT) return;
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    appendFileSync(process.env.CREWHOUSE_GUARD_RECEIPT, `${role}\t${pid}\t${start}\t${home}\t${port}\n`);
  };
  const stub = await startModelStub(40_001);
  assert.match(stub.url, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  receipt('provider', process.pid, process.env.HOME!, new URL(stub.url).port);
  const runtime = new OpenClawRuntime(state);
  const { kit } = runtime;
  const flush = (calls: typeof stub.calls) => calls.filter((c) =>
    /Continue the OpenClaw runtime event\./.test(JSON.stringify(c.body.messages.findLast((m: any) => m.role === 'user')?.content)) &&
    c.body.messages.some((m: any) => m.role === 'system' && /Pre-compaction memory flush turn\./.test(JSON.stringify(m.content))));
  const run = (key: string, message: string) => runtime.run({ key: `agent:m1:crewhouse:chief:${key}`, bot: 'chief', task: 1,
    account: 'chatgpt', cwd: '', system: 'Be brief.', message, builtins: [] }, () => {});
  try {
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no tools here' }), call: async () => 'no calls here' });
    receipt('gateway', Number(readFileSync(join(state, 'openclaw/gateway.pid'), 'utf8')),
      join(state, 'openclaw/home'), readFileSync(join(state, 'openclaw/port'), 'utf8').trim());
    await kit.patchConfig({ logging: { level: 'debug' } });
    const resolved = await kit.call('config.get', {}) as { config: any };
    assert.equal(resolved.config.agents.defaults.compaction.memoryFlush.enabled, false);
    assert.equal(resolved.config.agents.defaults.heartbeat.every, '0m');
    assert.equal(resolved.config.skills.workshop.approvalPolicy, 'auto');
    console.log(JSON.stringify({ resolvedDefaults: resolved.config.agents.defaults, workshop: resolved.config.skills.workshop, provider: stub.url }));
    await runtime.configureModelProvider(stub.url, 'stub-m1');
    const config = JSON.parse(readFileSync(join(state, 'openclaw/openclaw.json'), 'utf8'));
    // Both sides expose only the flush's workspace-confined read builtin. Production denies group:fs;
    // with that denial an enabled flush fails on an empty toolset BEFORE it can call the provider.
    // The scripted provider makes no tool calls, and Crewhouse's gate still refuses every tool.
    const policy = await kit.call('config.get', {}) as { hash: string };
    await kit.call('config.patch', { raw: JSON.stringify({ tools: { deny: [...config.tools.deny.filter((name: string) => name !== 'group:fs'), 'write', 'edit', 'apply_patch'] } }),
      baseHash: policy.hash, replacePaths: ['tools.deny'] });
    await kit.patchConfig({ models: { providers: { 'crewhouse-stub': { models: [{ ...config.models.providers['crewhouse-stub'].models[0], contextWindow: 64_000 }] } } } });
    for (const enabled of [false, true]) {
      if (enabled) await kit.patchConfig({ agents: { defaults: { compaction: { memoryFlush: { enabled: true } } } } });
      const active = await kit.call('config.get', {}) as { config: any };
      const health = await kit.call('health', {}) as { plugins: { loaded: string[] } };
      console.log(JSON.stringify({ memoryFlush: enabled, activeDefaults: active.config.agents.defaults,
        member: active.config.agents.entries?.m1, providerConfig: active.config.models.providers['crewhouse-stub'].models,
        loadedPlugins: health.plugins.loaded }));
      assert.equal(active.config.agents.defaults.compaction.memoryFlush.enabled, enabled, 'positive/negative config readback');
      assert.ok(health.plugins.loaded.includes('memory-core'), 'the flush-plan memory capability plugin must be loaded');
      assert.equal(active.config.tools.fs.workspaceOnly, true, 'read stays in the fixture workspace');
      assert.ok(!active.config.tools.deny.includes('group:fs') && ['write', 'edit', 'apply_patch'].every((name) => active.config.tools.deny.includes(name)), 'both controls expose only the flush read builtin');
      const key = enabled ? 'flush-control' : 'flush-disabled';
      // The agent RPC flushes AFTER each turn: the seed itself can trigger it, not just the follow-up.
      const before = stub.calls.length;
      const seed = await run(key, `Keep this task context:\n${'The household prefers the blue lantern by the kitchen door.\n'.repeat(300)}`);
      assert.ok(seed.ok, JSON.stringify(seed));
      const sessions = await kit.call('sessions.list', {}) as { sessions: { key: string; totalTokens: number; totalTokensFresh: boolean; provider?: string; model?: string; contextTokens?: number; compactionCount?: number; memoryFlush?: object }[] };
      const seeded = sessions.sessions.find((s) => s.key === `agent:m1:crewhouse:chief:${key}`);
      assert.ok(seeded?.totalTokensFresh && seeded.totalTokens >= 40_001, `fresh prompt usage must cross 40k: ${JSON.stringify(seeded)}`);
      console.log(JSON.stringify({ memoryFlush: enabled, seeded: { key: seeded.key, totalTokens: seeded.totalTokens,
        totalTokensFresh: seeded.totalTokensFresh, provider: seeded.provider, model: seeded.model,
        contextTokens: seeded.contextTokens, compactionCount: seeded.compactionCount, memoryFlush: seeded.memoryFlush } }));
      const afterSeed = stub.calls.length;
      const end = await run(key, 'Finish the task in one sentence.');
      assert.ok(end.ok, JSON.stringify(end));
      const added = stub.calls.slice(before);
      // A compaction summary is a different request: never classify it as a memory flush by count alone.
      console.log(JSON.stringify({ memoryFlush: enabled, requests: added.length, seedRequests: afterSeed - before,
        followupRequests: stub.calls.length - afterSeed, flushRequests: flush(added).length,
        requestsByLastMessage: added.map((c) => String(c.body.messages.at(-1)?.content).slice(0, 120)) }));
      // The final RPC can precede the file logger's flush: wait on the recorded cycle, never a fixed sleep.
      if (enabled) for (const deadline = Date.now() + 10_000; !readFileSync(join(state, 'logs/openclaw-events.log'), 'utf8').includes('memoryFlushCompactionCount=0');) {
        assert.ok(Date.now() < deadline, 'timed out waiting for the successful flush-cycle trace');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const maintenance = readFileSync(join(state, 'logs/openclaw-events.log'), 'utf8').split('\n')
        .filter((line) => /memoryFlush (check|triggered)|memory flush failed/.test(line)).map((line) => JSON.parse(line).message as string);
      console.log('observedMaintenance', maintenance.join('\n'));
      console.log('flushWireSignatures', JSON.stringify(flush(added).map((c) => ({
        latestUser: c.body.messages.findLast((m: any) => m.role === 'user')?.content,
        systemPassage: String(JSON.stringify(c.body.messages.find((m: any) => m.role === 'system' && /Pre-compaction memory flush turn\./.test(JSON.stringify(m.content)))?.content)).match(/Pre-compaction memory flush turn\.[\s\S]{0,180}/)?.[0],
        toolNames: c.body.tools.map((t: any) => t.function.name),
      }))));
      if (!enabled) {
        assert.equal(flush(added).length, 0, 'no silent flush request');
        assert.ok(!maintenance.some((line) => /memoryFlush triggered/.test(line)), 'disabled flush never enters maintenance');
        assert.equal(added.length, 2, 'only the explicit seed and follow-up reached the provider (no compaction needed)');
      } else {
        assert.equal(flush(added).length, 1, 'enabled control exposes the current-system flush instruction and runtime-event user carrier');
        assert.ok(added.length > 2, 'the enabled control adds a silent provider turn');
        assert.deepEqual(flush(added)[0].body.tools.map((t: any) => t.function.name), ['read'], 'the counterfactual exposes only workspace-confined read');
        assert.ok(maintenance.some((line) => /memoryFlush check:.*contextWindow=64000 threshold=40000/.test(line)), 'actual engine threshold, not inferred arithmetic');
        assert.ok(maintenance.some((line) => /memoryFlush triggered:.*tokenCount=40001 threshold=40000/.test(line)), 'the soft threshold actually triggered');
        assert.ok(maintenance.some((line) => /memoryFlushCompactionCount=0/.test(line)), 'the flush succeeded for this compaction cycle');
        assert.ok(!maintenance.some((line) => /memory flush failed/.test(line)), 'no failed-flush request is accepted as success');
      }
    }
  } finally {
    await runtime.stop(); await stub.close();
    try {
      const trace = readFileSync(join(state, 'logs/openclaw-events.log'), 'utf8').split('\n').filter((line) => /memoryFlush (check|triggered)|memory.flush|compaction/.test(line));
      console.log('maintenanceTrace', trace.join('\n').slice(-30_000));
    } catch (error) { console.log('maintenanceTrace unavailable', String(error)); }
    rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});

test('local memory recall uses the person’s m1 workspace without a paid embedding request', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-local-'));
  const stub = await startModelStub();
  const runtime = new OpenClawRuntime(state);
  try {
    const host: ToolHost = { tools: () => [], gate: async (_run, tool) => tool === 'memory_search' ? { allow: true } : { allow: false, reason: 'no runs here' }, call: async () => 'no calls here' };
    await runtime.start(host);
    await runtime.configureModelProvider(stub.url, 'stub-m1');
    await runtime.kit.patchConfig({ memory: { search: { provider: 'ollama', model: 'local-test', remote: { baseUrl: stub.url.replace(/\/v1$/, '') } } } });
    await runtime.stop();
    await runtime.start(host);
    const { workspace } = await runtime.kit.ensureMember('m1');
    writeFileSync(join(workspace, 'MEMORY.md'), 'A green umbrella is by the door.');
    const local = await runtime.run({ key: 'agent:m1:crewhouse:scout:10', bot: 'scout', task: 10, account: 'chatgpt', cwd: '', system: 'You are Scout.', message: '[tool memory_search {"query":"green umbrella"}]', builtins: [] }, () => {});
    assert.ok(local.ok && local.text.includes('green umbrella'), JSON.stringify(local).slice(0, 600));
    assert.ok(stub.calls.some((call) => call.path === '/api/embed'), 'the configured local embedding route was used');
    assert.ok(stub.calls.every((call) => !/\/v1\/embeddings/.test(call.path)), 'API-billed embeddings were requested');
  } finally { await runtime.stop(); await stub.close(); rmSync(state, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});
