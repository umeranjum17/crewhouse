import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileTool } from '../src/openclaw/files.ts';

test('bot file tools reject traversal and symlink escapes', () => {
  const bot = mkdtempSync(join(tmpdir(), 'crewhouse-files-'));
  const outside = mkdtempSync(join(tmpdir(), 'crewhouse-outside-'));
  try {
    writeFileSync(join(outside, 'secret'), 'not yours');
    symlinkSync(outside, join(bot, 'escape'));
    assert.throws(() => fileTool(bot, 'crew_read', { path: '../secret' }), /outside/);
    assert.throws(() => fileTool(bot, 'crew_read', { path: 'escape/secret' }), /outside|symlink|ENOTDIR|ELOOP/);
    assert.throws(() => fileTool(bot, 'crew_write', { path: 'escape/new', content: 'oops' }), /symlink|ENOTDIR|ELOOP/);
    assert.throws(() => fileTool(bot, 'crew_write', { path: '../new', content: 'oops' }), /outside/);
    assert.match(fileTool(bot, 'crew_write', { path: 'files/result.txt', content: 'safe' }), /Wrote/);
    assert.equal(readFileSync(join(bot, 'files/result.txt'), 'utf8'), 'safe');
    assert.equal(fileTool(bot, 'crew_edit', { path: 'files/result.txt', oldText: 'safe', newText: 'done' }), 'Edited files/result.txt');
    assert.equal(fileTool(bot, 'crew_read', { path: 'files/result.txt' }), 'done');
  } finally { rmSync(bot, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
