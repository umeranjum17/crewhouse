// Learned skills on every model lane, on the real pinned Gateway: the member agent and the OpenCode Go key agent
// (`byokit-key-m1`) each learn into their own workspace, and Settings' learned list (runtime.learned), Forget and
// restore cover both. Each lane runs one scripted turn (as a job would, which starts the engine's skills watcher on
// its workspace); the workshop's proposals are then applied through the engine's own RPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { until } from './lab.ts';
import { startModelStub } from './openclaw-stub.ts';

test('learned skills: both lanes listed once, Forget unloads the copy in use, restore brings back the same bytes', { timeout: 240_000 }, async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-learn-lanes-'));
  const stub = await startModelStub();
  const runtime = new OpenClawRuntime(state, join(state, 'crew'));
  const { kit } = runtime;
  const call = (method: string, params: object) => (kit.call as any)(method, params, { timeoutMs: 30_000 }) as Promise<any>;
  try {
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no runs here' }), call: async () => 'no calls here' });
    await runtime.configureModelProvider(stub.url, 'stub-m1');
    const member = await kit.ensureMember('m1');
    // The key lane as the kit makes it on a Go key, in a folder crewd only learns from the engine's own roster.
    const goLane = join(state, 'go-lane');
    await call('agents.create', { name: 'byokit-key-m1', workspace: goLane });
    await until('the key agent is listed', async () => (await call('agents.list', {})).agents.some((a: any) => a.id === 'byokit-key-m1'));
    assert.ok((await runtime.run({ key: 'agent:m1:crewhouse:chief:1', bot: 'chief', task: 1, account: 'chatgpt', cwd: '', system: 'You are chief.', message: 'hello', builtins: [] }, () => {})).ok);
    // A Go job runs on the key agent (a real key needs the network, so the engine's own run call stands in).
    const go = await call('agent', { agentId: 'byokit-key-m1', sessionKey: 'agent:byokit-key-m1:crewhouse:chief:2', message: 'hello', idempotencyKey: 'go-lane-1' });
    assert.equal((await call('agent.wait', { runId: go.runId, timeoutMs: 60_000 })).status, 'ok');

    const propose = async (agentId: string, name: string) => {
      const created = await call('skills.proposals.create', { agentId, name, description: `How to ${name.toLowerCase()}`, content: `# ${name}\n\n  Check two sources.\n\tSay which.  \n` });
      const inspected = await call('skills.proposals.inspect', { agentId, proposalId: created.record.id });
      return { agentId, id: created.record.id as string, key: inspected.record.target.skillKey as string, hash: inspected.revisionHash as string };
    };
    const learn = async (agentId: string, name: string) => {
      const p = await propose(agentId, name);
      const applied = await call('skills.proposals.apply', { agentId, proposalId: p.id, expectedRevisionHash: p.hash });
      assert.equal(applied.record?.status ?? applied.status, 'applied', `${name} applied on ${agentId}`);
      return p;
    };
    const skills = (agentId: string) => join(agentId === 'm1' ? member.workspace : goLane, 'skills');
    const loaded = async (agentId: string) => (await call('skills.status', { agentId })).skills.map((k: any) => k.skillKey) as string[];
    const rows = async () => (await runtime.learned()).map((r) => r.skill).sort();

    const fare = await learn('m1', 'Fare Check');
    const shared = await learn('m1', 'Seat Map');
    const notes = await learn('byokit-key-m1', 'Go Notes');
    const newer = await learn('byokit-key-m1', 'Seat Map');
    const draft = await propose('byokit-key-m1', 'Draft Idea');
    assert.ok((await loaded('byokit-key-m1')).includes(notes.key) && (await loaded('m1')).includes(fare.key), 'each agent loads its own learned skill');

    // Settings lists every lane's skill once; the newest copy of a shared name wins.
    assert.deepEqual(await rows(), ['Draft Idea', 'Fare Check', 'Go Notes', 'Seat Map']);
    assert.equal((await runtime.learned()).find((r) => r.skill === 'Seat Map')!.id, newer.id, 'the newer key-lane copy wins');

    // Forget acts on the lane that holds it, and restore brings back identical bytes, on both lanes.
    for (const p of [notes, fare]) {
      const file = join(skills(p.agentId), p.key, 'SKILL.md'), before = readFileSync(file);
      await runtime.forget(p.id, '');
      assert.equal(existsSync(file), false, `${p.key} left ${p.agentId}'s skills root`);
      assert.ok(readdirSync(join(skills(p.agentId), '.archive')).some((n) => n.startsWith(`${p.key}-`)), 'put away, never deleted');
      await until(`${p.key} is no longer loaded by ${p.agentId}`, async () => !(await loaded(p.agentId)).includes(p.key));
      assert.ok(!(await rows()).includes(p.agentId === 'm1' ? 'Fare Check' : 'Go Notes'), 'gone from Settings');
      const capture = execFileSync('git', ['-C', skills(p.agentId), 'rev-parse', '--short', 'HEAD^']).toString().trim();
      runtime.restoreLearned(p.key, capture, skills(p.agentId));
      assert.ok(readFileSync(file).equals(before), 'restore is byte for byte');
      await until(`${p.key} is loaded again by ${p.agentId}`, async () => (await loaded(p.agentId)).includes(p.key));
    }
    assert.ok((await loaded('m1')).includes(fare.key) && (await loaded('byokit-key-m1')).includes(notes.key), 'each lane kept its other skills');

    // A shared name is forgotten on every lane that holds it; a pending one is rejected in its own agent.
    await runtime.forget(newer.id, 'Seat Map');
    assert.equal(existsSync(join(skills('m1'), shared.key)) || existsSync(join(skills('byokit-key-m1'), newer.key)), false, 'both copies put away');
    await runtime.forget(draft.id, 'Draft Idea');
    assert.equal((await call('skills.proposals.inspect', { agentId: 'byokit-key-m1', proposalId: draft.id })).record.status, 'rejected');
    assert.deepEqual(await rows(), ['Fare Check', 'Go Notes']);
  } finally {
    await runtime.stop().catch(() => {});
    await stub.close();
    rmSync(state, { recursive: true, force: true });
  }
});
