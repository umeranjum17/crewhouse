import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRetryOf, drainPending, failOffOf, historyOf, pendingOf, replayChat, retrySuffix, transcriptOf,
  type QueueLine } from '../mobile/src/phone-queue.ts';
import { chatTokens } from '../web/src/chat-md.ts';
import { noTools } from '../web/src/adapter.ts';

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

test('clearing a retry drops its stopped card with the suffix', () => {
  const lines: QueueLine[] = [{ who: 'chief', text: 'Interrupted.', stopped: true, retry: 'S', retryRid: 's', interrupted: true }];
  assert.equal(retrySuffix(lines[0]), true);
  const cleared = clearRetryOf(lines, 's');
  assert.deepEqual(cleared, []);
});

test('a failed retry leaves a single stopped card with its try again', () => {
  const failedOnce = failOffOf([you('S', 's')], 's', 'S');
  assert.equal(failedOnce.filter((l) => l.stopped && l.who === 'chief').length, 1);
  const retried = [...clearRetryOf(failedOnce, 's'), you('S', 's', { queued: true })];
  assert.ok(retried.every((l) => !(l.stopped && l.who === 'chief')));
  const failedAgain = failOffOf(retried, 's', 'S');
  const cards = failedAgain.filter((l) => l.stopped && l.who === 'chief');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].retry, 'S');
  assert.equal(cards[0].retryRid, 's');
});

test('an offline-failed turn that later sends reloads as one turn with no phantom stop', () => {
  const records = [
    { t: 'you', text: 'A', rid: 'a', queued: true },
    { t: 'you', text: 'A', rid: 'a' },
    { t: 'you', text: 'A', rid: 'a', queued: true },
    { t: 'you', text: 'A', rid: 'a' },
    { t: 'chief', text: 'done', rid: 'a' },
  ];
  const reloaded = replayChat(records, () => false);
  assert.deepEqual(reloaded.map((l) => [l.who, l.text]), [['you', 'A'], ['chief', 'done']]);
  assert.ok(reloaded.every((l) => !l.stopped));
});

test('an offline-failed line stays out of the model history', () => {
  const lines: QueueLine[] = [you('A', 'a')];
  const failed = failOffOf(lines, 'a', 'A');
  assert.equal(failed.find((l) => l.who === 'you' && l.rid === 'a')?.stopped, true);
  const history = historyOf(failed, 'b', 'B');
  assert.deepEqual(history, [{ who: 'you', text: 'B' }]);
});

test('the chat carried to the computer reads one turn per item in the thread, a document by title, the oldest cut first', () => {
  const chat: QueueLine<{ name: string }>[] = [you('Book a table', 'a'), { who: 'chief', text: 'That needs a computer.\nPair one.', doc: { name: 'Packing list' } },
    you('Cut off', 'b', { stopped: true }), { who: 'chief', text: 'Stopped.', stopped: true }, you('Thanks', 'c'), { who: 'chief', text: 'Any time.' }];
  const items = (text: string) => (chatTokens(noTools(text)).find((t) => t.type === 'list') as any).items.map((i: any) => i.text);
  assert.deepEqual(items(transcriptOf(chat)), ['You: Book a table',
    'Chief: That needs a computer.\nPair one.\n(Chief made a document here, Packing list. The file stays on my phone.)', 'You: Thanks', 'Chief: Any time.']);
  const cut = transcriptOf(chat, 60);
  assert.match(cut, /\(Earlier turns left out\.\)/);
  assert.deepEqual(items(cut), ['You: Thanks', 'Chief: Any time.']);
});
