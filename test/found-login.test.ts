// A login the person's own CLI holds on this computer: offered on the card, used only after a yes, proved by one real reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSaid, settled, setup, task, until } from './lab.ts';

/** A computer with Claude Code signed in and nothing else: the shape the engine reports for it. */
function foundClaude() {
  const lab = setup(), rt = lab.crew.runtime as any;
  rt.signedIn = async (account: string) => account === 'claude';
  rt.found = async (account: string) => account === 'claude';
  const run = rt.run.bind(rt), ran: string[] = [];
  rt.run = (o: any, ...rest: unknown[]) => { ran.push(o.account); return run(o, ...rest); };
  return { ...lab, ran };
}
const row = async (lab: { crew: ReturnType<typeof setup>['crew'] }, key: string) => (await lab.crew.accounts.list()).find((a) => a.account === key)!;

test('a found login never runs a job until the person says yes, then the waiting job is the reply', async () => {
  const lab = foundClaude(), id = (lab.crew as any).addTask('chief', 'Say something', 'person', undefined).task;
  await settled(lab.db, id);
  assert.equal(task(lab.db, id).state, 'paused');
  assert.deepEqual(lab.ran, []);
  assert.match(task(lab.db, id).result, /^Waiting for you to sign in/);
  assert.deepEqual([(await row(lab, 'claude')).found, (await row(lab, 'claude')).signedIn], [true, false]);
  assert.equal((await row(lab, 'grok')).found, false);

  await lab.crew.useFound('claude');
  await until('the waiting job to finish', () => task(lab.db, id).state === 'done');
  assert.deepEqual(lab.ran, ['claude']);
  assert.ok(lastSaid(lab.db, 'chief'));
  assert.deepEqual([(await row(lab, 'claude')).found, (await row(lab, 'claude')).signedIn], [false, true]);
  lab.done();
});

test('a yes with nothing waiting still sends one real reply', async () => {
  const lab = foundClaude();
  await lab.crew.useFound('claude');
  await until('Chief to reply', () => lab.db.get("SELECT 1 FROM tasks WHERE bot = 'chief' AND state = 'done'"));
  assert.equal(lab.db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'person'")?.text, 'Yes, use Claude'); // the tap in the thread, never words they did not say
  assert.ok(lastSaid(lab.db, 'chief'));
  lab.done();
});

test('a yes for an account nothing was found for changes nothing', async () => {
  const lab = foundClaude();
  await lab.crew.useFound('grok');
  assert.equal((await row(lab, 'grok')).signedIn, false);
  assert.equal(lab.db.get('SELECT 1 FROM tasks'), undefined);
  lab.done();
});

test('after a first finished job a found login needs no more asking, as an install in use always ran', async () => {
  const lab = foundClaude(), id = (lab.crew as any).addTask('chief', 'Say something', 'person', undefined).task;
  await settled(lab.db, id);
  lab.db.run("UPDATE tasks SET state = 'done' WHERE id = ?", id);
  assert.deepEqual([(await row(lab, 'claude')).found, (await row(lab, 'claude')).signedIn], [false, true]);
  lab.done();
});
