// Addresses that follow the computer: a phone paired on one address learns the ones this computer gains later (its home
// address moved, Tailscale came up) while any route is up, and dials them once the old one is gone. The interfaces are
// fake; the sockets, the Noise handshake and the phone's side are real, all on loopback.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceLink, pairWithOffer, type DeviceGrant, type LinkStatus } from '@byokit/link';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Link } from '../src/link.ts';

const root = mkdtempSync(join(tmpdir(), 'crewhouse-follow-'));
const free = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => T | undefined | false, ms = 10_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) { const v = fn(); if (v) return v; }
  throw new Error(`timed out waiting for ${what}`);
}
const at = (address: string) => [{ address, family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }] as any;

/** A computer with the home network on, whose interfaces the test moves. */
async function computer(name: string, ifaces: Record<string, any>) {
  const cfg = { ...loadConfig(), stateDir: join(root, name), linkHost: '', linkPort: await free() };
  const db = new Store(cfg.stateDir);
  const link = new Link(cfg, db, async () => ({ ok: true }));
  link.ifaces = () => ifaces as any;
  db.run("INSERT INTO settings (key, value) VALUES ('link.lan', '1')");
  await link.listen();
  after(() => { link.close(); db.close(); });
  return { link, port: cfg.linkPort, ifaces };
}

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
