// The result receipt: a helper's thread marks Done on the line crewd ended a task on — its result reply — only once crewd
// ended the task done; never while it works, on a question back, or when it is unsure, failed or stopped. Chief's thread
// marks his line passing a helper's result on, by the same rule, read from the snapshot's tasks.
// Real path: the stub runs the job, crewd writes the lines and the task, botPage serves them, the adapter reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, settled, holding, release, task } from './lab.ts';
import * as A from '../web/src/adapter.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const sheet = { name: 'Reception', sheets: [{ name: 'Today', columns: [{ header: 'Guest' }, { header: 'Room' }], rows: [['Amina', '204']] }] };
const marked = (crew: any, bot: string, around?: number) => A.lines(crew.botPage(bot, around), bot).filter((l) => l.done);

test('a done job is marked once, on its result; working, a question back, unsure and stopped jobs are not', async () => {
  const { crew, db } = setup();
  crew.onboard('Umer');
  crew.recruit('scribe', 'Quill', 'person');

  // The helper turn ended; the original task awaits Chief review, not finished: no mark.
  const q = crew.assign('quill', 'make a reception sheet, ask permission first', 'chief').task;
  await holding(crew, 'quill');
  await release(crew, 'quill', 'Is this the desk’s own day sheet, or the manager’s log?');
  await settled(db, q);
  assert.equal(task(db, q).state, 'needs_you');
  assert.deepEqual(marked(crew, 'quill'), [], 'a question is not a finished job');

  // Mid-job: the sheet is already delivered, but the turn is held, so nothing says done yet.
  const held = crew.assign('quill', `the desk's own ${call('crew_workbook', sheet)} then ask permission`, 'chief').task;
  await holding(crew, 'quill');
  assert.equal(task(db, held).state, 'working');
  assert.ok(A.lines(crew.botPage('quill'), 'quill').some((l) => l.files.some((f) => f.kind === 'sheet')), 'the file shows as it lands');
  assert.deepEqual(marked(crew, 'quill'), [], 'a delivered file is not a finished job');

  await release(crew, 'quill', 'The reception sheet is ready: one sheet for today.');
  await settled(db, held);
  assert.equal(task(db, held).state, 'done');
  const ls = A.lines(crew.botPage('quill'), 'quill');
  const [r, ...more] = marked(crew, 'quill');
  assert.equal(more.length, 0);
  assert.equal(r.text, 'The reception sheet is ready: one sheet for today.', 'the mark sits on the job\'s own result');
  assert.ok(db.get('SELECT 1 FROM messages WHERE id = ? AND task_id = ?', r.id, held), 'crewd\'s own message id');
  const note = ls.find((l) => l.files.some((f) => f.kind === 'sheet'))!;
  assert.ok(note.about && ls.findIndex((l) => l.id === note.id) === ls.findIndex((l) => l.id === r.id) - 1, 'the preview sits right above, with crewd\'s own words');

  // Opened on an old line, a window that leaves out the result marks nothing in its place.
  assert.deepEqual(marked(crew, 'quill', note.id).map((l) => l.id), [r.id]);
  const q2 = crew.assign('quill', 'a second sheet, ask permission first', 'chief').task;
  await holding(crew, 'quill');
  const asked = db.get("SELECT id FROM messages WHERE bot = 'quill' AND author = 'person' AND task_id = ?", q2)!.id;
  await release(crew, 'quill', 'Here it is.');
  await settled(db, q2);
  const page = crew.botPage('quill');
  page.messages = page.messages.filter((m: any) => m.id <= asked); // the window ends before the result
  assert.ok(!A.lines(page, 'quill').some((l) => l.done && l.id > r.id));

  // It acted and said it didn't see it work: unsure, in crewd's words, with no mark.
  const unsure = crew.assign('quill', `book it ${call('crew_outcome', { worked: false, seen: 'No confirmation came.' })}`, 'chief').task;
  await settled(db, unsure);
  assert.equal(task(db, unsure).state, 'unsure');
  const after = A.lines(crew.botPage('quill'), 'quill');
  assert.ok(after.at(-1)!.unsure && !after.at(-1)!.done);

  // Stopped by the person: failed in crewd, no line written, so nothing is marked.
  const stopped = crew.assign('quill', 'one more sheet, ask permission first', 'chief').task;
  await holding(crew, 'quill');
  await crew.resetBot('quill');
  await settled(db, stopped);
  assert.equal(task(db, stopped).state, 'failed');
  assert.deepEqual(marked(crew, 'quill').map((l) => l.text), ['The reception sheet is ready: one sheet for today.', 'Here it is.']);
  assert.ok(!A.lines(crew.botPage('quill'), 'quill').some((l) => l.failed));

  // Chief's thread is marked only from the snapshot's tasks: without them, no marks there.
  assert.ok(!A.lines(crew.botPage('chief'), 'chief').some((l) => l.done));
});

test('Chief\'s line passing on a helper\'s finished job carries the receipt; an unsure one does not', async () => {
  const { crew, db, done } = setup();
  try {
    crew.onboard('Umer');
    crew.recruit('scribe', 'Quill', 'person');
    const made = crew.assign('quill', `the reception sheet ${call('crew_workbook', sheet)}`, 'chief').task;
    await settled(db, made);
    assert.equal(task(db, made).state, 'done');
    const ls = A.lines(crew.botPage('chief'), 'chief', crew.snapshot());
    const relay = ls.filter((l) => l.done);
    assert.deepEqual(relay.map((l) => l.by), ['quill'], 'one mark, on Chief\'s line, naming whose job it was');
    assert.equal(db.get('SELECT task_id FROM messages WHERE id = ?', relay[0].id)!.task_id, made, 'crewd\'s own task on crewd\'s own line');
    const unsure = crew.assign('quill', `book it ${call('crew_outcome', { worked: false, seen: 'No confirmation came.' })}`, 'chief').task;
    await settled(db, unsure);
    assert.equal(task(db, unsure).state, 'unsure');
    assert.deepEqual(A.lines(crew.botPage('chief'), 'chief', crew.snapshot()).filter((l) => l.done).map((l) => l.id), [relay[0].id], 'an unsure job is never marked done');
  } finally { done(); }
});

test('a failed job\'s own line stands apart; a wordless done job is marked on its file; old lines stay as they were', () => {
  const page = { messages: [{ id: 1, author: 'person', text: 'make it', task_id: 4 }, { id: 2, author: 'bot', text: 'Took longer than an hour, so I stopped it.', task_id: 4 },
    { id: 3, author: 'bot', text: 'Hello' }, { id: 4, author: 'system', text: 'Delivered files/x.patch: Suggested change (for the maintainer to review): passed its own check', task_id: 5 }],
  tasks: [{ id: 4, state: 'failed', result: 'Took longer than an hour, so I stopped it.' }, { id: 5, state: 'done', result: 'Done.' }] };
  const ls = A.lines(page, 'quill');
  assert.deepEqual(ls.map((l) => [!!l.failed, !!l.done]), [[false, false], [true, false], [false, false], [false, true]]);
  assert.equal(ls[3].text, 'Suggested change (for the maintainer to review): passed its own check', 'crewd\'s words stay');
});

test('Chief\'s thread marks Done only on his line passing on a job crewd ended done, naming whose it was', () => {
  const page = { messages: [
    { id: 1, author: 'bot', text: 'The birthday video is ready.', task_id: 10 },
    { id: 2, author: 'bot', text: 'Scout booked it, but no confirmation came.', task_id: 11 },
    { id: 3, author: 'bot', text: "Pip couldn't finish the renewal.", task_id: 12 },
    { id: 4, author: 'bot', text: 'Scribe has a draft for you to look at.', task_id: 13 },
    { id: 5, author: 'bot', text: 'Which photos should Reel use?', task_id: 10 },
    { id: 6, author: 'bot', text: 'Hello' },
    { id: 7, author: 'person', text: 'thanks', task_id: 10 },
  ] };
  const state = { tasks: [{ id: 10, bot: 'reel', state: 'done' }, { id: 11, bot: 'scout', state: 'unsure' },
    { id: 12, bot: 'pip', state: 'failed' }, { id: 13, bot: 'scribe', state: 'needs_you' }] };
  assert.deepEqual(A.lines(page, 'chief', state).filter((l) => l.done).map((l) => [l.id, l.by]), [[1, 'reel']],
    'never unsure, failed, waiting, a question back, his own words or the person\'s');
  assert.ok(!A.lines(page, 'chief').some((l) => l.done), 'no snapshot, no mark');
  assert.ok(!A.lines(page, 'chief', { tasks: state.tasks.map((t) => ({ ...t, state: 'working' })) }).some((l) => l.done), 'still working: no mark');
});

test('Done renders with Watch only where the helper has a computer and the home computer answers', () => {
  const web = readFileSync(new URL('../web/src/main.tsx', import.meta.url), 'utf8');
  // One receipt for both threads: the helper's own, or on Chief's line the helper it passes on.
  assert.match(web, /l\.done && <Receipt who=\{h \?\? crew\.find\(\(x\) => x\.id === l\.by\)\} offline=\{offline\} \/>/);
  assert.match(web, /function Receipt[^\n]*\n[^\n]*<b>Done<\/b>[^\n]*who\?\.computer && !offline && <a className="link" href=\{`#\/h\/\$\{who\.id\}\/screen`\}>Watch \{who\.name\}/);
  assert.match(web, /lines\(page, id, state\)/, 'Chief\'s thread gets the snapshot its marks come from');
  assert.match(web, /l\.unsure \|\| l\.failed \? ' unsure'/);
  const phone = readFileSync(new URL('../mobile/App.tsx', import.meta.url), 'utf8');
  assert.match(phone, /l\.done && \(\(\) => \{ const w = l\.by \?[^\n]*\n[^\n]*✓ Done[^\n]*\n[^\n]*!offline && w\?\.computer && desktopAvailable && <Btn ghost label=\{`Watch \$\{w\.name\}`\} onPress=\{\(\) => go\(\{ view: 'helper', id: w\.id, tab: 'watch' \}\)\}/);
  assert.match(phone, /A\.lines\(page, id, state\)/);
  assert.match(phone, /l\.unsure \|\| l\.failed/);
});
