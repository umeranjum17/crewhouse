import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { test } from 'node:test';
import { ToolBridge } from '../src/openclaw/bridge.ts';

test('an unknown run and an ungated call fail closed; a permit works once', async () => {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-bridge-'));
  let calls = 0;
  const bridge = new ToolBridge(state, {
    tools: () => [], gate: async () => ({ allow: true }),
    call: async () => { calls++; return 'done'; },
  });
  const ask = (frame: object): Promise<any> => new Promise((resolve, reject) => {
    const socket = connect(bridge.path);
    let text = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      text += chunk;
      if (text.includes('\n')) { resolve(JSON.parse(text)); socket.end(); }
    });
    socket.on('connect', () => socket.write(JSON.stringify(frame) + '\n'));
  });
  try {
    await bridge.start();
    const run = { key: 'agent:m1:crewhouse:chief:1', member: 1, bot: 'chief', task: 1 };
    assert.equal((await ask({ kind: 'gate', key: run.key, tool: 'crew_report', input: { text: 'hi' } })).allow, false);
    bridge.register(run);
    const frame = { key: run.key, tool: 'crew_report', input: { text: 'hi' } };
    assert.equal((await ask({ kind: 'call', ...frame, permit: 'made-up' })).allow, false);
    const granted = await ask({ kind: 'gate', ...frame });
    assert.equal(granted.allow, true);
    assert.equal((await ask({ kind: 'call', ...frame, permit: granted.permit })).text, 'done');
    assert.equal((await ask({ kind: 'call', ...frame, permit: granted.permit })).allow, false);
    assert.equal(calls, 1);
    // An engine-internal session fails closed by default; the workshop runs only inside a crewhouse-armed window,
    // and the real reviewer session is keyed `agent:<agentId>:skill-collection-review:incognito-<uuid>`.
    const shop = { kind: 'gate', key: 'agent:m1:skill-collection-review:incognito-abc', tool: 'skill_workshop', input: { action: 'reconcile' } };
    assert.equal((await ask(shop)).allow, false, 'unregistered workshop calls are denied');
    bridge.armCuration({ member: 1, review: 'skill-collection-review', action: 'reconcile' }, 60_000);
    assert.equal((await ask(shop)).allow, true, 'armed: the exact captured review call may run');
    // Bound to the captured member: a different member's workshop call inside the window is denied.
    const outsider = { kind: 'gate', key: 'agent:m2:skill-collection-review:incognito-def', tool: 'skill_workshop', input: { action: 'reconcile' } };
    assert.equal((await ask(outsider)).allow, false, 'armed: another member is denied, their capture was never verified');
    // Bound to the captured action: the same member, a different action, is denied.
    const otherAction = { kind: 'gate', key: 'agent:m1:skill-collection-review:incognito-abc', tool: 'skill_workshop', input: { action: 'restore_collection' } };
    assert.equal((await ask(otherAction)).allow, false, 'armed: a different action by the same member is denied');
    const other = { kind: 'gate', key: 'agent:m1:skill-collection-review:incognito-abc', tool: 'bash', input: { command: 'ls' } };
    assert.equal((await ask(other)).allow, false, 'armed still fails closed for every other tool and session');
    bridge.disarmCuration();
    assert.equal((await ask(shop)).allow, false, 'disarmed: denied again');
  } finally { bridge.stop(); rmSync(state, { recursive: true, force: true }); }
});
