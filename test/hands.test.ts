// One door for a bot's hands (bin/hands.mjs). A bot whose bot.json names a far computer has its shell and browser calls
// go to the far stand-in, in order and with their exact arguments, and reads its answer. A bot with no far computer
// still runs them here. A far computer that cannot be reached is a failure the bot reads, never a run here. The stub
// engine, a fake browser AXI that writes down every call it gets, no network and no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { botDir, patchConfig } from '../src/bots.ts';
import { toolBin } from '../src/tools.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
const { setup, settled, task, delegated, until } = await import('./lab.ts');

const AXI = `const fs = process.getBuiltinModule('fs');
fs.appendFileSync(process.cwd() + '/axi-calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('page: {url: https://example.test/, title: "Example"}');`;
const JOB = (file: string) => `[tool bash {"command":"echo hands > ${file}"}] [tool browser {"args":["goto","https://example.test/"]}]`;
const lines = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

function lab() {
  const l = setup(), axi = join(l.cfg.toolsDir, 'browser', 'node_modules', 'playwright-axi', 'bin', 'playwright-axi.js');
  mkdirSync(join(axi, '..'), { recursive: true }); mkdirSync(toolBin(l.cfg), { recursive: true });
  writeFileSync(axi, AXI); symlinkSync(axi, join(toolBin(l.cfg), 'playwright-axi'));
  l.crew.onboard('Umer');
  const [far, local] = ['scribe', 'scout'].map((t) => l.crew.recruit(t, undefined, 'person').id as string);
  const said = (id: number) => (l.crew.runtime as StubRuntime).transcript(task(l.db, id).session);
  const calls = (id: number) => l.db.all("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", id).map((e: any) => JSON.parse(e.data)).map((c: any) => ({ tool: c.tool, ok: c.ok }));
  return { ...l, far, local, said, calls, where: (bot: string) => (l.crew as any).handsOf(bot).hands.where as string };
}

test("a far bot's shell call and browser action reach the far stand-in in order, and a bot with no far computer stays here", async () => {
  const { cfg, db, crew, done, said, calls, where, far: scribe, local: scout } = lab(), far = join(cfg.stateDir, 'far', 'lab'), space = botDir(cfg, scribe), here = botDir(cfg, scout);
  mkdirSync(far, { recursive: true }); // the pretend far computer
  patchConfig(cfg, scribe, { far: 'lab' });
  assert.equal(where(scribe), 'far:lab');
  assert.equal(where(scout), 'here', 'no far computer in its bot.json: its hands are here');

  const job = delegated(crew, scribe, JOB('far.txt')).task;
  await settled(db, job);
  await until('the far browser closed with the job', () => lines(join(far, 'calls.jsonl')).length === 4);
  assert.deepEqual(lines(join(far, 'calls.jsonl')), [
    { tool: 'bash', input: { command: 'echo hands > far.txt' } },
    { tool: 'browser', input: ['open', '--persistent', '--profile', join(space, 'browser')] },
    { tool: 'browser', input: ['goto', 'https://example.test/'] },
    { tool: 'browser', input: ['close'] },
  ], 'every call, in order, with its exact arguments');
  assert.match(said(job), /^bash: far stand-in "lab": your bash call was written down; no computer ran it\.$/m, "the bot read the stand-in's answer to its shell call");
  assert.match(said(job), /^browser: far stand-in "lab": your browser call was written down; no computer ran it\.$/m, "and to its browser action");
  assert.deepEqual(calls(job), [{ tool: 'bash', ok: true }, { tool: 'browser', ok: true }]);
  assert.ok(!existsSync(join(space, 'far.txt')), 'the shell did not run here');
  assert.deepEqual(lines(join(space, 'axi-calls.jsonl')), [], 'the browser did not run here');

  const local = delegated(crew, scout, JOB('here.txt')).task;
  await settled(db, local);
  assert.equal(readFileSync(join(here, 'here.txt'), 'utf8'), 'hands\n', 'its shell ran in its own sandbox here');
  await until('the local browser closed with the job', () => lines(join(here, 'axi-calls.jsonl')).length === 3);
  assert.deepEqual(lines(join(here, 'axi-calls.jsonl')), [['open', '--persistent', '--profile', join(here, 'browser')], ['goto', 'https://example.test/'], ['close']]);
  assert.match(said(local), /^browser: page: \{url: https:\/\/example\.test\/, title: "Example"\}$/m, 'the bot read its own browser');
  assert.equal(lines(join(far, 'calls.jsonl')).length, 4, 'nothing of the local bot reached the far computer');
  done();
});

test('a far computer that cannot be reached is a failure the bot reads, and nothing runs here instead', async () => {
  const { cfg, db, crew, done, said, calls, far: scribe } = lab(), space = botDir(cfg, scribe);
  for (const [far, why] of [['gone', 'the far computer "gone" could not be reached, so nothing ran.'], ['../../x', "this bot's far computer has a name Crewhouse can't use, so nothing ran."]]) {
    patchConfig(cfg, scribe, { far });
    const job = delegated(crew, scribe, JOB('far.txt')).task;
    await settled(db, job);
    assert.ok(said(job).includes(`bash: error: ${why}\n`), `the shell call failed in plain words: ${said(job)}`);
    assert.ok(said(job).includes(`browser: error: ${why}\n`), 'and so did the browser action');
    assert.deepEqual(calls(job), [{ tool: 'bash', ok: false }, { tool: 'browser', ok: false }], "crewd's record marks both failed");
  }
  assert.ok(!existsSync(join(space, 'far.txt')), 'the shell never fell back to this computer');
  assert.deepEqual(lines(join(space, 'axi-calls.jsonl')), [], 'nor the browser');
  assert.ok(!existsSync(join(cfg.stateDir, 'x')), 'a name in bot.json never becomes a path');
  done();
});
