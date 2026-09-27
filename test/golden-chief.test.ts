// The owner's four-turn complaint, exercised through the real Crew and its stub engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setup, settled } from './lab.ts';
import { taskTitle, relayResult } from '../src/crew.ts';
import { route } from '../src/route.ts';
import { chatTokens, safeLink } from '../web/src/chat-md.ts';
import * as disk from '../src/bots.ts';

const turns = ['hi', 'how do i pair my computer with you?', 'i want to market my app', 'https://trymuxr.com/'];
const bad = (text: string) => {
  assert.ok((text.match(/\bsir\b/gi) ?? []).length <= 1, text);
  assert.doesNotMatch(text, /Delighted|To think|https?:\/\/|\[[^\]]+\]\(|\*\*|\w+:\s*Sir,/i);
};

test('Chief: the four turns stay in Chief, URLs are context not task names, relays are his words', async () => {
  const { crew, db, done } = setup();
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  for (const text of turns) {
    const r = await crew.post('chief', text) as { task?: number } | undefined;
    if (r?.task) await settled(db, r.task);
  }
  const chiefTasks = db.all("SELECT * FROM tasks WHERE bot = 'chief' ORDER BY id");
  assert.equal(chiefTasks.length, 4, 'marketing intent stays with Chief even with Scout in the roster');
  assert.equal(chiefTasks.at(-1)!.title, 'i want to market my app');
  assert.match(chiefTasks.at(-1)!.body, /i want to market my app\nhttps:\/\/trymuxr.com\//);
  assert.match((crew as any).prompt(chiefTasks.at(-1)), /Earlier in this chat:[\s\S]*market my app/);
  const helper = crew.assign('scout', 'https://trymuxr.com/\n[tool crew_document {"name":"Marketing notes","blocks":[{"heading":"Audience"},{"text":"Developers with coding agents"}]}]', 'chief').task;
  assert.equal(db.get('SELECT title FROM tasks WHERE id = ?', helper)!.title, 'Work on trymuxr.com');
  await settled(db, helper);
  const words = crew.botPage('chief').messages.filter((m) => m.author === 'bot').map((m) => m.text);
  words.forEach(bad);
  assert.match(words.at(-1)!, /^Scout: /);
  assert.doesNotMatch(words.at(-1)!, /stub scout|Sir:|“/);
  const relay = crew.botPage('chief').messages.findLast((m) => m.author === 'bot' && m.text.startsWith('Scout:'));
  assert.equal(relay?.files.length, 1, 'the delivered document is attached to the relay');
  assert.match(relay?.files[0].path ?? '', /\.docx$/);
  delete process.env.CREWHOUSE_STUB_GOLDEN;
  done();
});

test('title, relay and markdown trust boundary', () => {
  assert.match(disk.addressLine('Sir'), /at most once/);
  assert.doesNotMatch(disk.addressLine('Sir'), /^Address the person as/);
  assert.equal(taskTitle('https://trymuxr.com/'), 'Work on trymuxr.com');
  bad(relayResult('Scout', '**Your launch plan is ready:** lead with X.\n- more'));
  assert.equal(relayResult('Scout', '**Your launch plan is ready:** lead with X.\n- more'), 'Scout: Your launch plan is ready: lead with X.');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('https://trymuxr.com/'), 'https://trymuxr.com/');
  assert.deepEqual(chatTokens('## Plan\n\n- [x] **Draft** [site](https://trymuxr.com/)\n\n| A | B |\n|---|---|\n| 1 | 2 |').filter((t) => !['space'].includes(t.type)).map((t) => t.type), ['heading', 'list', 'table']);
});

test('the live system prompt stays brief, answers first, and honors a chosen address once', () => {
  const { cfg, crew, done } = setup();
  assert.ok(disk.systemPrompt(cfg, 'chief', true).length < 10_500);
  for (const tpl of disk.listTemplates(cfg)) {
    if (tpl.hidden) continue;
    crew.recruit(tpl.id, tpl.display, 'person');
    const prompt = disk.systemPrompt(cfg, tpl.id, false);
    assert.match(prompt, /## How you answer/);
    assert.ok(prompt.length < 5_000, `${tpl.id}: ${prompt.length}`);
  }
  done();
});

test('template refresh updates untouched copies but preserves a person-edited soul', () => {
  const { cfg, crew, done } = setup();
  crew.recruit('scout', 'Scout', 'person');
  const tpl = disk.loadTemplate(cfg, 'scout');
  const dir = disk.botDir(cfg, 'scout');
  const original = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  writeFileSync(join(dir, 'AGENTS.md'), 'Old template');
  execFileSync('git', ['-C', dir, '-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', 'add', 'AGENTS.md']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', 'commit', '-m', 'Updated to the new template']);
  disk.upgradeFolder(cfg, 'scout', tpl, 'Scout', 1);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), original);
  disk.writeSoul(cfg, 'scout', '# Scout\n\nPersonal voice.');
  disk.upgradeFolder(cfg, 'scout', tpl, 'Scout', 1);
  assert.match(disk.readSoul(cfg, 'scout'), /Personal voice/);
  done();
});

test('marketing intent wins over a literal URL and an available scout', async () => {
  const helpers = [{ id: 'scout', display: 'Scout', role: 'research' }];
  assert.equal((await route({ text: 'https://trymuxr.com/', earlier: 'i want to market my app' }, helpers)).answer, 'chief');
});
