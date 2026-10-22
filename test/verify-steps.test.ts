// Every journey leaves the step record done-done reads beside its captures: one shared writer
// (scripts/verify/steps.mjs) and one record per journey (scripts/verify/steps.json). This runs that writer for
// every journey's own record — no model, no browser, no network — and holds the map closed: a journey added
// without a record, a record without a writer, or a copied writer fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = join(import.meta.dirname, '..');
const VERIFY = join(REPO, 'scripts/verify');
const records = JSON.parse(readFileSync(join(VERIFY, 'steps.json'), 'utf8')) as Record<string, any>;
const { stepRecordFault } = await import(join(VERIFY, 'steps.mjs')) as { stepRecordFault: (r: unknown) => string | null };

// The writer call in a script or a journey command: the shared helper, in either shape it is written.
type Call = { name: string; vars: string[] };
const calls = (text: string): Call[] => {
  const out: Call[] = [];
  for (const line of text.split('\n')) {
    const cli = /steps\.mjs["']?\s+(?:"[^"]*"|'[^']*'|\S+)\s+([\w-]+)(.*)$/.exec(line);
    if (cli) out.push({ name: cli[1], vars: [...cli[2].matchAll(/"(\w+)="/g)].map((m) => m[1]) });
    for (const m of line.matchAll(/writeSteps\(\s*\w+\s*,\s*'([\w-]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
      out.push({ name: m[1], vars: (m[2] ?? '').split(',').map((v) => v.trim().split(':')[0]).filter(Boolean) });
    }
  }
  return out;
};

// The journeys .done-done.yaml names, with the command each one runs.
const journeys = (() => {
  const out = new Map<string, string>();
  let name = '';
  for (const line of readFileSync(join(REPO, '.done-done.yaml'), 'utf8').split('\n')) {
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) { name = head[1]; continue; }
    const cmd = /^ {4}command:\s*'(.*)'\s*$/.exec(line) ?? /^ {4}command:\s*"(.*)"\s*$/.exec(line);
    if (cmd && name) { out.set(name, cmd[1]); name = ''; }
  }
  return out;
})();

test('every journey writes its step record through the one shared writer', () => {
  const scripts = readdirSync(VERIFY).filter((f) => /\.(sh|mjs|ts)$/.test(f));
  const written = new Map<string, Call[]>();
  for (const file of scripts) written.set(file, calls(readFileSync(join(VERIFY, file), 'utf8')));
  const config = calls(readFileSync(join(REPO, '.done-done.yaml'), 'utf8'));

  // The shared writer is the only one: no journey keeps its own copy of it.
  for (const file of scripts) {
    if (file === 'steps.mjs') continue;
    assert.doesNotMatch(readFileSync(join(VERIFY, file), 'utf8'), /steps\.json/, `${file} writes a step record of its own`);
  }

  // Every journey in the config writes a record, through its own script or through the command itself.
  for (const [journey, command] of journeys) {
    const mine = [...config.filter((c) => command.includes(c.name)), ...[...written.entries()]
      .filter(([file]) => command.includes(`scripts/verify/${file}`)).flatMap(([, cs]) => cs)];
    assert.ok(mine.length, `the journey ${journey} writes no step record`);
    for (const call of mine) assert.ok(records[call.name], `the journey ${journey} has no record named ${call.name} in steps.json`);
  }

  // Every record is written by something: no stale record, and no journey left out of the map.
  const all = [...written.values()].flat().concat(config);
  for (const name of Object.keys(records)) {
    assert.ok(all.some((c) => c.name === name), `the record ${name} in steps.json is written by no journey`);
  }
});

test('the shared writer leaves a record done-done would seal, for every journey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crewhouse-steps-'));
  try {
    for (const [name, entry] of Object.entries(records)) {
      const words = [entry.start, ...entry.steps, entry.result].join(' ');
      const vars = [...new Set([...words.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
      const out = join(dir, name);
      execFileSync(process.execPath, [join(VERIFY, 'steps.mjs'), out, name, ...vars.map((v) => `${v}=the ${v}`)], { encoding: 'utf8' });
      const written = JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8'));
      assert.equal(stepRecordFault(written), null, `the record ${name} is not one done-done seals`);
      assert.doesNotMatch(JSON.stringify(written), /\{\{/, `the record ${name} still has a word nobody filled in`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a journey that writes no record is caught, and a broken record is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crewhouse-steps-'));
  try {
    assert.throws(() => execFileSync(process.execPath, [join(VERIFY, 'steps.mjs'), dir, 'no-such-journey'], { encoding: 'utf8', stdio: 'pipe' }));
    assert.equal(existsSync(join(dir, 'steps.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
