// A phone's own key that the provider refuses: the kit's typed key error becomes one plain sentence and one next step.
// The provider is the OpenRouter HTTP API, answered by a stubbed fetch (the kit's own send path, never the network);
// the Expo modules are in-memory (test/expo-fake.ts, via expo-hooks).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { reset } from './expo-fake.ts';

register('./expo-hooks.mjs', import.meta.url);
const { askPhone, phoneConnect, phoneExpired, phoneModels, phonePick, phonePlan, phoneSignOut, phoneSignedIn, phoneWords, PHONE_KEYS } = await import('../mobile/src/phone-only.ts');

const realFetch = globalThis.fetch;
const turns = [{ who: 'you' as const, text: 'Draft a note to Sam.' }];
const io = { onText: () => {}, onDocument: () => {} };

/** The provider answers every request with `status` and its own message, as OpenRouter does. */
function refuseWith(status: number, message: string) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message, code: status } }), {
    status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

/** One send on the phone's saved key, and the typed error it ends with. */
async function failure(): Promise<Error & { code: string }> {
  const rid = crypto.randomUUID();
  try {
    await askPhone(turns, io, new AbortController().signal, rid);
  } catch (e) {
    return e as Error & { code: string };
  }
  assert.fail('the send should have failed');
}

beforeEach(async () => {
  reset();
  await phoneConnect(PHONE_KEYS[0], 'sk-or-v1-test-key');
});
afterEach(() => { globalThis.fetch = realFetch; });

test('a key with no credit left says so, and names the next step: add credit, then send again', async () => {
  refuseWith(402, 'This request requires more credits. You can only afford 3257.');
  const error = await failure();
  assert.equal(error.name, 'KeyRouteError');
  assert.equal(error.code, 'out_of_credit');
  assert.equal(phoneExpired(error), false);
  assert.equal(phoneWords(error), 'Your OpenRouter account is out of credit. Add credit on OpenRouter, then send it again.');
});

test('a key the provider refuses sends the person back to connect a key that works, with the reason', async () => {
  refuseWith(401, 'No auth credentials found');
  const error = await failure();
  assert.equal(error.name, 'KeyRouteError');
  assert.equal(error.code, 'key_refused');
  assert.equal(phoneExpired(error), true);
  assert.equal(phoneWords(error), 'OpenRouter refused this key. Connect a key that works to keep chatting.');
});

test('a key the provider is rate limiting says to wait a minute, then send again', async () => {
  refuseWith(429, 'Rate limit exceeded');
  const error = await failure();
  assert.equal(error.name, 'KeyRouteError');
  assert.equal(error.code, 'rate_limited');
  assert.equal(phoneExpired(error), false);
  assert.equal(phoneWords(error), 'OpenRouter is busy with this key right now. Wait a minute, then send it again.');
});

test('a MiniMax key runs Chief on the MiniMax model the person picked, its refusals name MiniMax, and Sign out leaves no key', async () => {
  await phoneConnect(PHONE_KEYS[1], 'sk-mm-test-key');
  const models = await phoneModels();
  assert.deepEqual(models.map((m) => m.name), ['MiniMax M3', 'MiniMax M3.1 Flash Preview']);
  await phonePick(models[0].id);
  assert.equal(await phonePlan(), 'MiniMax M3');
  let sent: { url: string; model: string } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent = { url: String(url), model: JSON.parse(String(init?.body)).model };
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid api key' } }), {
      status: 401, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const error = await failure();
  assert.equal(error.code, 'key_refused');
  assert.match(sent!.url, /^https:\/\/api\.minimax\.io\/anthropic\//);
  assert.equal(sent!.model, 'MiniMax-M3');
  assert.equal(phoneWords(error), 'MiniMax refused this key. Connect a key that works to keep chatting.');
  await phoneSignOut();
  assert.equal(await phoneSignedIn(), false);
});
