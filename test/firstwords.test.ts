// The raw first-word harness measures the route it claims to: the pinned Gateway's own stream, one run per variant,
// and per-run values a reader can check. The scripted model stands in for the subscription (no account, no quota);
// the real route is measured against a retained signed-in home, never in a test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error: a plain script, no types
import { measure, report, variants } from '../scripts/measure-firstwords.mjs';
import { loadConfig } from '../src/config.ts';
import { startModelStub } from './openclaw-stub.ts';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-firstwords-'));
mkdirSync(join(root, 'crew', 'bots', 'chief'), { recursive: true });
mkdirSync(join(root, 'crew', 'people', '1'), { recursive: true });
writeFileSync(join(root, 'crew', 'bots', 'chief', 'soul.md'), '# Chief\n\nYou are Chief, of the Crewhouse.\n');
writeFileSync(join(root, 'crew', 'bots', 'chief', 'AGENTS.md'), '# Chief\n\n## What it does\n\nRuns the crew.\n');
writeFileSync(join(root, 'crew', 'people', '1', 'about.md'), 'Prefers short answers.\n');
process.on('exit', () => rmSync(root, { recursive: true, force: true }));

const opts = (extra: object) => ({ runs: 1, variants: ['tiny', 'chief'], body: 'Plan dinners for the week.', out: '', state: join(root, 'state'), crew: join(root, 'crew'), address: '', provider: null, ...extra });

test('the harness writes the crew prompt it measures, and never the harness\'s own words as the person\'s', () => {
  const cfg = { ...loadConfig(), stateDir: join(root, 'state'), crewDir: join(root, 'crew') };
  const [tiny, chief] = variants(['tiny', 'chief'], cfg, 'Plan dinners for the week.', 'Sam');
  assert.ok(chief.messageChars > tiny.messageChars, 'the normal Chief prompt carries the context the tiny one does not');
  assert.match(chief.system, /You are Chief/);
  assert.match(chief.system, /Your id in Crewhouse is chief\./);
  assert.match(chief.message, /^\[Crewhouse\] The person likes to be called "Sam"/);
  assert.match(chief.message, /What the whole crew knows about the person:\nPrefers short answers\./);
  assert.match(chief.message, /The person says: Plan dinners for the week\./);
});

test('crewd already up: the harness refuses instead of taking over its Gateway', async () => {
  // A live process whose command line names crewd, so the guard sees a running daemon.
  const fake = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)', 'src/main.ts'], { stdio: 'ignore' });
  try {
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'crewd.pid'), `${fake.pid}\n`);
    await assert.rejects(measure(opts({})), /crewd \(pid \d+\) is running/);
  } finally { fake.kill('SIGKILL'); rmSync(join(root, 'state'), { recursive: true, force: true }); }
});

test('one raw turn per variant, timed off the engine\'s own stream, with per-run values in the report', { timeout: 420_000 }, async () => {
  const stub = await startModelStub();
  try {
    const out = await measure(opts({ runs: 1, provider: { baseUrl: stub.url, apiKey: 'stub' } }));
    assert.equal(out.rows.length, 2, 'one run per variant');    for (const row of out.rows) {      assert.ok(typeof row.firstWordsMs === 'number' && row.firstWordsMs > 0, `${row.variant}: first real words timed (${row.firstWordsMs}ms)`);
      assert.equal(row.status, 'ok', `${row.variant}: the run finished (${row.status} ${row.error})`);
    }
    assert.match(out.rows.find((r: any) => r.variant === 'chief')!.reply, /stub chief: done with/);
    const text = report(out).text;
    assert.match(text, /\| chief \| \d+ ≈ \d+ tok \|/);
    assert.match(text, /Raw first-real-word floor \(best variant median\): \d+ ms; target 3000 ms\./);
    assert.match(text, /first real words \(ms\)/);
  } finally { await stub.close(); }
});
