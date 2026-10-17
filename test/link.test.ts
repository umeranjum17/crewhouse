// The phone link: where it listens, then pairing, the person's yes, grants, approvals and removal through the real
// daemon, with @byokit/pair's own device side as the phone. The Noise handshake and frames are the package's, tested there.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer as http1, request as http1Request } from 'node:http';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { DeviceLink, pairWithCode, pairWithOffer, type DeviceGrant, type LinkStatus, parseOffer } from '@byokit/pair';
import { findHost } from '@byokit/relay/device';
import { startRelay } from '../relay/main.ts';
import { readTyped } from '../web/src/typed.ts';
import { Link, NEWS } from '../src/link.ts';
import { sandboxReady } from '../src/engine.ts';
import { Store } from '../src/db.ts';
import { DatabaseSync } from 'node:sqlite';
import * as A from '../web/src/adapter.ts';
import { transcriptOf } from '../mobile/src/phone-queue.ts';
import { chatTokens } from '../web/src/chat-md.ts';

test('the installed web app subscribes a browser push address through the relay and hears the same news', async () => {
  const db = new Store(temp('crewhouse-web-push'));
  const calls: any[] = [];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { vapidKey: 'BFx-key', subscribe: async (d: string, s: any) => calls.push(['subscribe', d, s]), unsubscribe: async (d: string) => calls.push(['unsubscribe', d]), notify: async (n: any) => { calls.push(['notify', n]); return {}; } },
    relayStatus: 'online', host: { devices: () => [{ id: 'pixel' }] },
  });
  assert.equal(link.status().vapid, 'BFx-key');
  const web = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };
  await link.setWebPush({ web });
  assert.deepEqual(calls.shift(), ['subscribe', 'web', { web }]);
  await assert.rejects(new Link({} as any, db, async () => null).setWebPush({ web }), { status: 409 });
  // A failed job: the browser hears the same content-free news as the phone.
  await link.tell('e7');
  const notify = calls.shift();
  assert.equal(notify[0], 'notify');
  assert.equal(notify[1].title, NEWS);
  assert.ok(notify[1].to.includes('web'), 'the browser device is addressed');
  await assert.rejects(link.setWebPush({ off: true }), { status: 400 });
  assert.equal(calls.length, 0, 'a bare off reaches no browser');
  db.close();
});

test('push through a stubbed Expo: exactly one content-free push per paired phone, and a missing credential said once', async () => {
  const got: any[][] = [];
  let answer = (msgs: any[]) => msgs.map(() => ({ status: 'ok' }));
  const expo = http1((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.end(JSON.stringify({ data: answer(got.at(-1)!) })); }); });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  after(() => expo.close());
  const db = new Store(temp('crewhouse-push'));
  const devices = [{ id: 'pixel' }, { id: 'moto' }, { id: 'ipad' }];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, { host: { devices: () => devices }, pushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push` });
  const phone = (id: string, body: unknown) => link.request('POST /api/push', { ...body as object, build: 'p9b' }, { id, role: 'control' });
  assert.equal((await phone('pixel', { expo: 'ExponentPushToken[pixel-1]' })).status, 200);
  assert.equal((await phone('moto', { expo: 'ExponentPushToken[moto-1]' })).status, 200);
  assert.equal((await phone('ipad', { expo: 'not a token' })).status, 409, 'only an Expo token, or saying why there is none');
  assert.equal(link.status().push, 'ready');

  // A job fails: every phone with notifications on gets content-free news.
  link.news({ seq: 7, kind: 'alert', data: { member: 1, words: 'Reel could not pay the dentist' }, bot: null });
  for (const end = Date.now() + 5000; !got.length && Date.now() < end;) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, [[
    { to: 'ExponentPushToken[pixel-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
    { to: 'ExponentPushToken[moto-1]', title: NEWS, sound: 'default', collapseId: 'e7' },
  ]]);

  // Expo has no Android credential for the app yet: Settings says so, once, rather than pushes vanishing.
  answer = (msgs) => msgs.map(() => ({ status: 'error', details: { error: 'InvalidCredentials' } }));
  await link.tell('e8');
  assert.equal(link.status().push, 'missing');
  answer = (msgs) => msgs.map((_m, i) => (i ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }));
  await link.tell('e9');
  assert.equal(link.status().push, 'ready', 'a push that goes through clears it');
  await link.tell('e10');
  assert.deepEqual(got.at(-1)!.map((m: any) => m.to), ['ExponentPushToken[pixel-1]'], 'a phone Expo no longer knows is dropped');

  // The app build itself has no push credential: the phone says so, and Settings shows it; said no to notifications is per phone.
  await phone('ipad', { missing: true });
  assert.equal(link.status().push, 'missing');
  await phone('ipad', { off: true });
  assert.equal(link.status().push, 'ready');
  db.close();
});

test('questions, finished helper jobs and Chief lines push only content-free news to the person’s phones', async (t) => {
  const got: any[][] = [];
  const expo = http1((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const msgs = JSON.parse(body);
      got.push(msgs);
      res.end(JSON.stringify({ data: msgs.map(() => ({ status: 'ok' })) }));
    });
  });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  t.after(() => expo.close());
  const db = new Store(temp('crewhouse-news'));
  t.after(() => db.close());
  const devices = ['pixel', 'moto'].map((id) => ({ id }));
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    host: { devices: () => devices }, pushUrl: `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`,
  });
  for (const d of devices) await link.request('POST /api/push', { expo: `ExponentPushToken[${d.id}]`, build: 'p9b' }, d);
  // news() is fire-and-forget: retain the real sends so silence and exact counts can be checked without a sleep.
  const pending: Promise<void>[] = [];
  const tell = link.tell.bind(link);
  link.tell = (id: string) => { const send = tell(id); pending.push(send); return send; };
  db.run("INSERT INTO asks (id, bot, member, title, detail) VALUES (1, 'scout', 1, 'Private question', 'Private detail')");
  db.run("INSERT INTO tasks (id, bot, member, state, result) VALUES (1, 'scout', 1, 'done', 'Private finished work')");
  db.run("INSERT INTO messages (id, bot, member, author, text) VALUES (1, 'chief', 1, 'bot', 'Private Chief line')");
  for (const [i, event] of [
    { kind: 'ask.opened', bot: 'scout', data: { ask: 1 } },
    { kind: 'task.done', bot: 'scout', data: { task: 1 } },
    { kind: 'message', bot: 'chief', data: { id: 1, author: 'bot' } },
  ].entries()) {
    link.news({ seq: i + 1, ...event });
    await Promise.all(pending);
    assert.equal(got.length, i + 1, `${event.kind} sends exactly one batch`);
    assert.deepEqual(got[i], devices.map((d) => ({ to: `ExponentPushToken[${d.id}]`, title: NEWS, sound: 'default', collapseId: `e${i + 1}` })));
  }
  db.run("INSERT INTO tasks (id, bot, member, state, result, routine) VALUES (2, 'chief', 1, 'done', 'All clear', 1), (3, 'chief', 1, 'done', 'Private Chief result', NULL), (4, 'scout', 1, 'done', 'All clear', 2)");
  for (const task of [2, 3, 4]) link.news({ seq: task + 2, kind: 'task.done', bot: task === 4 ? 'scout' : 'chief', data: { task } });
  await Promise.all(pending);
  assert.equal(got.length, 3, 'All clear routines and Chief task completion give no push');
});

test('a paired phone renews the Add-a-phone code it is looking at; the rest of phone admin stays on the computer', async () => {
  const db = new Store(temp('crewhouse-renew'));
  const seen: string[] = [];
  const link = new Link({} as any, db, async (m: string, path: string) => { seen.push(`${m} ${path}`); return { message: 7, token: 'fresh' }; });
  const phone = { id: 'pixel' };
  const renew = (g: { id: string }, op: string) => (link as any).request(op, { message: 7, build: 'p9b' }, g);
  assert.deepEqual(await renew(phone, 'POST /api/phones/refresh'), { status: 200, body: { message: 7, token: 'fresh' } }, "the person's phone asks for its own fresh code");
  assert.deepEqual(seen, ['POST /api/phones/refresh'], 'the ask reaches crewd');
  assert.equal((await renew(phone, 'POST /api/phones/pair')).status, 403, 'minting a first code stays on the computer');
  assert.equal((await renew(phone, 'DELETE /api/phones/pixel')).status, 403, 'removing a phone stays on the computer');
  db.close();
});

const root = temp('crewhouse-link');
// Ports the OS says are free, not random guesses that another run may hold.
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const port = await free();
const linkPort = await free();
const base = `http://127.0.0.1:${port}`;
let pushUrl = '';
let relayPublic = '';
const startDaemon = () => spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'main.ts')], {
  env: { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '3000', CREWHOUSE_HOLD_MS: '5000', CREWHOUSE_PORT: String(port), CREWHOUSE_LINK_PORT: String(linkPort),
    CREWHOUSE_PUSH_URL: pushUrl, CREWHOUSE_RELAY_PUBLIC: relayPublic, CREWHOUSE_LINK_HOST: '127.0.0.1', CREWHOUSE_STATE_DIR: join(root, 'state'), CREWHOUSE_CREW_DIR: join(root, 'crew'), CREWHOUSE_TOOLS_DIR: join(root, 'tools') },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let daemon = startDaemon();
after(() => daemon.kill());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-crewhouse': '1' }) {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(root, 'state', 'person.key'), 'utf8')}`, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function until<T>(fn: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error('timed out');
}

/** A phone scans the QR; the person at the computer checks the two words and answers. */
async function pairPhone(qr: string, name: string, yes = true) {
  let words = '';
  const paired = pairWithOffer(qr, { name, onWords: (w) => { words = w; } });
  const asking = await until(async () => (await http('GET', '/api/phones/link')).body.asking.find((a: any) => a.name === name));
  assert.equal(asking.words, words, 'the computer shows the same two words as the phone');
  assert.match(words, /^[a-z]+ [a-z]+$/);
  await http('POST', '/api/phones/answer', { id: asking.id, yes });
  return paired;
}

/** A paired phone's live link, answered like HTTP (as the app's transport reads it). */
function open(grant: DeviceGrant) {
  const events: any[] = [];
  let stored: DeviceGrant | null = grant;
  let status: LinkStatus = 'connecting';
  const link = new DeviceLink(grant, { store: { save: (g) => { stored = g; }, clear: () => { stored = null; } }, onEvent: (e) => events.push(e), onStatus: (s) => { status = s; } });
  const req = async (method: string, path: string, body?: unknown) => {
    try { return await link.request(`${method} ${path}`, { ...body as object, build: 'p9b' }) as { status: number; body: any }; }
    catch (e: any) { return { status: e.code === 'view-only' ? 403 : 0, body: { error: e.code } }; }
  };
  return { link, req, events, stored: () => stored, status: () => status };
}

test('an unmarked old phone reads only the update notice; a marked current phone reads the crew and can act', async () => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const phone = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Build check'));
  const live = new DatabaseSync(join(root, 'state', 'crew.db'));
  const ask = live.prepare("INSERT INTO asks (bot, kind, title, detail) VALUES ('chief', 'propose', 'Private question', '{}')").run().lastInsertRowid;
  try {
    const current = await phone.req('GET', '/api/state');
    assert.equal(current.status, 200);
    assert.ok(current.body.asks.some((a: any) => a.title === 'Private question'));
    assert.equal(Object.hasOwn(current.body, 'members'), false);
    const old = await phone.link.request('GET /api/state') as { status: number; body: any };
    assert.equal(old.status, 200, 'old screens swallow API errors, so the notice is a readable Home');
    assert.equal(Object.hasOwn(old.body, 'members'), false);
    assert.equal(old.body.person.onboarded, 1, 'control phones open Home, never Hello');
    assert.deepEqual(old.body.asks, []);
    assert.deepEqual(old.body.tasks, []);
    assert.deepEqual(old.body.events, []);
    assert.equal(A.chats(old.body)[0].line, 'Get the latest Crewhouse app to keep chatting.', 'Chief’s chat row shows the plain notice');
    assert.doesNotThrow(() => { A.office(old.body); A.homeCounts(old.body); A.jobs(old.body); A.status(old.body); });
    assert.doesNotMatch(JSON.stringify(old.body), /Private question/);
    for (const [op, body] of [
      ['POST /api/bots/chief/messages', { text: 'do work' }],
      ['POST /api/phones/refresh', { message: 7, member: 1 }],
      ['POST /api/push', { off: true }],
    ] as const) assert.deepEqual(await phone.link.request(op, body), { status: 426, body: { error: 'Get the latest Crewhouse app to keep chatting.' } }, op);
    const notice = await phone.link.request('GET /api/bots/chief') as { status: number; body: any };
    assert.equal(notice.status, 200, 'the old phone can open the update link in Chief’s chat');
    assert.equal(notice.body.messages.length, 1);
    assert.match(A.lines(notice.body, 'chief')[0].text, /\[Get the latest Crewhouse app\]\(https:\/\/github.com\/umeranjum17\/crewhouse\/releases\/tag\/v1.0.0-preview.20261017.20\) to keep chatting\./);
    assert.doesNotMatch(JSON.stringify(notice.body), /Private question/);
    const desktop = await phone.link.stream('desktop', { bot: 'chief' });
    assert.equal(await new Promise((r) => { desktop.onEnd = r; }), 'Get the latest Crewhouse app to keep chatting.', 'old desktop controls cannot act either');
    assert.equal((await phone.req('POST', '/api/push', { off: true })).status, 200, 'marked current requests retain their effects');
    assert.equal(live.prepare('SELECT value FROM settings WHERE key = ?').get(`phone.push.${phone.link.grant.device.id}`)!.value, 'off');
  } finally { live.prepare('DELETE FROM asks WHERE id = ?').run(ask); live.close(); phone.link.stop(); await http('DELETE', `/api/phones/${phone.link.grant.device.id}`); }
});

test('pairing with a yes at the computer, grants, approvals from the phone, and removal', { skip: !sandboxReady() && 'bubblewrap is not usable here' }, async () => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  assert.equal(statSync(join(root, 'state', 'link.key')).mode & 0o777, 0o600, 'the link key is private to the owner');
  assert.deepEqual((await http('GET', '/api/phones')).body, [], 'docs/ui-contract.md: a list');

  // Only this computer can widen the link, show a code or answer a phone.
  assert.equal((await http('PUT', '/api/phones/lan', { on: true }, {})).status, 403);
  assert.equal((await http('POST', '/api/phones/pair', { role: 'control' }, {})).status, 403);
  assert.equal((await http('POST', '/api/phones/answer', { id: 1, yes: true }, {})).status, 403);

  // A no at the computer stores nothing, and the phone is told.
  const first = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  assert.deepEqual(first.urls, [`ws://127.0.0.1:${linkPort}/link`]);
  await assert.rejects(pairPhone(first.qr, 'Stranger', false), /said no/);
  assert.deepEqual((await http('GET', '/api/phones')).body, []);

  const grant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Pixel');
  assert.equal(grant.device.role, 'control');
  const late = (await http('POST', '/api/phones/pair', { role: 'control' })).body.qr;
  await until(async () => Date.now() > parseOffer(late, 0).expires);
  await assert.rejects(pairWithOffer(late, { name: 'Late', onWords: () => {} }), /run out/, 'codes expire');

  // The grant is durable: the phone connects with its key alone, as the member whose screen showed the code.
  const a = open(grant);
  const state = await a.req('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.ok(state.body.bots.some((x: any) => x.id === 'chief'));
  assert.equal((await a.req('POST', '/api/phones/pair', { role: 'control' })).status, 403, 'a phone cannot show pairing codes');
  assert.equal((await a.req('GET', '/api/phones')).status, 403, 'or list phones');
  assert.equal((await a.req('GET', '/api/accounts')).status, 403, 'AI account sign-ins stay on the computer');
  assert.equal((await a.req('POST', '/api/people', { name: 'Mallory' })).status, 403, 'and so does adding people');
  assert.equal((await a.req('POST', '/api/connections/notion')).status, 403, 'and connecting apps');
  assert.equal((await a.req('PUT', '/api/house/google', { id: 'x', secret: 'y' })).status, 403, 'and the house Google app');
  assert.equal((await a.req('GET', '/api/state')).status, 200);
  assert.equal((await a.req('GET', '/files/chief/x')).status, 404);
  // The phone says which route it came by; Settings shows when each phone last reached the computer, and how.
  assert.deepEqual(Object.keys((await a.req('GET', '/api/reach', { via: 'home' })).body.reached), ['home']);
  await a.req('GET', '/api/reach', { via: 'anything' });
  assert.deepEqual(Object.keys((await http('GET', '/api/phones')).body[0].reached), ['home'], 'only a route it knows');

  // Live events arrive over the link.
  await a.req('POST', '/api/onboard', { address: 'Sir' });
  await until(async () => a.events.find((e) => e.kind === 'person.onboarded'));

  // A chat kept from Chief on the phone alone carries on with Chief here as one message (mobile ContinueOffer): it stays
  // with Chief whole, so its "pair one" makes no pairing card, and a resend under the same move id stores it once.
  // The phone's own chat, carried over whole: a cut-off turn marked stopped, a queued one not sent yet (its id moves it),
  // a document as its title.
  const moved = transcriptOf([{ who: 'you', text: 'Book us a table for Friday.', rid: 'r0' }, { who: 'chief', text: "That needs a computer. Pair one and I'll book it.", doc: { name: 'Packing list' } },
    { who: 'you', text: 'Cut off', rid: 'r1', stopped: true }, { who: 'chief', text: 'Stopped.', stopped: true }, { who: 'you', text: 'Thanks', rid: 'r2' }, { who: 'chief', text: 'Any time.' },
    { who: 'you', text: 'And Saturday?', rid: 'move-rid-1', queued: true }]);
  const sent = await a.req('POST', '/api/bots/chief/messages', { text: moved, move: 'move-rid-1' });
  assert.equal(sent.status, 200);
  assert.deepEqual(await a.req('POST', '/api/bots/chief/messages', { text: moved, move: 'move-rid-1' }), sent, 'the same move is stored once');
  const chief = (await http('GET', '/api/bots/chief')).body;
  assert.equal(chief.messages.filter((x: any) => x.author === 'person' && x.text === moved).length, 1);
  const said = (chatTokens(A.noTools(moved)).find((t) => t.type === 'list') as any)?.items.map((i: any) => i.text);
  assert.deepEqual(said, ['You: Book us a table for Friday.', "Chief: That needs a computer. Pair one and I'll book it.\n(Chief made a document here, Packing list. The file stays on my phone.)",
    'You (stopped): Cut off', 'You: Thanks', 'Chief: Any time.', 'You (not sent yet): And Saturday?'], 'the thread reads one turn per item');
  const turns = [{ who: 'you' as const, text: 'First', rid: 'a' }, { who: 'chief' as const, text: 'One' }, { who: 'you' as const, text: 'Last', rid: 'b' }, { who: 'chief' as const, text: 'Two' }];
  assert.match(transcriptOf(turns, 30), /\(Earlier turns left out\.\)\n- You: Last\n- Chief: Two$/, 'past the cap the oldest turns go, said so');
  assert.match(transcriptOf([{ who: 'you', text: 'x'.repeat(50), rid: 'c' }], 30), /\(Earlier turns left out\.\)\n…x+$/, 'a single turn past the cap is cut to its tail, said so');
  assert.ok(chief.tasks.some((x: any) => x.id === sent.body.task), 'a Chief task, not a helper\'s');
  assert.equal(chief.phoneOffer, null);

  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const card = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  assert.ok(card.token && card.qr);
  const pairing = pairWithOffer(card.qr, { name: 'Inline phone', onWords: () => {} });
  const waiting = await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer.waiting);
  assert.equal(waiting.name, 'Inline phone');
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: 'wrong' })).status, 403);
  assert.equal((await a.req('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token })).status, 403, 'phone cannot approve itself');
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token }, { 'x-crewhouse': '1', authorization: '' })).status, 403, 'known pairing words and offer are not person authority');
  assert.equal((await http('POST', '/api/phones/answer', { id: waiting.id, yes: true, offer: card.token })).status, 200);
  await pairing;
  await until(async () => (await http('GET', '/api/bots/chief')).body.phoneOffer.joined === 'Inline phone');
  const refreshed = (await http('POST', '/api/phones/refresh', { message: card.message })).body;
  assert.notEqual(refreshed.token, card.token, 'a card whose phone already joined is done: it does not refresh');
  const inline = (await http('GET', '/api/phones')).body.find((p: any) => p.name === 'Inline phone');
  await http('DELETE', `/api/phones/${inline.id}`);

  // An approval answered from the phone: the gate holds the bot's write until the phone says yes.
  await http('POST', '/api/recruit', { template: 'reel', name: 'Reel' });
  const outside = join(root, 'Documents', 'from-phone.txt');
  const job = (await a.req('POST', '/api/bots/reel/messages', { text: `save it [tool crew_write ${JSON.stringify({ path: outside, content: 'from the phone' })}]` })).body.task;
  const ask = await until(async () => (await a.req('GET', '/api/state')).body.asks.find((x: any) => x.kind === 'permission'));
  assert.match(ask.title, /Reel wants to change a file/);
  assert.equal((await http('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' }, { 'x-crewhouse': '1', authorization: '' })).status, 403, 'the public header is not person authority');
  assert.ok((await a.req('GET', '/api/state')).body.asks.some((x: any) => x.id === ask.id), 'a refused answer leaves the question open');
  assert.equal((await a.req('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow' })).status, 200);
  await until(async () => (await http('GET', '/api/bots/reel')).body.tasks.find((x: any) => x.id === job && x.state === 'done'));
  assert.equal(readFileSync(outside, 'utf8'), 'from the phone');

  // Replay the reported attack: an unfenced bot's actual shell, not a forged test caller.
  await http('POST', '/api/recruit', { template: 'tracer', name: 'Tracer' });
  const tool = (name: string, input: object) => `[tool ${name} ${JSON.stringify(input)}]`;
  await a.req('POST', '/api/bots/tracer/messages', { text: tool('crew_write', { path: 'files/authority.md', content: 'Synthetic unsent draft for Umer' }) +
    tool('crew_draft', { path: 'files/authority.md', channel: 'email', to: 'ada@fernwood.example', subject: 'Synthetic authority probe' }) });
  const draft = await until(async () => (await a.req('GET', '/api/state')).body.asks.find((x: any) => x.bot === 'tracer' && x.detail.draft));
  const attack = (await a.req('POST', '/api/bots/tracer/messages', { text: tool('bash', { command:
    `curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'x-crewhouse: 1' --data '{"answer":"allow","scope":"once"}' '${base}/api/asks/${draft.id}/answer' > files/denial.txt` }) })).body.task;
  await until(async () => (await a.req('GET', '/api/bots/tracer')).body.tasks.find((x: any) => x.id === attack && x.state === 'done'));
  assert.equal(readFileSync(join(root, 'crew', 'bots', 'tracer', 'files', 'denial.txt'), 'utf8'), '403');
  assert.ok((await a.req('GET', '/api/state')).body.asks.some((x: any) => x.id === draft.id), 'the helper cannot attest to its own draft');
  assert.ok(!(await a.req('GET', '/api/events')).body.some((x: any) => x.kind === 'draft.approved' && x.bot === 'tracer'));
  assert.equal((await a.req('POST', `/api/asks/${draft.id}/answer`, { answer: 'allow' })).status, 200, 'the authenticated paired phone can approve');
  assert.ok((await a.req('GET', '/api/events')).body.some((x: any) => x.kind === 'draft.approved' && x.bot === 'tracer'));

  // Another member cannot mint a code; the owner's view-only tablet can watch but not answer.
  const offer = (await http('POST', '/api/phones/pair', { role: 'view' })).body;
  const watcher = open(await pairPhone(offer.qr, 'Tablet'));
  assert.equal(watcher.link.grant.device.role, 'view');
  assert.equal((await watcher.req('GET', '/api/state')).body.person.id, 1);
  assert.equal((await watcher.req('POST', '/api/bots/chief/messages', { text: 'hi' })).status, 403);

  // The person's paired phone renews a code that is showing, so its card refreshes itself (docs/ui-contract.md).
  await http('POST', '/api/bots/chief/messages', { text: 'pair my phone' });
  const live = (await http('GET', '/api/bots/chief')).body.phoneOffer;
  const oldRefresh = await a.req('POST', '/api/phones/refresh', { message: live.message, member: 2 });
  assert.deepEqual(oldRefresh, { status: 426, body: { error: 'Get the latest Crewhouse app to keep chatting.' } });
  assert.equal((await http('POST', '/api/phones/refresh', { message: live.message, member: 1 })).status, 426);
  const fromPhone = await a.req('POST', '/api/phones/refresh', { message: live.message });
  assert.equal(fromPhone.status, 200);
  assert.ok(fromPhone.body.token && fromPhone.body.token !== live.token, 'a fresh code, minted at the phone\'s ask');
  assert.equal(fromPhone.body.member, undefined, 'renewed codes have no person selector');

  // Settings lists both; removing one closes its link, the phone forgets its grant, and its key is refused.
  const phones = (await http('GET', '/api/phones')).body;
  assert.deepEqual(phones.map((d: any) => [d.name, d.role, d.online]), [['Pixel', 'control', true], ['Tablet', 'view', true]]);
  assert.equal((await http('DELETE', `/api/phones/${phones[0].id}`)).status, 200);
  await until(async () => a.status() === 'removed');
  const again = open(grant);
  await until(async () => again.status() === 'removed', 15_000);
  assert.equal((await watcher.req('GET', '/api/state')).status, 200, 'other phones are untouched');
  watcher.link.stop();
});

test('the short typed code and exact local CLI words pair once', async () => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const cli = (...args: string[]) => execFileSync(join(import.meta.dirname, '..', 'crewhouse'), ['phones', ...args],
    { encoding: 'utf8', env: { ...process.env, CREWHOUSE_PORT: String(port), CREWHOUSE_STATE_DIR: join(root, 'state') } });
  const offer = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  assert.equal(offer.typed.replace(/-/g, '').length, 12, 'a code a person types on a phone, not an envelope');
  let words = '';
  const pairing = pairWithCode(offer.urls[0], offer.typed, { name: 'Typed phone', onWords: (w) => { words = w; } });
  await until(async () => (await http('GET', '/api/phones/pending')).body.find((a: any) => a.name === 'Typed phone'));
  assert.match(cli('pending'), /Typed phone/);
  assert.throws(() => cli('approve', 'wrong words'), /Command failed/);
  assert.equal((await http('GET', '/api/phones/pending')).body.length, 1);
  assert.match(cli('approve', words), /approved/);
  const grant = await pairing;
  assert.equal(grant.device.role, 'control');
  const phone = (await http('GET', '/api/phones')).body.find((p: any) => p.id === grant.device.id);
  assert.ok(phone, 'the paired phone appears in the computer’s phone list');
  assert.equal(Object.hasOwn(phone, 'member'), false, 'the paired phone has no person selector');
  assert.equal(Object.hasOwn(phone, 'person'), false, 'the paired phone needs no person label');
  await assert.rejects(pairWithCode(offer.urls[0], offer.typed, { name: 'Again', onWords: () => {} }), /code|used|match|run out/i);
  assert.equal((await http('POST', '/api/phones/approve', { words }, {})).status, 403);
  const lan = await new Promise<number>((resolve, reject) => {
    const req = http1Request({ hostname: '127.0.0.1', port, path: '/api/phones/approve', method: 'POST',
      headers: { host: '192.168.1.2:7711', 'x-crewhouse': '1', 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end(JSON.stringify({ words }));
  });
  assert.equal(lan, 403, 'a LAN-addressed request cannot approve');
  assert.match(cli('code'), /Works once; expires/);
});

test('the relay address: local dial, public offers and typed phone pairing, with no hosted default', async (t) => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const relay = async (url?: unknown, headers?: Record<string, string>) => (await http('PUT', '/api/phones/relay', { url }, headers));
  assert.equal((await http('GET', '/api/phones/link')).body.relay, '', 'no relay unless the family sets one');
  assert.equal((await relay('https://relay.example/ignored/path')).body.relay, 'https://relay.example', 'kept as an origin');
  assert.equal((await relay('ftp://nope')).status, 400);
  assert.equal((await relay('wss://elsewhere.example', {})).status, 403, 'only this computer changes it');
  assert.deepEqual((await relay(null)).body.relay, '', 'back to the default');

  const local = await startRelay({ port: 0, dataDir: join(root, 'relay'), ownerToken: 'lab-owner' });
  // A disposable provider-like public port forwards HTTP and WebSocket bytes to the same local relay.
  const sockets = new Set<Socket>();
  let publicConnections = 0;
  const front = createServer((socket) => {
    publicConnections++;
    sockets.add(socket);
    const target = connect((local.server.address() as AddressInfo).port, '127.0.0.1');
    const close = () => { sockets.delete(socket); socket.destroy(); target.destroy(); };
    socket.on('error', close).on('close', close);
    target.on('error', close);
    socket.pipe(target).pipe(socket);
  });
  t.after(async () => {
    await relay(null);
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => front.close(() => r()));
    await local.close();
  });
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', r));
  const publicUrl = `http://127.0.0.1:${(front.address() as AddressInfo).port}`;
  relayPublic = publicUrl;
  const exited = new Promise((r) => daemon.once('exit', r));
  daemon.kill();
  await exited;
  daemon = startDaemon();
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const invitation = await fetch(`${local.url}/relay/v1/enrolments`, { method: 'POST', headers: { authorization: 'Bearer lab-owner' }, body: '{}' });
  assert.equal(invitation.status, 201);
  const configured = await http('PUT', '/api/phones/relay', { url: local.url, enrol: (await invitation.json()).token });
  assert.deepEqual([configured.status, configured.body.relay, configured.body.relayPublic], [200, local.url, publicUrl]);
  await until(async () => (await http('GET', '/api/phones/link')).body.relayStatus === 'online');
  assert.equal(publicConnections, 0, 'crewd registers by the local address, never by the public proxy');
  const offer = (await http('POST', '/api/phones/pair', { role: 'control' })).body;
  const publicLink = offer.urls.find((u: string) => u.startsWith(publicUrl.replace(/^http/, 'ws')));
  assert.ok(publicLink, 'the advertised offer carries the public link');
  assert.ok(!offer.urls.some((u: string) => u.startsWith(local.url.replace(/^http/, 'ws'))), 'the loopback relay dial address is not advertised');
  assert.deepEqual(parseOffer(offer.qr).urls, offer.urls, 'the QR carries the same public address');
  const typed = (await http('POST', '/api/phones/code', { role: 'control' })).body;
  assert.equal(typed.relay, publicUrl, 'the single typed code names the public origin');
  const code = readTyped(A.phoneTyped(typed));
  assert.equal(code.kind, 'relay');
  if (code.kind !== 'relay') throw new Error('expected a relay code');
  const resolved = await findHost(code.base, code.short);
  assert.equal(resolved, publicLink, 'phone-side findHost resolves through the public proxy');
  let words = '';
  const paired = pairWithCode(resolved, code.code, { name: 'Umer cloud phone', onWords: (w) => { words = w; } });
  const asking = await until(async () => (await http('GET', '/api/phones/pending')).body.find((a: any) => a.name === 'Umer cloud phone'));
  assert.equal(asking.words, words, 'both ends show the same Noise verification words');
  assert.equal((await http('POST', '/api/phones/answer', { id: asking.id, yes: true })).status, 200);
  const grant = await paired;
  assert.ok(grant.urls.includes(publicLink));
  const phone = open(grant);
  t.after(() => phone.link.stop());
  const reach = await phone.req('GET', '/api/reach', { via: 'relay' });
  assert.equal(reach.status, 200);
  assert.ok(reach.body.urls.includes(publicLink), 'the paired phone learns the public route too');
  assert.equal((await phone.req('PUT', '/api/phones/relay', { url: local.url })).status, 403, 'public routing does not grant phone admin');
  const posted = await phone.req('POST', '/api/bots/chief/messages', { text: 'Hello from Umer on the cloud link' });
  assert.equal(posted.status, 200);
  await until(async () => (await phone.req('GET', '/api/bots/chief')).body.tasks.some((job: any) => job.id === posted.body.task && job.state === 'done'));
  assert.ok(publicConnections > 0, 'the phone really used the public proxy');
  console.log(JSON.stringify({ proof: 'relayPublic', local: local.url, public: publicUrl, advertised: publicLink, typedResolved: resolved, phone: 'paired', chief: 'done', engine: 'stub' }));
  const saved = await relay(local.url);
  assert.equal(saved.body.relayPublic, publicUrl, 'a Settings relay save keeps the install-time public origin');
});

test('a bot\'s screen over the link: a watch-only phone may open it, and crewd answers as on the computer\'s own socket', async () => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const grant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'view' })).body.qr, 'Watcher');
  const w = open(grant);
  await until(async () => w.status() === 'online');
  const s = await w.link.stream('desktop', { bot: 'chief', build: 'p9b' });
  const lines: any[] = [];
  let buf = '';
  s.onData = (c) => { buf += new TextDecoder().decode(c); for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) lines.push(JSON.parse(buf.slice(0, i))); };
  await s.write(JSON.stringify({ id: 1, method: 'session.open', params: { permissions: ['view'] } }) + '\n');
  const reply = await until(async () => lines.find((l) => l.id === 1));
  assert.equal(reply.error.code, 'no-screen', 'Chief has no computer; said as the computer\'s socket says it');
  s.end();
  // Watching isn't hiring: a watch-only phone can't add a helper; a phone that can answer adds one from the gallery.
  assert.equal((await w.req('POST', '/api/recruit', { template: 'scribe', name: 'Quill' })).status, 403);
  const c = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Helper-adder'));
  const added = await c.req('POST', '/api/recruit', { template: 'scribe', name: 'Quill' });
  assert.deepEqual([added.status, added.body.id], [200, 'quill']);
  c.link.stop();
  // A stream for anything else, or a bot name that isn't one, is turned away.
  const bad = await w.link.stream('desktop', { bot: '../x', build: 'p9b' });
  const ended = await new Promise<string | undefined>((r) => { bad.onEnd = r; });
  assert.equal(ended, 'not-supported');
  w.link.stop();
});



test('a phone sends a document too big for one link frame on a stream; it lands in the helper\'s inbox, and a watch-only phone cannot', async () => {
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const c = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Statement sender'));
  const w = open(await pairPhone((await http('POST', '/api/phones/pair', { role: 'view' })).body.qr, 'Statement watcher'));
  await until(async () => c.status() === 'online' && w.status() === 'online');
  // 2 MB as base64 is more than one link frame (1 MB) carries, so the app sends it as mobile/src/link.ts `big` does.
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 << 20, 7)]), op = 'POST /api/bots/chief/messages';
  const body = JSON.stringify({ text: 'Here is my statement.', files: [{ name: 'northbank-statement.pdf', type: 'application/pdf', data: pdf.toString('base64') }], build: 'p9b' });
  const s = await c.link.stream('request', { op });
  let out = '';
  const ended = new Promise((r) => { s.onEnd = r; });
  s.onData = (b) => { out += new TextDecoder().decode(b); };
  await s.write(body + '\n');
  assert.equal(await ended, undefined);
  assert.equal(JSON.parse(out).status, 200, out.slice(0, 200));
  const line = await until(async () => (await http('GET', '/api/bots/chief')).body.messages.map((m: any) => /\[file ([a-z0-9-]+)\] (files\/inbox\/\S+) (\d+)B northbank-statement\.pdf/.exec(m.text)).find(Boolean));
  assert.equal(Number(line[3]), pdf.length);
  assert.deepEqual(readFileSync(join(root, 'crew', 'bots', line[1], line[2])), pdf, 'the inbox file is the bytes the phone sent');
  assert.equal(await w.link.stream('request', { op }).then(() => 'opened', (e) => e.code), 'view-only');
  for (const x of [c, w]) { x.link.stop(); await http('DELETE', `/api/phones/${x.link.grant.device.id}`); }
});

test('phones, push and quiet hold survive a restart after the P1 migration', async () => {
  const aGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Kept phone');
  const bGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'control' })).body.qr, 'Former phone');
  const viewGrant = await pairPhone((await http('POST', '/api/phones/pair', { role: 'view' })).body.qr, 'Kept tablet');
  await http('DELETE', `/api/phones/${bGrant.device.id}`); // P1 already retired the other person's phone.
  daemon.kill();
  await new Promise((r) => daemon.once('exit', r));
  const db = new DatabaseSync(join(root, 'state', 'crew.db'));
  const pk = db.prepare('SELECT pk FROM devices WHERE id = ?').get(aGrant.device.id)!.pk as string;
  db.prepare('UPDATE devices SET pk = ? WHERE id = ?').run(Buffer.from(pk, 'base64url').toString('base64'), aGrant.device.id);
  const hour = new Date().getHours();
  const time = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  db.prepare('UPDATE people SET quiet = ? WHERE id = 1').run(`${time(hour - 1)}-${time(hour + 1)}`);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('push.held.1', '1')").run();
  for (const [id, token] of [[aGrant.device.id, 'ExponentPushToken[kept]'], [bGrant.device.id, 'ExponentPushToken[former]']])
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`phone.push.${id}`, token);
  db.close();
  const pushes: any[][] = [];
  const expo = http1((q, r) => { let body = ''; q.on('data', (c) => { body += c; }); q.on('end', () => { const messages = JSON.parse(body); pushes.push(messages); r.end(JSON.stringify({ data: messages.map(() => ({ status: 'ok' })) })); }); });
  await new Promise<void>((r) => expo.listen(0, '127.0.0.1', r));
  after(() => expo.close());
  pushUrl = `http://127.0.0.1:${(expo.address() as AddressInfo).port}/push`;
  daemon = startDaemon();
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  const a = open(aGrant); const b = open(bGrant); const view = open(viewGrant);
  try {
    await until(async () => b.status() === 'removed');
    await until(async () => b.stored() === null);
    assert.equal((await b.req('GET', '/api/state')).status, 0, 'removed phone cannot fetch the person’s state');
    assert.equal(b.events.length, 0, 'no person’s activity arrives before refusal');
    const phones = (await http('GET', '/api/phones')).body;
    assert.ok(!phones.some((p: any) => p.id === bGrant.device.id));
    assert.ok(phones.some((p: any) => p.id === aGrant.device.id));
    assert.equal((await a.req('GET', '/api/state')).body.person.id, 1, 'legacy base64 host record keeps the phone paired');
    assert.equal((await view.req('GET', '/api/state')).status, 200);
    assert.equal((await view.req('POST', '/api/bots/chief/messages', { text: 'no' })).status, 403);
    assert.equal(pushes.length, 0, 'quiet hours still hold news across the upgrade');
    const live = new DatabaseSync(join(root, 'state', 'crew.db'), { timeout: 3000 });
    try {
      assert.equal(live.prepare("SELECT value FROM settings WHERE key = 'push.held.1'").get()!.value, '1');
      assert.equal(live.prepare('SELECT 1 FROM devices WHERE id = ?').get(bGrant.device.id), undefined);
      live.prepare('UPDATE people SET quiet = NULL WHERE id = 1').run();
      await until(async () => pushes.length > 0, 40_000);
      assert.deepEqual(pushes.flat().map((p) => [p.to, p.title]), [['ExponentPushToken[kept]', NEWS]], 'only the retained phone gets content-free held news');
      await until(async () => !live.prepare("SELECT 1 FROM settings WHERE key = 'push.held.1'").get());
      await a.req('POST', '/api/bots/chief/messages', { text: 'hello after upgrade' });
      await until(async () => pushes.length >= 2);
      assert.ok(pushes.flat().every((p) => p.to === 'ExponentPushToken[kept]' && p.title === NEWS));
      // Chief's profile switch, "Tell me when Chief finishes or needs me": off, Chief's reply sends nothing; on again, news resumes.
      const replies = () => live.prepare("SELECT seq FROM events WHERE kind = 'message' AND bot = 'chief' AND json_extract(data, '$.author') = 'bot' ORDER BY seq").all().map((r: any) => `e${r.seq}`);
      const told = () => pushes.flat().map((p) => p.collapseId);
      assert.deepEqual((await a.req('GET', '/api/notify')).body, { on: true });
      assert.deepEqual((await a.req('PUT', '/api/notify', { on: false })).body, { on: false });
      const said = replies().length;
      await a.req('POST', '/api/bots/chief/messages', { text: 'quiet now' });
      await until(async () => replies().length > said);
      assert.deepEqual((await http('PUT', '/api/notify', { on: true })).body, { on: true });
      await a.req('POST', '/api/bots/chief/messages', { text: 'tell me again' });
      await until(async () => replies().length > said + 1 && told().includes(replies()[said + 1]));
      assert.ok(!told().includes(replies()[said]), 'switched off, Chief’s reply pushes nothing');
    } finally { live.close(); }
    assert.equal((await http('PUT', '/api/people/42', { name: 'Umer' })).status, 200, 'legacy route shape edits only the person');
    const snapshot = (await a.req('GET', '/api/state')).body;
    assert.equal(snapshot.person.name, 'Umer');
    assert.equal(Object.hasOwn(snapshot, 'members'), false, 'current phones use person alone');
    assert.equal(typeof snapshot.house.google, 'boolean');
    assert.ok(Object.hasOwn(snapshot.house, 'steps'));
    assert.equal((await http('POST', '/api/accounts/42/chatgpt/retry')).status, 200, 'account route ignores the former member segment');
    assert.equal((await http('POST', '/api/people', { name: 'Another' })).status, 404);
    assert.equal((await http('GET', '/api/people')).status, 404);
    assert.equal((await http('POST', '/api/house/ask', { app: 'calendar' })).status, 404);
    assert.equal((await http('POST', '/api/accounts/1/chatgpt/ask-owner')).status, 404);
  } finally { a.link.stop(); b.link.stop(); view.link.stop(); }
});

test('one browser turning notifications off leaves the other browsers addressed', async () => {
  const db = new Store(temp('crewhouse-web-off'));
  const calls: any[] = [];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { vapidKey: 'BFx-key', subscribe: async (d: string, s: any) => calls.push(['subscribe', d, s]), unsubscribe: async (d: string, s?: any) => calls.push(['unsubscribe', d, s]), notify: async (n: any) => { calls.push(['notify', n]); return {}; } },
    relayStatus: 'online', host: { devices: () => [] },
  });
  const laptop = { endpoint: 'https://fcm.example/laptop', keys: {} }, phone = { endpoint: 'https://fcm.example/phone', keys: {} };
  await link.setWebPush({ web: laptop });
  await link.setWebPush({ web: phone });
  await link.setWebPush({ off: true, web: laptop });
  assert.deepEqual(calls.at(-1), ['unsubscribe', 'web', { web: laptop }], 'only the laptop\'s address is dropped');
  await link.setWebPush({ off: true, web: phone });
  assert.deepEqual(calls.at(-1), ['unsubscribe', 'web', { web: phone }]);
  db.close();
});

test('a null browser address is refused by the browser and by a phone alike', async () => {
  const db = new Store(temp('crewhouse-web-null'));
  const calls: any[] = [];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { vapidKey: 'BFx-key', subscribe: async (d: string, s: any) => calls.push(['subscribe', d, s]), unsubscribe: async (d: string, s?: any) => calls.push(['unsubscribe', d, s]), notify: async () => ({}) },
    relayStatus: 'online', host: { devices: () => [] },
  });
  await assert.rejects(link.setWebPush({ web: null }), { status: 409 });
  await assert.rejects(link.setWebPush({ off: true, web: null }), { status: 400 });
  assert.deepEqual(await link.request('POST /api/push', { build: 'p9b', web: null }, { id: 'pixel' }), { status: 409, body: { error: 'no relay for notifications' } });
  assert.equal(calls.length, 0, 'nothing reaches the relay');
  const web = { endpoint: 'https://fcm.example/phone', keys: {} };
  assert.deepEqual(await link.request('POST /api/push', { build: 'p9b', web }, { id: 'pixel' }), { status: 200, body: { ok: true } });
  assert.deepEqual(calls.shift(), ['subscribe', 'pixel', { web }], 'a phone\'s browser address is still kept under the phone');
  db.close();
});

test('headless published relay accepts private LAN origins but refuses public IPv4', async () => {
  const repo = join(import.meta.dirname, '..');
  const setup = (ip: string) => new Promise<string>((yes, no) => execFile(process.execPath,
    ['scripts/headless.mjs', 'setup', '--install-only'], { cwd: repo, env: { ...process.env, CREWHOUSE_RELAY_PUBLIC: `http://${ip}:7300` } },
    (error, stdout) => error ? no(error) : yes(stdout)));
  for (const ip of ['192.168.1.144', '10.0.0.1', '172.16.0.1', '172.31.255.254']) assert.match(await setup(ip), /Headless files ready/);
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1']) await assert.rejects(setup(ip), /tailnet or private IPv4/);
});

for (const publicMode of [false, true]) test(`a headless runner pairs once and keeps owner authority across restart (${publicMode ? 'published relay, no Tailscale' : 'direct tailnet'})`, async (t) => {
  const dir = temp(`headless-${publicMode}`), bin = join(dir, 'bin'), repo = join(import.meta.dirname, '..');
  mkdirSync(bin);
  writeFileSync(join(bin, 'tailscale'), publicMode ? `#!/bin/sh\ntouch '${join(dir, 'ts-called')}'\nexit 79\n` : '#!/bin/sh\nprintf \'%s\\n\' \'{"BackendState":"Running","Self":{"TailscaleIPs":["127.0.0.2"]}}\'\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_PAIR_MS: '3000',
    CREWHOUSE_STATE_DIR: join(dir, 'state'), CREWHOUSE_CREW_DIR: join(dir, 'crew'), CREWHOUSE_TOOLS_DIR: join(dir, 'tools'),
    CREWHOUSE_PORT: String(await free()), CREWHOUSE_LINK_PORT: String(await free()), CREWHOUSE_RELAY_PORT: String(await free()) };
  if (publicMode) Object.assign(env, { CREWHOUSE_RELAY_PUBLIC: `http://127.0.0.2:${env.CREWHOUSE_RELAY_PORT}` });
  let log = '', host: ReturnType<typeof spawn>, phone: ReturnType<typeof open> | undefined;
  const boot = () => { host = spawn(process.execPath, ['scripts/headless.mjs'], { cwd: repo, env }); host.stdout!.on('data', (b) => log += b); host.stderr!.on('data', (b) => log += b); };
  const stop = async () => { if (host?.exitCode === null) { host.kill('SIGTERM'); await new Promise(r => host.once('exit', r)); } };
  t.after(async () => { phone?.link.stop(); await stop(); });
  const cli = (...args: string[]) => new Promise<string>((yes, no) => execFile(join(repo, 'crewhouse'), ['headless', ...args], { env }, (e, stdout) => e ? no(e) : yes(stdout)));
  const local = async (path: string, body?: object) => {
    const r = await fetch(`http://127.0.0.1:${env.CREWHOUSE_PORT}/api/${path}`, { method: body ? 'POST' : 'GET', headers: {
      'x-crewhouse': '1', 'content-type': 'application/json', authorization: `Bearer ${readFileSync(join(dir, 'state/person.key'), 'utf8')}` }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  await until(async () => (await http('GET', '/api/state').catch(() => null))?.status === 200);
  assert.equal((await http('POST', '/api/phones/pair', { first: true })).status, 409, 'desktop flow cannot auto-enrol');
  boot();
  await until(async () => log.includes('headless host ready')).catch(e => { throw new Error(`${e.message}\n${log}`); });
  assert.deepEqual((await local('phones/link')).body.hosts.sort(), publicMode ? [] : ['127.0.0.1', '127.0.0.2']);
  assert.equal((await local('phones/pair', { first: true, role: 'view' })).status, 409);
  const expired = (await local('phones/pair', { first: true })).body.qr;
  await until(async () => Date.now() > parseOffer(expired, 0).expires);
  await assert.rejects(pairWithOffer(expired, { name: 'Expired', onWords: () => {} }), /run out/);
  const printed = await cli('pair'), typed = /Pairing code: (.+)/.exec(printed)![1];
  assert.match(printed, /[▀▄█]/, 'terminal QR is printed too');
  const decoded = readTyped(typed);
  assert.equal(decoded.kind, 'relay', 'first-owner code uses the existing relay-code phone path');
  if (decoded.kind !== 'relay') throw new Error('missing relay code');
  assert.equal(new URL(decoded.base).hostname, '127.0.0.2');
  const relay = await findHost(decoded.base, decoded.short);
  const attempts = await Promise.allSettled(['Umer', 'Other'].map(name => pairWithCode(relay, decoded.code, { name, onWords: () => {} })));
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1, 'only one phone gets the first offer');
  const grant = (attempts.find(a => a.status === 'fulfilled') as PromiseFulfilledResult<DeviceGrant>).value;
  phone = open(grant);
  assert.equal((await phone.req('GET', '/api/accounts')).status, 200, 'owner has computer authority');
  await phone.req('GET', '/api/reach', { ip: '100.64.0.2', via: 'relay' });
  assert.equal((await phone.req('POST', '/api/phones/pair', { first: true })).status, 403, 'even owner cannot mint another first code');
  assert.equal((await local('phones/pair', { first: true })).status, 409);
  await phone.req('POST', '/api/bots/chief/messages', { text: 'hello headless Umer' });
  await until(async () => (await phone!.req('GET', '/api/bots/chief')).body.messages.some((m: any) => m.author === 'bot' && m.text.includes('hello headless Umer')));
  assert.ok(!log.includes(typed) && !log.includes(decoded.code), 'service logs contain no full pairing capability');
  phone.link.stop(); await stop(); log = ''; boot();
  await until(async () => log.includes('headless host ready'));
  phone = open(grant);
  assert.equal((await phone.req('POST', '/api/accounts/1/chatgpt/retry')).status, 200, 'owner authority survives a restart');
  assert.equal((await phone.req('GET', '/api/phones')).body.length, 1);
  assert.match(await cli('health'), /healthy/);
  assert.equal((await local('phones/pair', { first: true })).status, 409);
  await phone.req('DELETE', `/api/phones/${grant.device.id}`);
  assert.equal((await local('phones/pair', { first: true })).status, 409, 'revoking the first phone does not reopen bootstrap');
  if (publicMode) assert.equal(existsSync(join(dir, 'ts-called')), false, 'published mode never invokes Tailscale, including phone reach');
});

test('a paired browser asks for the push key over the link, and off really removes its address', async () => {
  const db = new Store(temp('crewhouse-web-off-relay'));
  const calls: any[] = [];
  const link = Object.assign(new Link({} as any, db, async () => null) as any, {
    client: { vapidKey: 'BFx-key', subscribe: async (d: string, s: any) => calls.push(['subscribe', d, s]), unsubscribe: async (d: string, s?: any) => calls.push(['unsubscribe', d, s]), notify: async () => ({}) },
    relayStatus: 'online', host: { devices: () => [] },
  });
  // The installed PWA's own ask: the mailbox's public key, over the one op the link answers for its grant.
  assert.deepEqual(await link.request('POST /api/push', { key: true, build: 'p9b' }, { id: 'ipad', role: 'control' }),
    { status: 200, body: { ok: true, vapid: 'BFx-key', online: true } });
  // Without a mailbox the key is null and online false — plain words on the device, never a broken toggle.
  (link as any).client = undefined;
  (link as any).relayStatus = 'off';
  assert.deepEqual(await link.request('POST /api/push', { key: true, build: 'p9b' }, { id: 'ipad', role: 'control' }),
    { status: 200, body: { ok: true, vapid: null, online: false } });
  // Turning off removes this device's own address at the mailbox (under its grant id, as setWebPush does for 'web').
  (link as any).client = { unsubscribe: async (d: string, s?: any) => calls.push(['unsubscribe', d, s]) };
  const web = { endpoint: 'https://fcm.example/ipad', keys: {} };
  assert.deepEqual(await link.request('POST /api/push', { build: 'p9b', off: true, web }, { id: 'ipad', role: 'control' }), { status: 200, body: { ok: true } });
  assert.deepEqual(calls, [['unsubscribe', 'ipad', { web }]], 'off drops the calling device\'s own address, not another\'s');
  (link as any).client = { unsubscribe: async () => { throw Object.assign(new Error('relay down'), { status: 503 }); } };
  assert.deepEqual(await link.request('POST /api/push', { build: 'p9b', off: true, web }, { id: 'ipad', role: 'control' }), { status: 200, body: { ok: true } }, 'off ends off even when the mailbox is down');
  // Off without a browser address stays the phone app\'s person-said-no.
  assert.deepEqual(await link.request('POST /api/push', { build: 'p9b', off: true }, { id: 'ipad', role: 'control' }), { status: 200, body: { ok: true } });
  assert.equal(db.get('SELECT value FROM settings WHERE key = ?', 'phone.push.ipad')?.value, 'off');
  assert.equal(calls.length, 1, 'no second unsubscribe');
  db.close();
});
