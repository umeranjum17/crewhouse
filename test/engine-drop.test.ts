// The engine gateway can restart or drop while a helper is working (seen in the ch-gr-pass-files real replay, 7 Oct
// 2026: a SIGTERM-driven 'restart drain' shutdown). The run then ends with an engine error, and the abort that
// Crew.close issues for it rejects because the gateway is gone, exactly as OpenClawKit.abort does since 0.9.0.
// crewd must stay up and the open task must end with a plain note for the person, never take the daemon down.
// Stub engine: no account, no network, no quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, holding, release, until, task } from './lab.ts';

test('the engine dropping mid-task ends the task with a plain note and leaves crewd up', async () => {
  const { db, crew, done } = setup();
  crew.onboard('Umer');
  crew.recruit('scout', 'Scout', 'person');
  // The engine boundary, stood in for: while dropped, a run ends the way the engine reports a lost gateway, and
  // abort rejects (OpenClawKit.abort's contract after a drop since 0.9.0: it always returns a Promise).
  const stub = crew.runtime as any, run = stub.run.bind(stub), abort = stub.abort.bind(stub);
  let dropped = false;
  stub.run = async (spec: any, on: any) => {
    const end = await run(spec, on); // the stub's turn, held until release
    return dropped ? { ok: false, kind: 'other', message: 'gateway closed (1006): ' } : end;
  };
  const r = await crew.post('scout', 'ask permission before you begin') as { task: number };
  await holding(crew, 'scout');
  stub.abort = () => Promise.reject(new Error('gateway not ready'));
  dropped = true;
  release(crew, 'scout');
  await until('the dropped task to end', () => task(db, r.task)?.state === 'failed');
  assert.match(task(db, r.task).result ?? '', /couldn't finish this one\. Try again\./, 'the person sees a plain note');
  // crewd is still up: take the engine back and a later message still becomes a task that finishes.
  stub.run = run; stub.abort = abort;
  const next = await crew.post('scout', 'Reply with exactly: still here.') as { task: number };
  await until('crewd to keep working', () => task(db, next.task)?.state === 'done');
  done();
});
