// Exercise the actual phone adapter and published kits with fake native boundaries; no device, account or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { b64url, hostId, type DeviceGrant } from '@byokit/link';
import { qrMatrix } from '@byokit/ui-core/link';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const secure = `export const values = new Map(); export const writes = [];
export const getItemAsync = async k => values.get(k) ?? null;
export const setItemAsync = async (k,v) => { writes.push([k,v]); values.set(k,v); };
export const deleteItemAsync = async k => { values.delete(k); };`;
const native = `export default class Browser {
 static current; listeners = new Map(); scans = []; stops = 0;
 constructor() { Browser.current = this; }
 on(e,f) { this.listeners.set(e,f); } scan(...args) { this.scans.push(args); }
 stop() { this.stops++; } emit(e,v) { this.listeners.get(e)?.(v); }
}`;
const grant: DeviceGrant = { v: 1, secretKey: b64url(new Uint8Array(32).fill(3)),
  host: b64url(new Uint8Array(32).fill(9)), hostName: 'Home', urls: ['ws://192.168.1.2:7711/link'],
  device: { id: 'paired-id', name: 'Phone', role: 'control' }, nextSecretKey: b64url(new Uint8Array(32).fill(4)) };

test('phone kit migration preserves grants, legacy identity, cleanup and authenticated discovery hints', async () => {
  const dir = mkdtempSync(resolve('.lab-device-'));
  try {
    const out = join(dir, 'adapter.mjs');
    await build({ stdin: { contents: `export * from './mobile/src/link.ts'; export * as secure from 'expo-secure-store'; export { default as Browser } from 'react-native-zeroconf';`, resolveDir: process.cwd() },
      outfile: out, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins: [{ name: 'native-boundaries', setup(b) {
        b.onResolve({ filter: /^@byokit\/reach$/ }, () => ({ path: resolve('node_modules/@byokit/reach/dist/rn.js') }));
        b.onResolve({ filter: /^(expo-|react-native-zeroconf)/ }, a => ({ path: a.path, namespace: 'fake' }));
        b.onResolve({ filter: /modules\/crewhouse-net$/ }, () => ({ path: 'net', namespace: 'fake' }));
        b.onLoad({ filter: /.*/, namespace: 'fake' }, a => ({ contents: a.path === 'expo-secure-store' ? secure : a.path === 'react-native-zeroconf' ? native :
          a.path === 'expo-file-system' ? `export const Paths = {}; export class File { exists = false; delete() {} }` :
          a.path === 'net' ? `export const addresses = async () => [];` : a.path === 'expo-device' ? `export const deviceName = 'Phone'; export const modelName = 'Phone';` : `export const AndroidImportance = {}; export const setNotificationChannelAsync = async () => {}; export const getPermissionsAsync = async () => ({status:'denied'}); export const requestPermissionsAsync = getPermissionsAsync; export const getExpoPushTokenAsync = async () => ({data:''});` }));
        b.onLoad({ filter: /mobile\/src\/link\.ts$/ }, a => ({ contents: readFileSync(a.path, 'utf8') + '\nexport { look };', loader: 'ts' }));
      } }] });
    const phone = await import(pathToFileURL(out).href);
    const original = JSON.stringify(grant);
    phone.secure.values.set('crewhouse.grant', original); // bytes written by the pre-upgrade app
    assert.deepEqual(await phone.loadGrant(), grant);
    assert.equal(phone.secure.values.get('crewhouse.grant'), original);
    assert.deepEqual(phone.secure.writes, [], 'reading a paired v1 grant never rewrites it');
    const legacy = { sk: Buffer.from(new Uint8Array(32).fill(251)).toString('base64'),
      crewdPk: Buffer.from(new Uint8Array(32).fill(9)).toString('base64'), fp: 'c31a 7a40 64b2 bdc1', urls: grant.urls, device: grant.device };
    phone.secure.values.set('crewhouse.grant', JSON.stringify(legacy));
    const moved = await phone.loadGrant();
    assert.equal(moved.secretKey, b64url(new Uint8Array(32).fill(251)));
    assert.equal(moved.host, grant.host);
    assert.deepEqual(moved.device, grant.device);
    assert.deepEqual(moved.urls, grant.urls);
    assert.equal(phone.secure.values.get('crewhouse.grant'), JSON.stringify(moved), 'kit save has the old JSON byte format/key');
    assert.deepEqual(await phone.loadGrant(), moved, 'next launch reads the migrated grant through the kit');
    for (const bad of [{ ...legacy, fp: 'wrong' }, { ...legacy, sk: '+/8=' }]) {
      const saved = JSON.stringify(bad);
      phone.secure.values.set('crewhouse.grant', saved);
      const writes = phone.secure.writes.length;
      await assert.rejects(phone.loadGrant(), { name: 'GrantMigrationError', code: 'invalid-grant' });
      assert.equal(phone.secure.values.get('crewhouse.grant'), saved, 'failed migration preserves the original');
      assert.equal(phone.secure.writes.length, writes);
    }
    phone.secure.values.set('crewhouse.grant', JSON.stringify(moved));
    phone.kept.chat('any', { messages: [{ text: 'private', at: Date.now() }] });
    assert.equal(phone.kept.page('any').messages.length, 1);
    phone.secure.values.set('crewhouse.said', '{}');
    await phone.forgetGrant();
    assert.equal(await phone.loadGrant(), null);
    assert.equal(phone.secure.values.has('crewhouse.said'), false);
    assert.deepEqual(phone.kept.page('any'), null);

    const urls: string[] = [];
    const stop = phone.look(grant, (url: string) => urls.push(url));
    const browser = phone.Browser.current;
    assert.deepEqual(browser.scans, [['crewhouse', 'tcp', 'local.']]);
    const found = { name: 'Home', fullName: 'Home._crewhouse._tcp.', txt: { id: hostId(new Uint8Array(32).fill(9)), url: grant.urls[0] } };
    browser.emit('resolved', { ...found, txt: { ...found.txt, id: 'another-host' } });
    browser.emit('resolved', { ...found, txt: { ...found.txt, url: 'https://example.invalid' } });
    browser.emit('resolved', found);
    browser.emit('resolved', { ...found, txt: { ...found.txt, url: 'ws://192.168.1.3:7711/link' } });
    assert.deepEqual(urls, [grant.urls[0], 'ws://192.168.1.3:7711/link'], 'found and updated only suggest this paired host');
    browser.emit('error', new Error('no Wi-Fi'));
    stop(); stop();
    browser.emit('resolved', found);
    assert.equal(browser.stops, 1);
    assert.equal(urls.length, 2, 'a stopped browse cannot supply routes');
    assert.match(readFileSync('mobile/src/link.ts', 'utf8'), /new DeviceLink\(grant,/, 'discovery still hands routes to the kit authenticated with the saved grant');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('the web SVG renders kit matrix coordinates and refreshes for another offer', async () => {
  const source = readFileSync('web/src/main.tsx', 'utf8');
  const component = source.slice(source.indexOf('function PairQR('), source.indexOf('function PhoneCard('));
  const built = await build({ stdin: { contents: `import { useMemo } from 'react'; import { qrMatrix } from '@byokit/ui-core/link'; ${component} export { PairQR };`, loader: 'tsx' },
    write: false, format: 'esm', jsx: 'automatic' });
  // Resolve bare imports from this repo rather than from a data URL.
  const dir = mkdtempSync(resolve('.lab-qr-'));
  try {
    const { writeFileSync } = await import('node:fs');
    const file = join(dir, 'qr.mjs'); writeFileSync(file, built.outputFiles[0].text);
    const { PairQR } = await import(pathToFileURL(file).href);
    for (const text of ['byokit-link:1:first-offer', 'byokit-link:1:changed-offer']) {
      const matrix = qrMatrix(text, { border: 1 });
      const svg = renderToStaticMarkup(createElement(PairQR, { text }));
      assert.ok(svg.includes(`viewBox="0 0 ${matrix.length} ${matrix.length}"`));
      const cells = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m => [Number(m[1]), Number(m[2])]);
      assert.deepEqual(cells, matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [[x, y]] : [])));
    }
    const mobile = readFileSync('mobile/App.tsx', 'utf8');
    assert.match(mobile, /qrMatrix\(current.qr, \{ border: 0 \}\)/);
    assert.match(mobile, /qr.map\(\(row, y\)/);
    assert.match(mobile, /row.map\(\(dark, x\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
