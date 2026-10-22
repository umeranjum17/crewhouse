// The binary inspector: a read-only look inside a file a helper was given. Each check says what it found, and the
// tool never runs the file, never writes and never leaves the helper's own folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectBinary } from '../src/binary.ts';
import { sandboxReady } from '../src/engine.ts';
import { setup, settled, task, delegated, lastSaid } from './lab.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
import { temp } from './tmp.ts';

const root = temp('binary-inspect'), space = join(root, 'bot');
mkdirSync(join(space, 'files'), { recursive: true });
const fixture = join(space, 'files', 'app.bin'), system = ['/bin/true', '/usr/bin/true'].find((p) => existsSync(p));
if (system) copyFileSync(system, fixture);
const skip = !sandboxReady() ? 'bubblewrap is not usable here' : !system ? 'no small system binary to look inside' : false;

test('the type check says what kind of file it is', { skip }, async () => {
  const out = await inspectBinary(space, 'files/app.bin', 'type');
  assert.match(out, /^ELF 64-bit/);
});

test('the headers check reads the file\'s own header', { skip }, async () => {
  const out = await inspectBinary(space, 'files/app.bin', 'headers');
  assert.match(out, /ELF Header/);
  assert.match(out, /Class:\s+ELF64/);
});

test('the strings check finds the words inside the file', { skip }, async () => {
  const out = await inspectBinary(space, 'files/app.bin', 'strings');
  const lines = out.split('\n').slice(1).filter(Boolean);
  assert.ok(lines.length > 5, `only ${lines.length} strings found`);
  assert.ok(lines.every((l) => /^[\x20-\x7e]+$/.test(l)), 'every string is printable');
});

test('the symbols check names what the file uses', { skip }, async () => {
  const out = await inspectBinary(space, 'files/app.bin', 'symbols');
  assert.match(out, /what it uses:/);
  assert.match(out, /GLIBC/);
});

test('the sections check lists the parts of the file', { skip }, async () => {
  const out = await inspectBinary(space, 'files/app.bin', 'sections');
  assert.match(out, /\.text/);
  assert.match(out, /\.dynsym/);
});

test('the inspector never runs the file, never writes, and never leaves the helper\'s folder', { skip }, async () => {
  // A file that would leave a mark behind if anything ever ran it.
  const marker = join(space, 'files', 'ran.txt'), script = join(space, 'files', 'run-me.sh');
  writeFileSync(script, '#!/bin/sh\ntouch ran.txt\n');
  chmodSync(script, 0o755);
  symlinkSync('/etc/passwd', join(space, 'files', 'escape'));
  const before = readdirSync(join(space, 'files')).sort().join(','), size = statSync(fixture).size;
  await inspectBinary(space, 'files/app.bin', 'type');
  // It never ran the file: the mark is not there.
  assert.equal(existsSync(marker), false, 'the inspector ran the file it looked at');
  // It never wrote: the folder holds exactly what it held, and the file it read is untouched.
  assert.equal(readdirSync(join(space, 'files')).sort().join(','), before);
  assert.equal(statSync(fixture).size, size);
  // A path that leaves the folder, and a symlink that points out of it, are both refused before anything runs.
  await assert.rejects(inspectBinary(space, '../../etc/passwd', 'type'), /not in your own folder/);
  await assert.rejects(inspectBinary(space, 'files/escape', 'type'), /not in your own folder/);
  // A check that is not on the list is refused too: the helper names a check, never a program.
  await assert.rejects(inspectBinary(space, 'files/app.bin', 'run'), /not one this tool has/);
});

test('a helper the person granted the inspector to reads a binary through the gate; one without it is refused', { skip }, async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('Umer');
  crew.recruit('reverse', 'Byte', 'person');
  crew.recruit('scout', 'Scout', 'person');
  copyFileSync(system!, join(cfg.crewDir, 'bots', 'byte', 'files', 'app.bin'));
  // Byte holds the inspector (the template grants it), so the check runs and the model reads what it found.
  const id = delegated(crew, 'byte', '[tool crew_inspect {"path":"files/app.bin","what":"type"}]').task;
  await settled(db, id);
  const said = (crew.runtime as StubRuntime).transcript(task(db, id).session);
  assert.match(said, /crew_inspect: .*ELF 64-bit/, 'the helper read what the inspector found');
  const call = db.all("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", id).map((e: any) => JSON.parse(e.data));
  assert.equal(call.at(-1).ok, true, 'the call is recorded as done');
  // Scout was never granted it, so the gate refuses the same call.
  const other = delegated(crew, 'scout', '[tool crew_inspect {"path":"files/app.bin","what":"type"}]').task;
  await settled(db, other);
  assert.match(lastSaid(db, 'scout') ?? '', /does not have that tool/, 'a helper without the grant cannot call it');
  done();
});
