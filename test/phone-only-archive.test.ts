// The phone's copy of a chat after "Continue on your computer": retired into a hidden archive once the computer has it,
// kept when the move fails, and erased on sign-out. The Expo modules are in-memory (test/expo-fake.ts, via expo-hooks).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { files, reset, Paths } from './expo-fake.ts';

register('./expo-hooks.mjs', import.meta.url);
const { clearChat, loadChat, moveChatTo, rememberChief, rememberUser } = await import('../mobile/src/phone-only.ts');

const doc = Paths.document.uri;
const archived = () => [...files.keys()].filter((uri) => uri.startsWith(`${doc}/phone-moved/`));
const text = (uri: string) => files.get(uri) ?? '';

beforeEach(() => reset());

test('a move the computer takes retires the chat into the hidden archive and keeps the documents', async () => {
  rememberUser('draft the note', 'r1');
  rememberChief('Here it is.', undefined, 'r1');
  files.set(`${doc}/phone-requests.jsonl`, '{"rid":"r1","callId":"c1","fileName":"chief-note.docx","state":"done"}\n');
  files.set(`${doc}/chief-note.docx`, 'document bytes');

  await moveChatTo(async () => 'the computer has it');

  assert.deepEqual(loadChat(), []);
  assert.equal(files.has(`${doc}/phone-chat.jsonl`), false);
  assert.equal(files.has(`${doc}/phone-requests.jsonl`), false);
  const moved = archived();
  assert.equal(moved.length, 2);
  assert.deepEqual(moved.map((uri) => uri.replace(/^.*\/\d+-/, '')).sort(), ['phone-chat.jsonl', 'phone-requests.jsonl']);
  assert.match(text(moved.find((uri) => uri.endsWith('phone-chat.jsonl'))!), /draft the note/);
  assert.equal(text(`${doc}/chief-note.docx`), 'document bytes');
});

test('a move that fails keeps the chat on the phone, message and all', async () => {
  rememberUser('draft the note', 'r1');
  rememberChief('Here it is.', undefined, 'r1');

  await assert.rejects(
    moveChatTo(async () => { throw new Error('the computer did not answer'); }),
    /did not answer/,
  );

  assert.deepEqual(loadChat().map((line) => line.text), ['draft the note', 'Here it is.']);
  assert.equal(archived().length, 0);
});

test('signing out erases the hidden archive along with the chat', async () => {
  rememberUser('draft the note', 'r1');
  await moveChatTo(async () => undefined);
  rememberUser('a new message', 'r2');

  clearChat();

  assert.equal(archived().length, 0);
  assert.equal(files.has(`${doc}/phone-chat.jsonl`), false);
  assert.deepEqual(loadChat(), []);
});
