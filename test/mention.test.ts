// The @mention bus end to end on the stub model and the real, pinned NATS server (CREWHOUSE_NATS_BIN; skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, until, task } from './lab.ts';

const bin = process.env.CREWHOUSE_NATS_BIN, ask = (to: string, text: string) => `[tool crew_mention ${JSON.stringify({ to, text })}]`;
const said = (db: any, bot: string) => db.all('SELECT author, text FROM messages WHERE bot = ? ORDER BY id', bot);
const crewOf = () => { const l = setup(3, { natsBin: bin! }); l.crew.onboard('Umer'); return { ...l, a: l.crew.recruit('scout', undefined, 'person'), b: l.crew.recruit('scribe', undefined, 'person'), c: l.crew.recruit('reverse', undefined, 'person') }; };

test('a mention lands in the target\'s chat, starts its job once, and its answer comes back to the sender', { skip: !bin }, async () => {
  const { db, crew, done, a, b } = crewOf();
  const first = (crew as any).addTask(a.id, `Ask ${b.display}. ${ask(b.id, 'watch the job board')}`, 'person').task;
  await until('the mention became a job', () => db.get('SELECT * FROM tasks WHERE bot = ? AND origin = ?', b.id, a.id));
  const job = db.get('SELECT * FROM tasks WHERE bot = ?', b.id)!;
  assert.equal(job.parent, first);
  assert.ok(said(db, b.id).some((m: any) => m.author === a.id && m.text === `From @${a.display}: watch the job board`), 'the target\'s chat shows the hand-off');
  assert.ok(said(db, a.id).some((m: any) => m.author === 'system' && m.text === `Asked ${b.display}: watch the job board`), 'the sender\'s chat shows it too');
  await until('the target finished', () => task(db, job.id).state === 'done');
  await until('the answer came back', () => said(db, a.id).some((m: any) => m.author === b.id));
  assert.equal(db.get('SELECT state FROM bus')?.state, 'done');
  await crew.stop(); done();
});

test('a ring of mentions stops at the hop cap with a card, and a repeated delivery starts one job', { skip: !bin }, async () => {
  const { db, crew, done, a, b, c } = crewOf(), bus = (crew as any).bus;
  const first = (crew as any).addTask(a.id, 'Start the ring', 'person').task, jobOf = (bot: string) => db.get('SELECT * FROM tasks WHERE bot = ? AND origin != ? ORDER BY id DESC', bot, 'person');
  bus.mention(a.id, task(db, first), b.id, 'one');
  await until('b has its job', () => jobOf(b.id)); bus.mention(b.id, jobOf(b.id), c.id, 'two');
  await until('c has its job', () => jobOf(c.id)); bus.mention(c.id, jobOf(c.id), a.id, 'three');
  await until('a has its job', () => jobOf(a.id));
  assert.throws(() => bus.mention(a.id, jobOf(a.id), b.id, 'four'), /passed along too many times/);
  assert.ok(said(db, b.id).some((m: any) => m.text === `${a.display} and ${b.display} kept passing this back, so I stopped it.`), 'the card is in both chats');
  assert.equal(db.all('SELECT 1 FROM bus').length, 3);
  assert.throws(() => bus.mention(b.id, jobOf(b.id), c.id, 'two'), /kept passing|already asked/);
  const row = db.get('SELECT * FROM bus ORDER BY id')!, n = db.all('SELECT 1 FROM tasks WHERE bot = ?', row.to_bot).length, nats = await bus.open();
  await nats.publish(`crew.mention.${row.to_bot}.${row.chain}`, JSON.stringify({ id: row.id }), 'late-repeat'); // a repeat after the dedupe window carries a new message id
  // A fresh mention to the same bot queues behind the repeat on its one reader: when its job exists, the repeat has been read.
  const other = (crew as any).addTask(c.id, 'A second errand', 'person').task;
  bus.mention(c.id, task(db, other), row.to_bot, 'sentinel');
  await until('the sentinel job', () => db.all('SELECT 1 FROM tasks WHERE bot = ?', row.to_bot).length > n);
  assert.equal(db.all('SELECT 1 FROM tasks WHERE bot = ?', row.to_bot).length, n + 1, 'the repeat started nothing');
  await crew.stop(); done();
});
