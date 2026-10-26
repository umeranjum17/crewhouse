// The owner's four-turn complaint, exercised through the real Crew and its stub engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setup, settled, delegated, until } from './lab.ts';
import { taskTitle, relayResult } from '../src/crew.ts';
import { TOOLS } from '../src/openclaw/runtime.ts';
import { chatTokens, safeLink } from '../web/src/chat-md.ts';
import * as A from '../web/src/adapter.ts';
import * as disk from '../src/bots.ts';

const turns = ['hi', 'how do i pair my computer with you?', 'i want to market my app', 'https://trymuxr.com/'];
const bad = (text: string) => {
  assert.equal((text.match(/\bsir\b/gi) ?? []).length, 0, text);
  assert.doesNotMatch(text, /Delighted|To think|at your service|glad to be back at work|https?:\/\/|\[[^\]]+\]\(|\*\*|\w+:\s*Sir,/i);
};

test('Chief: the four turns stay in Chief, URLs are context not task names, relays are his words', async () => {
  const { crew, db, done } = setup();
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  crew.phoneLink = { offer: async () => ({ qr: 'byokit-link:1:demo', typed: '23456-789AB', expires: Date.now() + 120_000, urls: [] }), status: () => ({ asking: [] }) as any };
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  for (const text of turns) {
    const r = await crew.post('chief', text) as { task?: number } | undefined;
    if (r?.task) await settled(db, r.task);
  }
  const chiefTasks = db.all("SELECT * FROM tasks WHERE bot = 'chief' ORDER BY id");
  assert.equal(chiefTasks.length, 3, 'pairing needs no model task; marketing intent stays with Chief even with Scout in the roster');
  assert.equal(crew.botPage('chief').phoneOffer?.typed, '23456-789AB');
  assert.equal(chiefTasks.at(-1)!.title, 'Work on trymuxr.com');
  assert.equal(chiefTasks.at(-1)!.body, 'https://trymuxr.com/');
  const first = (crew as any).prompt(chiefTasks.at(-1));
  assert.match(first, /Earlier in this chat:[\s\S]*market my app/);
  assert.match(first, /The person's name is "Umer"/, 'the first greeting carries her chosen name: the model saw it');
  assert.doesNotMatch(first, /, Sir\b|"Sir"|Madam|at your service|glad to be back at work/i, 'no butler words reach the model');
  assert.doesNotMatch(first, /Templates:/, 'roster and templates ride crew_roster on demand, not every prompt');
  assert.match(first, /Crew: Scout \(id scout\)\./, 'the crew line names who is on, nothing stale');
  const helper = delegated(crew, 'scout', 'https://trymuxr.com/\n[tool crew_document {"name":"muxr launch plan","blocks":[{"heading":"Audience"},{"text":"Developers with coding agents"},{"heading":"Three channels"},{"heading":"First week of posts"}]}]').task;
  assert.equal(db.get('SELECT title FROM tasks WHERE id = ?', helper)!.title, 'Work on trymuxr.com');
  await settled(db, helper);
  await until('the check settles', () => db.get("SELECT 1 FROM events WHERE kind = 'check.result'")); // Rae's answer waits for Vera; the closing line follows
  const words = crew.botPage('chief').messages.filter((m) => m.author === 'bot').map((m) => m.text);
  words.forEach(bad);
  assert.match(words.at(-1)!, /^The muxr launch plan is ready: audience, three channels, first week of posts\./);
  assert.doesNotMatch(words.at(-1)!, /A document in|\b\d+ sections?\b|^\w+: /i);
  assert.doesNotMatch(words.at(-1)!, /stub scout|Sir:|“/);
  const relay = crew.botPage('chief').messages.findLast((m) => m.author === 'bot' && m.text.startsWith('The muxr launch plan is ready'));
  assert.equal(relay?.files.length, 1, 'the delivered document is attached to the relay');
  assert.equal(words.filter((w) => w.startsWith('The muxr launch plan is ready')).length, 1, 'a finished single-helper job has exactly one Chief closing line');
  assert.match(relay?.files[0].path ?? '', /\.docx$/);
  delete process.env.CREWHOUSE_STUB_GOLDEN;
  done();
});

test('a send the engine never answers never leaves the message bare: Chief speaks for himself with Try again, a helper names itself', async () => {
  const { crew, db, done } = setup();
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  try {
    crew.onboard('Umer');
    crew.recruit('scout', 'Scout', 'person');
    const hi = await crew.post('chief', 'hi') as { task?: number } | undefined;
    if (hi?.task) await settled(db, hi.task);
    // No scripted answer: the golden stub gives no reply at all, like an engine that never answers.
    const r = await crew.post('chief', 'quux wobble fnord, nothing scripted answers this') as { task?: number } | undefined;
    assert.ok(r?.task);
    await settled(db, r.task);
    const t = db.get('SELECT * FROM tasks WHERE id = ?', r.task)!;
    assert.equal(t.bot, 'chief');
    assert.equal(t.state, 'failed');
    assert.equal(t.result, "I couldn't finish this one.");
    const page = crew.botPage('chief'), state = crew.snapshot(), lines = A.lines(page, 'chief', state);
    assert.match(lines.map((l) => l.text).join('\n'), /I couldn't finish this one\./);
    // The Try again button carries the retry on Chief's line, so the words are not repeated in the text.
    assert.ok(lines.some((l) => l.text === "I couldn't finish this one." && l.retry === 'quux wobble fnord, nothing scripted answers this'));
    // Every send is answered: no two person lines in a row, and the header names the failure, never Free.
    assert.ok(!lines.some((l, i) => l.from === 'me' && lines[i + 1]?.from === 'me'), 'a bare message with no answer');
    assert.match(A.chief(state).line, /couldn't finish/);
    // A helper's failure still names the helper, and keeps its own Try again words (no button in a helper's chat).
    const h = await crew.post('scout', 'quux wobble fnord, nothing scripted answers this either') as { task?: number } | undefined;
    assert.ok(h?.task);
    await settled(db, h.task);
    assert.equal(db.get('SELECT * FROM tasks WHERE id = ?', h.task)!.result, "Scout couldn't finish this one. Try again.");
    assert.match(A.lines(crew.botPage('scout'), 'scout', crew.snapshot()).map((l) => l.text).join('\n'), /Scout couldn't finish this one\. Try again\./);
  } finally {
    delete process.env.CREWHOUSE_STUB_GOLDEN;
    done();
  }
});

test('title, relay and markdown trust boundary', () => {
  assert.match(disk.addressLine('Sir'), /at most once/);
  assert.doesNotMatch(disk.addressLine('Sir'), /^Address the person as/);
  assert.equal(taskTitle('https://trymuxr.com/'), 'Work on trymuxr.com');
  bad(relayResult('**Your launch plan is ready:** lead with X.\n- more'));
  assert.equal(relayResult('**Your launch plan is ready:** lead with X.\n- more'), 'Your launch plan is ready: lead with X.');
  assert.equal(relayResult('done', 'A document in 2 sections: muxr launch plan'), 'The muxr launch plan is ready.');
  assert.equal(relayResult('The full investment brief is ready.', 'A document in 6 sections: How can $50,000 for a home down payment in fi, answer, findings, strategies and caveats'.repeat(2)), 'The full investment brief is ready.', 'long delivery notes never create a cut-off title');
  assert.doesNotMatch(relayResult('done', 'The launch plan is ready: audience and first posts.'), /A document in|\b\d+ sections?\b|^\w+: /i);
  assert.equal(relayResult('Start with this pitch: “' + 'a'.repeat(175) + '.” The two-week launch plan and first drafts are ready.'), 'The two-week launch plan and first drafts are ready.');
  assert.equal(relayResult('A very long unfinished headline ' + 'words '.repeat(40)), 'A very long unfinished headline ' + 'words '.repeat(21).trim() + '…');
  assert.doesNotMatch(relayResult('A long ' + 'word '.repeat(40) + '. The plan is ready.'), /…|\.\.\./);
  assert.equal(relayResult('I found that your three overdue invoices need attention before Friday because the water bill and dentist bill both carry late fees, while the phone bill can wait until next month without an extra charge.'), 'I found that your three overdue invoices need attention before Friday because the water bill and dentist bill both carry late fees, while the phone bill can…');
  assert.equal(relayResult('- Water bill due Friday\n- Dentist bill due Friday\n- Phone bill due next month'), 'Water bill due Friday…');
  assert.equal(relayResult('Scout is preparing the report;\n- Water bill due Friday'), 'Water bill due Friday…');
  assert.equal(relayResult('*** — …'), 'The result is ready.');
  assert.equal(relayResult(''), 'The result is ready.');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('https://trymuxr.com/'), 'https://trymuxr.com/');
  for (const mark of ['”', '’', ')', ']', '.', ',', ';', ':']) assert.equal(safeLink(`https://trymuxr.com/quickstart${mark}`), 'https://trymuxr.com/quickstart');
  assert.equal(safeLink('javascript:alert(1)”'), '');
  assert.deepEqual(chatTokens('## Plan\n\n- [x] **Draft** [site](https://trymuxr.com/)\n\n| A | B |\n|---|---|\n| 1 | 2 |').filter((t) => !['space'].includes(t.type)).map((t) => t.type), ['heading', 'list', 'table']);
});

test('the live system prompt stays brief, answers first, and honors a chosen address once', () => {
  const { cfg, crew, done } = setup();
  // Frozen at 11,150 chars. Re-frozen from 10,885 for the plain-words rule (docs/plain-words.md) each template's
  // soul and AGENTS now point at: one short line each, +226 on Chief's prompt. Before that, 10,685 → 10,885 for
  // Chief's plain "What can you do?" answer (what the crew really does, the yes before buying or sending, routines,
  // Google, one next step: +245 net after dropping the lines it replaces), and 10,386 → 10,685 for marketplace
  // import. The guard is still a plain length check; P7's note stands, the prompt no longer varies with HOME.
  // Re-frozen 11,150 -> 11,220 for picked helper names on the plain-words rebase (ch-helper-names,
  // Firstmate decision B-plain): the longer job-word-plus-first-name crew names across Chief's crew lines.
  // Re-frozen 11,220 -> 11,644 for the chat-quality slice (ch-chat-quality-core): Chief makes the document a person
  // asks him for in his own chat, and never calls a routine set before they tap Start it (+424). 11,644 -> 11,727: the
  // same slice, a reminder the person asks for is their own routine rather than a helper hire (+83).
  const prompt = disk.systemPrompt(cfg, 'chief', true), soul = readFileSync(join(cfg.repoDir, 'templates', 'chief', 'soul.md'), 'utf8');
  assert.ok(prompt.startsWith(`${soul.trim()}\n\n`), 'Chief carries his soul in session context, not the shared workspace');
  // The same two budgets: the soul moved into this string; the job's allowance does not grow.
  const job = prompt.slice(soul.trim().length + 2);
  assert.ok(job.length <= 11_727, `Chief prompt grew past its frozen size (job ${job.length})`);
  assert.ok(soul.length <= disk.SOUL_CAP, `Chief soul past SOUL_CAP (${soul.length})`);
  assert.doesNotMatch(soul, /on every line/, 'the soul never permits an occasional Sir');
  assert.match(soul, /no "Sir", no "Madam"/, 'Chief never titles the person');
  // Every agent, Chief included, carries the same model-visible tool descriptions: no new ABOUT text.
  // Re-frozen from 2742 for crew_import's auto description (+60 against existing headroom, net +3), then from 2745
  // for crew_unlock's (+59), then to 2856 for crew_case's (+52, ch-notice-followup), then to 2915 for crew_use's auto description (+59, ch-subs-engine), then to 3300 for crew_goal, crew_role and crew_application (ch-jobs-loop-build).
  assert.ok(TOOLS.reduce((n, t) => n + t.description.length, 0) <= 3300, 'TOOLS descriptions grew past 3300 chars');
  for (const tpl of disk.listTemplates(cfg)) {
    if (tpl.hidden) continue;
    crew.recruit(tpl.id, tpl.display, 'person');
    const prompt = disk.systemPrompt(cfg, tpl.id, false);
    assert.match(prompt, /## How you answer/);
    assert.ok(prompt.length < 5_250, `${tpl.id}: ${prompt.length}`);
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
  disk.upgradeFolder(cfg, 'scout', tpl, 'Scout');
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), original);
  disk.writeSoul(cfg, 'scout', '# Scout\n\nPersonal voice.');
  disk.upgradeFolder(cfg, 'scout', tpl, 'Scout');
  assert.match(disk.readSoul(cfg, 'scout'), /Personal voice/);
  done();
});
