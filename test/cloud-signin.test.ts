// The cloud front door's code sign-in (web/src/cloud.ts `signIn`) on BYOKit's fake boat.dev: the person's email goes to
// boat.dev, the link and code come back as one waiting state, and the key it issues goes into the store and nowhere else.
// Each way it can end is named (refused, expired, unreachable, provider, or the app's own wait running out), a key the
// store would not keep is revoked at once, and an abort ends it quietly. No account, no network, no money.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeSandboxServer, memoryStore } from '@byokit/cloud/testing';
import { provider, signIn, signInSaid, unlink, type SignIn } from '../web/src/cloud.ts';

const email = 'umer@example.com', KEY = 'boat-claimed-key';
const all = async (g: AsyncGenerator<SignIn>) => { const out: SignIn[] = []; for await (const s of g) out.push(s); return out; };

test('a code sign-in shows the link and code, finishes with the computers listed and the key only in the store', async (t) => {
  const server = await startFakeSandboxServer({ key: KEY });
  t.after(() => server.close());
  const seeded = await provider(async () => KEY, server.url).create!({ name: 'old', size: 'small', keepCopies: true, idempotencyKey: 'seed' });
  server.scriptClaimPoll(['pending']);
  const store = memoryStore();
  const states = await all(signIn(email, store, { api: server.url }));
  assert.deepEqual(states.map((s) => s.at), ['waiting', 'done']);
  const waiting = states[0];
  assert.ok(waiting.at === 'waiting' && waiting.code === '123456' && waiting.url.startsWith(`${new URL(server.url).origin}/api/boat/agent/identity/claim`));
  const done = states[1];
  assert.ok(done.at === 'done');
  assert.deepEqual(done.listed.map((r) => r.id), [seeded.id]);
  assert.equal((await store.load())!.providerKey, KEY, 'the kit store holds the key');
  assert.ok(!JSON.stringify(states).includes(KEY), 'no state carries the key');
  assert.deepEqual([...server.revoked], ['assert-test-claimed'], 'only the spare sign-in was ended; the key stays live');
});

test('each failure is named in its own words, with nothing kept', async (t) => {
  const server = await startFakeSandboxServer();
  t.after(() => server.close());
  const store = memoryStore();
  const refused = await all(signIn('someone-else@example.com', store, { api: server.url }));
  assert.deepEqual(refused, [{ at: 'failed', why: 'refused' }]);
  assert.equal(signInSaid('refused'), "boat.dev didn't accept that address. Check it and try again.");
  server.scriptClaimPoll(['expired_token']);
  const expired = await all(signIn(email, store, { api: server.url }));
  assert.deepEqual(expired.map((s) => s.at === 'failed' ? s.why : s.at), ['waiting', 'expired']);
  assert.equal(signInSaid('expired'), 'That sign-in expired. Try again.');
  const unreachable = await all(signIn(email, store, { api: 'http://127.0.0.1:1/api/v1' }));
  assert.deepEqual(unreachable, [{ at: 'failed', why: 'unreachable' }]);
  assert.match(signInSaid('unreachable'), /can’t reach boat\.dev/);
  const origin = new URL(server.url).origin; // boat.dev's metadata names no way to end a spare sign-in: the claim fails closed
  server.failNext([{ status: 200, body: { token_endpoint: `${origin}/api/boat/oauth2/token`, agent_auth: { identity_endpoint: `${origin}/api/boat/agent/identity` } } }]);
  const odd = await all(signIn(email, store, { api: server.url }));
  assert.deepEqual(odd.map((s) => s.at === 'failed' ? s.why : s.at), ['waiting', 'provider']);
  assert.ok(!JSON.stringify(odd).includes(KEY));
  assert.equal(new Set(['refused', 'expired', 'unreachable', 'provider', 'timeout'].map((w) => signInSaid(w as 'refused'))).size, 5, 'five failures, five different sentences');
  assert.equal(await store.load(), null, 'no failure kept anything');
});

test('a wait that runs out says so, and an abort ends quietly', async (t) => {
  const server = await startFakeSandboxServer({ claimInterval: 60 });
  t.after(() => server.close());
  server.scriptClaimPoll(['pending']);
  const late = await all(signIn(email, memoryStore(), { api: server.url, ms: 30 }));
  assert.deepEqual(late.map((s) => s.at === 'failed' ? s.why : s.at), ['waiting', 'timeout']);
  assert.match(signInSaid('timeout'), /stopped waiting\. Nothing was connected/);
  assert.ok(!/\d+ ?(second|minute)/.test(signInSaid('timeout')), 'no time claim in the words');

  server.scriptClaimPoll(['pending']);
  const stop = new AbortController(), seen: string[] = [];
  const run = (async () => { for await (const s of signIn(email, memoryStore(), { api: server.url, signal: stop.signal })) { seen.push(s.at); stop.abort(); } })();
  await run;
  assert.deepEqual(seen, ['waiting'], 'the person leaving ends it with no failure state');
});

test('a key the store will not keep is ended at boat.dev and reported as the provider failing', async (t) => {
  const server = await startFakeSandboxServer();
  t.after(() => server.close());
  const broken = { load: async () => null, save: async () => { throw new Error('disk full'); } };
  const states = await all(signIn(email, broken, { api: server.url }));
  assert.deepEqual(states.map((s) => s.at === 'failed' ? s.why : s.at), ['waiting', 'provider']);
  assert.ok(server.revoked.has(KEY), 'no live key outlives a sign-in that failed');
  assert.ok(!JSON.stringify(states).includes(KEY) && !JSON.stringify(states).includes('disk full'));
});

// Unlink (web/src/cloud.ts `unlink`): boat.dev ends the key first; the phone's copy goes only when boat.dev confirms.
const held = (key: string) => { const store = memoryStore(); void store.save({ ref: null, providerKey: key }); let gone = 0; return { store, forget: async () => { gone++; }, gone: () => gone }; };
const meta = (server: { url: string }) => { const origin = new URL(server.url).origin; return { status: 200, body: { revocation_endpoint: `${origin}/api/boat/oauth2/revoke` } }; };

test('unlink ends the key at boat.dev and only then deletes the local copy', async (t) => {
  const server = await startFakeSandboxServer({ key: KEY });
  t.after(() => server.close());
  const k = held(KEY);
  const seen: boolean[] = [];
  const result = await unlink(k.store, async () => { seen.push(server.revoked.has(KEY)); await k.forget(); }, { api: server.url });
  assert.equal(result, 'done');
  assert.deepEqual(seen, [true], 'the key was already ended at boat.dev when the local delete ran');
  assert.ok(server.revoked.has(KEY));
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('boat.dev unreachable or refusing keeps the key, and says nothing about it', async (t) => {
  const server = await startFakeSandboxServer({ key: KEY });
  t.after(() => server.close());
  const down = held(KEY);
  assert.equal(await unlink(down.store, down.forget, { api: 'http://127.0.0.1:1/api/v1' }), 'unreachable');
  assert.equal(down.gone(), 0, 'unreachable: the local key stays');
  assert.equal((await down.store.load())!.providerKey, KEY);
  const broken = held(KEY);
  server.failNext([meta(server), { status: 500, body: { error: 'server_error' } }]);
  assert.equal(await unlink(broken.store, broken.forget, { api: server.url }), 'provider');
  assert.equal(broken.gone(), 0, 'boat.dev failing the revoke: the local key stays');
  assert.ok(!server.revoked.has(KEY), 'and the key is still live');
  const refused = held(KEY);
  server.failNext([meta(server), { status: 401, body: { error: 'invalid_client' } }]);
  assert.equal(await unlink(refused.store, refused.forget, { api: server.url }), 'refused');
  assert.equal(refused.gone(), 0, 'a 401 on a key boat.dev still accepts is a refusal, not an ended key');
  assert.equal(await unlink(refused.store, refused.forget, { api: server.url }), 'done', 'the retry works once boat.dev answers');
  assert.equal(refused.gone(), 1);
});

test('a key boat.dev already ended, or none held, leaves nothing behind to retry forever', async (t) => {
  const server = await startFakeSandboxServer({ key: KEY });
  t.after(() => server.close());
  server.revoked.add(KEY); // an earlier unlink ended it but the phone's delete never finished
  const dead = held(KEY);
  assert.equal(await unlink(dead.store, dead.forget, { api: server.url }), 'done');
  assert.equal(dead.gone(), 1);
  const none = { store: memoryStore(), forget: async () => undefined };
  assert.equal(await unlink(none.store, none.forget, { api: 'http://127.0.0.1:1/api/v1' }), 'done', 'no key held: nothing to end');
});
