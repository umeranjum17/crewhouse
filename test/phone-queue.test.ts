import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRetryOf, drainPending, failOffOf, historyOf, pendingOf, retrySuffix,
  type QueueLine } from '../mobile/src/phone-queue.ts';

const you = (text: string, rid: string, extra?: Partial<QueueLine>): QueueLine => ({ who: 'you', text, rid, ...extra });

test('a fresh send after reconnect goes after the queued turn, each once', async () => {
  const lines: QueueLine[] = [you('A', 'a', { queued: true })];
  const fresh: QueueLine = you('B', 'b', { queued: true });
  const ordered = pendingOf([...lines, fresh]);
  assert.deepEqual(ordered.map((t) => t.text), ['A', 'B']);
  const ran: string[] = [];
  const { sent, remaining } = await drainPending(ordered, async (t) => { ran.push(t.text); return true; });
  assert.equal(sent, 2);
  assert.deepEqual(remaining, []);
  assert.deepEqual(ran, ['A', 'B']);
});

test('a send during the opening probe waits behind the queued turn', async () => {
  const lines: QueueLine[] = [you('Q', 'q', { queued: true }), you('new', 'n', { queued: true })];
  assert.deepEqual(pendingOf(lines).map((t) => t.rid), ['q', 'n']);
  const ran: string[] = [];
  await drainPending(pendingOf(lines), async (t) => { ran.push(t.rid); return true; });
  assert.deepEqual(ran, ['q', 'n']);
});

test('a retry during the probe waits behind the queued turn', async () => {
  const lines: QueueLine[] = [
    you('Q', 'q', { queued: true }),
    { who: 'chief', text: 'Stopped.', stopped: true, retry: 'S', retryRid: 's' },
    you('S', 's', { queued: true }),
  ];
  assert.deepEqual(pendingOf(lines).map((t) => t.rid), ['q', 's']);
  const ran: string[] = [];
  await drainPending(pendingOf(lines), async (t) => { ran.push(t.rid); return true; });
  assert.deepEqual(ran, ['q', 's']);
});

test('a retry stays queued when the drain fails', async () => {
  const pending = [{ rid: 'q', text: 'Q' }, { rid: 's', text: 'S' }];
  const ran: string[] = [];
  const { sent, remaining } = await drainPending(pending, async (t) => { ran.push(t.rid); return false; });
  assert.equal(sent, 0);
  assert.deepEqual(remaining, pending);
  assert.deepEqual(ran, ['q']);
  assert.ok(remaining.some((t) => t.rid === 's'));
});

test('clearing a retry clears the interrupted suffix with it', () => {
  const lines: QueueLine[] = [{ who: 'chief', text: 'Interrupted.', stopped: true, retry: 'S', retryRid: 's', interrupted: true }];
  assert.equal(retrySuffix(lines[0]), true);
  const cleared = clearRetryOf(lines, 's');
  assert.equal(cleared[0].retry, undefined);
  assert.equal(cleared[0].interrupted, undefined);
  assert.equal(retrySuffix(cleared[0]), false);
});

test('an offline-failed line stays out of the model history', () => {
  const lines: QueueLine[] = [you('A', 'a')];
  const failed = failOffOf(lines, 'a', 'A');
  assert.equal(failed.find((l) => l.who === 'you' && l.rid === 'a')?.stopped, true);
  const history = historyOf(failed, 'b', 'B');
  assert.deepEqual(history, [{ who: 'you', text: 'B' }]);
});
