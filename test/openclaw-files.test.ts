import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileTool } from '../src/openclaw/files.ts';

test('bot file tools write where the gate allowed, and never travel through a symlink', () => {
  const bot = mkdtempSync(join(tmpdir(), 'crewhouse-files-'));
  const outside = mkdtempSync(join(tmpdir(), 'crewhouse-outside-'));
  try {
    writeFileSync(join(outside, 'secret'), 'the person said yes');
    symlinkSync(outside, join(bot, 'escape'));
    // A symlink in the bot's folder is never followed, whatever it points at.
    assert.throws(() => fileTool(bot, 'crew_read', { path: 'escape/secret' }), /symlink|ENOTDIR|ELOOP/);
    assert.throws(() => fileTool(bot, 'crew_write', { path: 'escape/new', content: 'oops' }), /symlink|ENOTDIR|ELOOP/);
    // A path outside the folder works: the gate asked for it and the person allowed it (src/policy.ts `files`).
    assert.match(fileTool(bot, 'crew_write', { path: join(outside, 'allowed.txt'), content: 'hello' }), /Wrote/);
    assert.equal(readFileSync(join(outside, 'allowed.txt'), 'utf8'), 'hello');
    assert.match(fileTool(bot, 'crew_write', { path: 'files/result.txt', content: 'safe' }), /Wrote/);
    assert.equal(readFileSync(join(bot, 'files/result.txt'), 'utf8'), 'safe');
    assert.equal(fileTool(bot, 'crew_edit', { path: 'files/result.txt', oldText: 'safe', newText: 'done' }), 'Edited files/result.txt');
    assert.equal(fileTool(bot, 'crew_read', { path: 'files/result.txt' }), 'done');
  } finally { rmSync(bot, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
