// Live member selection and approval cards: a house-level setup ask reaches both the
// owner's list and the asker's card (answering stays the owner's), and one member's
// parked permission card never answers another member's wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { setup, until } = await import('./lab.ts');

const house = () => {
  const l = setup();
  l.crew.onboard('sir');
  l.crew.recruit('scout', 'Scout', 'person');
  const sam = l.crew.addMember('Sam').id as number;
  return { ...l, sam };
};

test('a family setup ask is the owner\u2019s to-do and the asker\u2019s Asked state; only the owner decides', async () => {
  const { db, crew, sam, done } = house();
  const ask = crew.askSetup('calendar', sam);
  assert.equal(db.get('SELECT member FROM asks WHERE id = ?', ask.id)?.member, 1, 'the card belongs to the owner');
  const ownerSees = crew.snapshot(1).asks.find((a: any) => a.kind === 'setup');
  const samSees = crew.snapshot(sam).asks.find((a: any) => a.kind === 'setup');
  assert.ok(ownerSees, 'the owner sees the to-do');
  assert.ok(samSees, 'the asker keeps the Asked state on her own card');
  assert.equal(samSees.detail.app, 'calendar');
  const alex = crew.addMember('Alex').id as number;
  assert.equal(crew.snapshot(alex).asks.some((a: any) => a.kind === 'setup'), false, 'an uninvolved member sees neither the asker nor the app');
  await assert.rejects(crew.answer(ask.id, { answer: 'allow' }, sam), /someone else/, 'the asker cannot decide it');
  assert.equal((await crew.answer(ask.id, { answer: 'allow' }, 1)) ?? null, null, 'the owner decides');
  assert.equal(db.get('SELECT state FROM asks WHERE id = ?', ask.id)?.state, 'answered');
  done();
});

test('a parked permission card stays with its member: no cross-member takeover', async () => {
  const { db, crew, sam, done } = house();
  const words = 'Scout would like to read the house notes';
  const t1 = Number(db.run("INSERT INTO tasks (bot, title, body, state, member) VALUES ('scout','t1','b1','working',1)").lastInsertRowid);
  const t2 = Number(db.run("INSERT INTO tasks (bot, title, body, state, member) VALUES ('scout','t2','b2','working',?)", sam).lastInsertRowid);
  const p1 = (crew as any).ask('scout', db.get('SELECT * FROM tasks WHERE id = ?', t1), { kind: 'allow', words, key: 'notes.read' });
  await until('owner parked', () => db.get("SELECT 1 FROM events WHERE kind = 'ask.parked' AND json_extract(data, '$.task') = ?", t1));
  assert.equal(await p1, null, 'the owner is away: the turn parks');
  const p2 = (crew as any).ask('scout', db.get('SELECT * FROM tasks WHERE id = ?', t2), { kind: 'allow', words, key: 'notes.read' });
  await until('sam card', () => db.get("SELECT 1 FROM asks WHERE title = ? AND state = 'open' AND member = ?", words, sam));
  const cards = db.all('SELECT member FROM asks WHERE title = ? AND state = \'open\'', words).map((a: any) => a.member).sort();
  assert.deepEqual(cards, [1, sam], 'each member gets her own card');
  const ownerCard = db.get('SELECT id FROM asks WHERE title = ? AND state = \'open\' AND member = 1', words)!.id;
  await crew.answer(ownerCard, { answer: 'allow' }, 1);
  const samCard = db.get('SELECT * FROM asks WHERE title = ? AND state = \'open\' AND member = ?', words, sam)!;
  assert.ok(samCard, 'the owner\u2019s yes does not consume Sam\u2019s card');
  assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', t2)?.state, 'needs_you', 'Sam\u2019s task still waits on her');
  const raced = await Promise.race([p2.then((v: null) => `resolved:${v}`), Promise.resolve('pending')]);
  assert.equal(raced, 'pending', 'Sam\u2019s wait is not answered by the owner\u2019s decision');
  await crew.answer(samCard.id, { answer: 'deny' }, sam);
  await p2;
  done();
});
