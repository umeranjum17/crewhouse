// The engine port on the kit, with the kit's fake Gateway as the transport: a scripted `[tool …]` call crosses the
// kit's real bridge socket, and Crewhouse's gate and tools see the crew's own run (bot and task), never the engine's.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/openclaw/runtime.ts';
import { faked } from './kit-fake.ts';

test('a run\'s tool call crosses the gate as the crew\'s own run; an unknown run fails closed', async () => {
  const f = faked({ call: (_run, tool, input) => `${tool}: ${input.text}` });
  try {
    await f.started;
    const end = await f.runtime.run({ key: 'agent:m1:crewhouse:chief:1', member: 1, bot: 'chief', task: 1, account: 'chatgpt',
      cwd: '', system: 'Be brief.', message: '[tool crew_report {"text":"Working"}]', builtins: [] }, () => {});
    assert.ok(end.ok, JSON.stringify(end));
    assert.deepEqual(f.seen.gated.map(([run, tool]) => [run.bot, run.task, run.member, tool]), [['chief', 1, 1, 'crew_report']]);
    assert.deepEqual(f.seen.called.map(([run, tool, input]) => [run.bot, run.task, tool, input]), [['chief', 1, 'crew_report', { text: 'Working' }]]);
    // Once the run is over its key is gone: a late gate is refused without asking Crewhouse.
    assert.equal((await f.ask({ kind: 'gate', key: 'agent:m1:crewhouse:chief:1', tool: 'crew_report', input: { text: 'late' } })).allow, false);
    assert.equal((await f.ask({ kind: 'call', key: 'agent:m1:crewhouse:chief:1', tool: 'crew_report', input: { text: 'late' }, permit: 'made-up' })).ok, false);
    assert.equal(f.seen.gated.length, 1);
    assert.equal(f.seen.called.length, 1);
    // A denial is the model's to read, and nothing runs.
    const denied = faked({ gate: () => ({ allow: false, reason: 'The person has not approved this.', park: true }) });
    try {
      await denied.started;
      await denied.runtime.run({ key: 'agent:m2:crewhouse:scout:4', member: 2, bot: 'scout', task: 4, account: 'chatgpt',
        cwd: '', system: '', message: '[tool bash {"command":"ls"}]', builtins: [] }, () => {});
      assert.deepEqual(denied.seen.gated.map(([run, tool]) => [run.member, run.bot, tool]), [[2, 'scout', 'bash']]);
      assert.equal(denied.seen.called.length, 0);
    } finally { await denied.done(); }
  } finally { await f.done(); }
});

test('the curation window: the member\'s own reviewer, its reconcile, one call wide', async () => {
  const f = faked();
  try {
    await f.started;
    // An engine-internal session fails closed by default; the workshop runs only inside a crewhouse-armed window,
    // and the real reviewer session is keyed `agent:<agentId>:skill-collection-review:incognito-<uuid>`.
    const shop = { kind: 'gate', key: 'agent:m1:skill-collection-review:incognito-abc', tool: 'skill_workshop', input: { action: 'reconcile' } };
    assert.equal((await f.ask(shop)).allow, false, 'unregistered workshop calls are denied');
    f.runtime.armCuration(1, -1);
    assert.equal((await f.ask(shop)).allow, false, 'outside the window (expired) everything is denied');
    f.runtime.armCuration(1);
    assert.equal((await f.ask({ ...shop, key: 'agent:m2:skill-collection-review:incognito-def' })).allow, false, 'another member is denied');
    assert.equal((await f.ask({ ...shop, input: { action: 'restore_collection' } })).allow, false, 'a different action is denied');
    assert.equal((await f.ask({ ...shop, tool: 'bash', input: { command: 'ls' } })).allow, false, 'every other tool is denied');
    assert.equal((await f.ask(shop)).allow, true, 'armed: the exact captured review call may run');
    assert.equal((await f.ask(shop)).allow, false, 'the window allowed its one call; a replay is denied');
    assert.equal((await f.ask({ ...shop, key: 'agent:m1:skill-collection-review:incognito-a-different-review' })).allow, false, 'a different review sharing the prefix is denied');
    assert.equal(f.seen.called.length, 0);
  } finally { await f.done(); }
});

test('model-visible crew tools tell the model the required arguments', () => {
  const tools = new Map(TOOLS.map((t) => [t.name, t as { description: string; parameters: any }]));
  const remember = tools.get('crew_remember')!;
  assert.deepEqual(remember.parameters.required, ['text']);
  assert.equal(remember.parameters.properties.text.type, 'string');
  assert.match(remember.description, /text/);
  const document = tools.get('crew_document')!;
  assert.deepEqual(document.parameters.required, ['name', 'blocks']);
  assert.equal(document.parameters.properties.blocks.type, 'array');
  assert.match(document.description, /blocks/);
});

test('the engine pin is the kit\'s, and only the engine port imports the kit', () => {
  const kit = fileURLToPath(new URL('.', import.meta.resolve('@byokit/openclaw/testing'))).replace(/dist\/testing\/$/, 'engine');
  for (const file of ['package.json', 'package-lock.json'])
    assert.equal(readFileSync(new URL(`../runtime/openclaw/${file}`, import.meta.url), 'utf8'), readFileSync(join(kit, file), 'utf8'), `runtime/openclaw/${file} drifted from the kit's engine pin`);
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const importers = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(ts|mjs|js)$/.test(f))
    .filter((f) => /from '@(byokit\/openclaw|openclaw\/)/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(importers, ['openclaw/runtime.ts']);
});
