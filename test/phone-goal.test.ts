// The phone's goal screens read crewd's own board through the shared view model: every role in its stage, Home's count
// the board's, and only the person's moves on a role. Submitting is never one of them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setup, settled } from './lab.ts';
import * as A from '../web/src/adapter.ts';
import { roleActions } from '../mobile/src/goal.ts';

const call = (tool: string, input: object) => `[tool ${tool} ${JSON.stringify(input)}]`;
const CV = `Umer Anjum
Led a team of four building a payments dashboard in React and TypeScript
Wrote the Node.js API behind a mobile banking app`;

test('the phone board maps crewd roles to their stages, and a role offers only the person\'s moves', async () => {
  const srv = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>Engineer</h1><p>Salary: £55,000 to £65,000 a year. React, TypeScript.</p>'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  after(() => { srv.closeAllConnections(); srv.close(); });
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const { db, crew } = setup();
  crew.onboard('Umer');
  await settled(db, (await crew.post('chief', `Find me roles ${call('crew_goal', { title: 'Frontend engineer', places: 'London or remote', floor: '', cv: CV })}`))!.task);
  await crew.answer(db.get("SELECT id FROM asks WHERE kind = 'propose' AND state = 'open'")!.id, { answer: 'allow' });
  const state0 = crew.snapshot().jobs.goal, g = A.goal(crew.snapshot())!, fit = [{ says: 'You led a payments dashboard', cv: 'Led a team of four building a payments dashboard in React and TypeScript' }];
  for (const [n, co, pay] of [[1, 'Northwind', '£55,000 to £65,000 a year'], [2, 'Fernhill', ''], [3, 'Oakline', '']])
    await settled(db, (await crew.post(state0.rae, `look ${call('crew_role', { company: co, title: 'Frontend Engineer', place: 'London', url: `${base}/job/${n}`, pay, missing: 'GraphQL is not on your CV', fit })}`))!.task);
  const id = (co: string) => crew.snapshot().jobs.roles.find((r: { co: string }) => r.co === co).id;
  await settled(db, crew.draftRole(id('Northwind')).task);
  await settled(db, (await crew.post(g.will, `draft ${call('crew_application', { role: id('Northwind'), cv: [fit[0].cv], answers: [{ ask: 'Why Northwind?', answer: 'I build payments dashboards.' }] })}`))!.task);
  db.run('UPDATE roles SET stage = ? WHERE id = ?', 'interview', id('Oakline')); // as the person's two taps leave it

  const state = crew.snapshot(), board = A.goal(state)!;
  assert.deepEqual(board.cols.map((c) => [c.name, c.roles.map((r) => r.co)]), [['Found', ['Fernhill']], ['Drafted', ['Northwind']], ['Applied', []], ['Interview', ['Oakline']], ['Offer', []]]);
  assert.equal(board.cols.reduce((n, c) => n + c.roles.length, 0), state.jobs.roles.length, "Home's count is the board's");
  const north = board.cols[1].roles[0], fern = board.cols[0].roles[0];
  assert.equal(north.pay, '£55,000 to £65,000 a year');
  assert.equal(fern.pay, 'Pay not in the posting');
  assert.deepEqual(north.fit, ['You led a payments dashboard']);
  assert.equal(north.gap, 'GraphQL is not on your CV');
  assert.equal(north.source, 'the company\'s website', 'a local address is never shown');

  assert.deepEqual(roleActions(fern).map((a) => a.label), ['Draft my application', 'Not for me']);
  assert.deepEqual(roleActions(north).map((a) => a.label), ['I applied', 'Not for me']);
  assert.deepEqual(roleActions(board.cols[3].roles[0]).map((a) => a.label), ['Prep for this interview', 'I have an offer']);
  for (const stage of ['found', 'drafted', 'applied', 'interview', 'offer']) for (const prep of [undefined, { brief: [], questions: [], yours: [] }])
    for (const a of roleActions({ ...north, stage, prep, next: stage === 'applied' ? ['interview', 'I have an interview'] : undefined }))
      assert.doesNotMatch(a.label, /submit|send|apply now/i, 'a role never offers to submit');

  // The writer's draft waits on its role: what only the person answers is listed and blank, and its yes copies, never submits.
  const draft = A.cards(state).find((c) => state.asks.find((a: { id: number }) => a.id === c.id)?.detail?.draft?.role === north.id)!;
  assert.ok(draft.yours?.includes('Expected salary') && draft.yours.includes('Your right to work'));
  assert.deepEqual(draft.choices.map((c) => c.label), ['Copy and open the form', 'Not now']);
});
