// The installed app's notification tap, driven through the browser's own pieces (stubbed here, each call logged in order).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../web/src/api.ts';
import { turnOffNotifications, turnOnNotifications } from '../web/src/pwa.ts';

/** Stands in for the browser: the permission prompt, the worker's `ready`, and its push subscription, all logged. */
function browser(log: string[], ready: () => Promise<unknown>, sub: any = null) {
  const reg = {
    pushManager: {
      getSubscription: async () => { log.push('get'); return sub; },
      subscribe: async () => { log.push('subscribe'); return { toJSON: () => ({ endpoint: 'https://push.example/1' }) }; },
    },
  };
  const serviceWorker = { get ready() { log.push('ready'); return ready().then(() => reg); } };
  const globals = { navigator: { serviceWorker }, window: { PushManager: class {} }, Notification: { requestPermission: async () => { log.push('prompt'); return 'granted'; } } };
  const saved = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, Object.fromEntries(Object.entries(globals).map(([k, v]) => [k, { value: v, configurable: true, writable: true }])));
  return () => { for (const [k, d] of Object.entries(saved)) if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; };
}

test('turning notifications on asks for permission before anything else waits, inside the tap', async () => {
  const log: string[] = [];
  const { pushKey, push } = api;
  api.pushKey = async () => { log.push('key'); return { vapid: 'AQAB', ready: true }; };
  api.push = async (body: any) => { log.push(body.off ? 'push:off' : 'push:on'); return { ok: true }; };
  const restore = browser(log, () => Promise.resolve());
  try {
    const on = turnOnNotifications(true);
    assert.deepEqual(log, ['prompt'], 'the prompt is the first thing the tap does');
    assert.equal(await on, 'on');
    assert.deepEqual(log, ['prompt', 'key', 'ready', 'get', 'subscribe', 'push:on']);
  } finally { restore(); Object.assign(api, { pushKey, push }); }
});

test('turning off ends off even when the mailbox cannot be told: the local subscription is already gone', async () => {
  const log: string[] = [];
  const { push } = api;
  api.push = async (body: any) => { log.push(body.off ? 'push:off' : 'push:on'); throw new Error('the computer is off'); };
  const sub = { unsubscribe: async () => { log.push('unsubscribe'); return true; }, toJSON: () => ({ endpoint: 'https://push.example/1' }) };
  const restore = browser(log, () => Promise.resolve(), sub);
  try {
    await assert.doesNotReject(turnOffNotifications());
    assert.deepEqual(log.filter((l) => l === 'unsubscribe' || l.startsWith('push')), ['unsubscribe', 'push:off']);
  } finally { restore(); Object.assign(api, { push }); }
});

test('no relay means no prompt at all, decided from the page state', async () => {
  const log: string[] = [];
  const restore = browser(log, () => Promise.resolve());
  try {
    assert.equal(await turnOnNotifications(false), 'norelay');
    assert.deepEqual(log, []);
  } finally { restore(); }
});

test('a worker that never becomes ready fails the tap instead of hanging it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = browser([], () => new Promise(() => {}));
  try {
    const off = turnOffNotifications();
    t.mock.timers.tick(10_000);
    await assert.rejects(off, /not ready yet/);
  } finally { restore(); }
});
