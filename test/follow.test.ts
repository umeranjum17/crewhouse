// Where phones reach this computer: the home network opens only while a pairing code lasts (or when the owner leaves it
// on), and says so over mDNS; a phone paired on one address learns the ones this computer gains later (its home address
// moved, Tailscale came up) while any route is up, and dials them once the old one is gone. The interfaces and the mDNS
// publisher are fake; the sockets, the Noise handshake and the phone's side are real, all on loopback.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { DeviceLink, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
process.env.CREWHOUSE_PAIR_MS = '1500'; // read when src/link.ts loads
const { loadConfig } = await import('../src/config.ts');
const { Store } = await import('../src/db.ts');
const { Link } = await import('../src/link.ts');

const root = temp('follow');
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => T | undefined | false, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) { const v = fn(); if (v) return v; }
  throw new Error(`timed out waiting for ${what}`);
}
const at = (address: string) => [{ address, family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }] as any;

/** A computer whose interfaces the test moves, with the home network on unless `lan` is false. Its mDNS goes nowhere:
 *  `on` is what it announces now. */
async function computer(name: string, ifaces: Record<string, any>, lan = true) {
  const cfg = { ...loadConfig(), stateDir: join(root, name), linkHost: '', linkPort: await free() };
  const db = new Store(cfg.stateDir);
  const link = new Link(cfg, db, async () => ({ ok: true }));
  link.ifaces = () => ifaces as any;
  const mdns = { on: [] as any[], ever: 0 };
  link.bonjour = {
    publish: (c) => { mdns.on.push(c); mdns.ever++; return { stop: (cb) => { mdns.on.splice(mdns.on.indexOf(c), 1); cb?.(); } }; },
    destroy: (cb) => cb?.(),
  };
  if (lan) db.run("INSERT INTO settings (key, value) VALUES ('link.lan', '1')");
  await link.listen();
  after(() => { link.close(); db.close(); });
  return { link, port: cfg.linkPort, ifaces, mdns };
}
const dials = (url: string) => new Promise<boolean>((resolve) => {
  const ws = new WebSocket(url);
  ws.onopen = () => { ws.close(); resolve(true); };
  ws.onerror = () => resolve(false);
});

function phone(grant: DeviceGrant) {
  let status: LinkStatus = 'connecting';
  const saved: DeviceGrant[] = [];
  // As mobile/src/link.ts does: each address the computer names is remembered.
  const link: DeviceLink = new DeviceLink(grant, { store: { save: (g) => { saved.push(g); }, clear: () => {} }, onStatus: (s) => { status = s; },
    onEvent: (e: any) => { if (e.kind === 'link.urls') e.data.urls.forEach((u: string) => link.addUrl(u)); } });
  after(() => link.stop());
  return { link, saved, status: () => status };
}

test('a paired phone learns the addresses this computer gains, and reaches it after the old one is gone', async () => {
  const home = await computer('home', { wlan0: at('127.0.0.2') });
  const offer = await home.link.offer('control', 1);
  assert.deepEqual(offer.urls, [`ws://127.0.0.2:${home.port}/link`]);
  const paired = pairWithOffer(offer.qr, { name: 'Pixel', onWords: () => {} });
  const asking = await until('asked at the computer', () => home.link.status().asking[0]);
  home.link.answer(asking.id, true);
  const grant = await paired;

  const p = phone(grant);
  await until('online', () => p.status() === 'online');

  // The router hands the computer a new home address, and Tailscale comes up: bind() (every half minute) tells the phone.
  home.ifaces.wlan0 = at('127.0.0.3');
  home.ifaces.tailscale0 = at('100.101.2.3');
  await home.link.bind();
  const moved = `ws://127.0.0.3:${home.port}/link`, tailnet = `ws://100.101.2.3:${home.port}/link`;
  const kept = await until('the phone keeps the new addresses', () => p.saved.at(-1)?.urls.includes(tailnet) && p.saved.at(-1));
  assert.deepEqual(kept.urls, [`ws://127.0.0.2:${home.port}/link`, moved, tailnet]);
  const reach = await p.link.request('GET /api/reach') as { body: { urls: string[] } };
  assert.deepEqual(reach.body.urls, [moved, tailnet], 'a phone that was offline asks on reconnect');
  p.link.stop();

  // The old address is gone: the phone dials the one it learned.
  const later = phone({ ...kept, urls: [moved] });
  await until('online at the new address', () => later.status() === 'online');
});

test('another computer at a learned address fails the handshake', async () => {
  const home = await computer('home2', { wlan0: at('127.0.0.5') });
  const other = await computer('other', { wlan0: at('127.0.0.6') });
  const paired = pairWithOffer((await home.link.offer('control', 1)).qr, { name: 'Pixel', onWords: () => {} });
  home.link.answer((await until('asked', () => home.link.status().asking[0])).id, true);
  const grant = await paired;
  const p = phone({ ...grant, urls: [`ws://127.0.0.6:${other.port}/link`] });
  await until('refused', () => p.status() === 'refused');
});

test('the home network opens for a pairing code, closes after it, and stays open only when the owner turns it on', async () => {
  const home = await computer('window', { wlan0: at('127.0.0.7') }, false);
  const lan = `ws://127.0.0.7:${home.port}/link`;
  assert.deepEqual(home.link.status().hosts, ['127.0.0.1'], 'off by default: loopback (and Tailscale) only');
  assert.equal(await dials(lan), false);
  assert.equal(home.mdns.on.length, 0, 'and nothing announced');

  const offer = await home.link.offer('control', 1);
  assert.deepEqual(offer.urls, [lan], 'the code carries the home address');
  assert.deepEqual(home.link.status().hosts, ['0.0.0.0']);
  assert.deepEqual(home.mdns.on.map((m) => [m.type, m.port, m.txt]), [['crewhouse', home.port, { id: home.link.host.id, url: lan }]]);
  const paired = pairWithOffer(offer.qr, { name: 'Pixel', onWords: () => {} });
  home.link.answer((await until('asked', () => home.link.status().asking[0])).id, true);
  const p = phone(await paired);
  await until('online', () => p.status() === 'online');

  // The code runs out: the home network closes and the announcement stops. The phone that joined keeps its socket.
  await until('closed after the code', () => home.link.status().hosts.join() === '127.0.0.1', 5000);
  assert.equal(await dials(lan), false);
  assert.equal(home.mdns.on.length, 0);
  assert.equal(p.status(), 'online');
  const req = await p.link.request('GET /api/reach') as { body: { urls: string[] } };
  assert.deepEqual(req.body.urls, ['ws://127.0.0.1:' + home.port + '/link'], 'no home address offered once it is closed');

  // The owner turns "home network" on: open, and announced, past any code.
  await home.link.setLan(true);
  assert.equal(await dials(lan), true);
  assert.equal(home.mdns.on.length, 1);
  await home.link.offer('control', 1);
  await sleep(1700);
  assert.equal(await dials(lan), true, 'still open after the code ran out');
  assert.equal(home.mdns.on.length, 1);
  assert.equal(home.mdns.ever, 2, 'announced once per opening, not per code');
  await home.link.setLan(false);
  assert.equal(home.mdns.on.length, 0);
});
