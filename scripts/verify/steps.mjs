// The step record done-done reads beside a journey's captures: the steps a person takes and what they can see at the end.
// One writer for every journey, so the record's shape lives in one place and no journey copies it:
//
//   node scripts/verify/steps.mjs <out-dir> <record> [key=value…]
//
// The records themselves are in steps.json beside this file, one entry per journey script. {{version}} and {{sha}} are the
// repo's own; a journey passes its own words (ask=…, model=…) as key=value pairs and the record names them.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..');
const records = JSON.parse(readFileSync(join(HERE, 'steps.json'), 'utf8'));

const fill = (text, vars) => String(text).replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in vars ? vars[key] : whole));
const repoVersion = () => JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
const repoSha = () => {
  try { return execFileSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { throw new Error('steps: this checkout has no commit to name; the record wants the build it drove'); }
};

// The version of the app this checkout drives.
export const version = repoVersion;

// Why a record is not a step record, or null. The same rules done-done checks before it seals a run.
export function stepRecordFault(record) {
  const text = (v) => typeof v === 'string' && v.trim() !== '';
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'it is not a JSON object';
  if (!text(record.target?.version)) return 'target.version is missing';
  if (!text(record.start)) return 'start is missing';
  if (!Array.isArray(record.steps) || !record.steps.length || !record.steps.every(text)) return 'steps must be a non-empty list of strings';
  if (!text(record.result)) return 'result is missing';
  return null;
}

// Write the record a journey leaves beside its captures.
export function writeStepsRecord(out, record) {
  const bad = stepRecordFault(record);
  if (bad) throw new Error(`steps: this is not a step record: ${bad}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'steps.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

// The record of a journey, from steps.json, with the journey's own words filled in.
export function writeSteps(out, name, vars = {}) {
  const entry = records[name];
  if (!entry) throw new Error(`steps: steps.json has no record named ${name}`);
  const words = { version: repoVersion(), ...vars };
  const say = (text) => (String(text).includes('{{sha}}') ? fill(text, { ...words, sha: repoSha() }) : fill(text, words));
  return writeStepsRecord(out, {
    target: { version: say(entry.target?.version ?? '{{version}}') },
    start: say(entry.start),
    steps: entry.steps.map(say),
    result: say(entry.result),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out, name, ...rest] = process.argv.slice(2);
  if (!out || !name) { console.error('usage: steps.mjs <out-dir> <record> [key=value…]'); process.exit(2); }
  const vars = {};
  for (const pair of rest) {
    const at = pair.indexOf('=');
    if (at < 0) { console.error(`steps: ${pair} is not key=value`); process.exit(2); }
    vars[pair.slice(0, at)] = pair.slice(at + 1);
  }
  writeSteps(out, name, vars);
}
