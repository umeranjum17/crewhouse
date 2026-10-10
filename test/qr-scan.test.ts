// QA-283: the emulator's virtual camera showed a full QR (decodable by zbarimg from the same screenshot) yet the
// app never fired a scan callback. The CameraView wiring matches expo-camera's documented setup for the pinned
// version, and its continuous analyzer uses the bundled MLKit class with no Play Services check, so the failure sits
// upstream of JS in frame delivery — an emulator limitation, not a handler bug. These pin the JS side: a decoded
// payload parses to the live offer through the same step the camera handler's pair() starts with, and both entries
// (camera callback, dev deep link) end in that one handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { b64url, pendingGrant } from '@byokit/pair';

// What the QR holds: offerText's `byokit-link:1:<base64url JSON>`, built here the same way (the kit only exports the
// parse side at the root; mobile/src/link.ts pair() feeds the scanned string straight to pairWithOffer → parseOffer).
const scannedText = (offer: unknown) => `byokit-link:1:${b64url(new TextEncoder().encode(JSON.stringify(offer)))}`;

test('a camera-decoded QR string reaches the live offer through the scan handler\'s parse step', () => {
  const offer = { v: 1, host: b64url(new Uint8Array(32).fill(9)), ticket: b64url(new Uint8Array(16).fill(5)),
    name: 'your computer', expires: Date.now() + 120_000, urls: ['ws://192.168.1.2:9443/link'] };
  const scanned = scannedText(offer);
  assert.ok(scanned.startsWith('byokit-link:1:'), 'the shape QA-283 read back with zbarimg');
  // pendingGrant is synchronous and offline: parseOffer plus grant shaping, the same first step pairWithOffer takes
  // with the camera's r.data in mobile/src/link.ts pair().
  const grant = pendingGrant(scanned, { name: 'Phone' });
  assert.equal(grant.host, offer.host);
  assert.deepEqual(grant.urls, offer.urls);
  assert.equal(grant.hostName, offer.name);
  assert.throws(() => pendingGrant('byokit-link:1:not-an-offer', { name: 'Phone' }), /pairing code/);
  assert.throws(() => pendingGrant(scannedText({ ...offer, expires: Date.now() - 1000 }), { name: 'Phone' }), /run out/);
});

test('the scanner and the dev deep link share one handler (source-pinned, like test/ui.test.ts)', () => {
  const src = readFileSync('mobile/App.tsx', 'utf8');
  assert.match(src, /barcodeScannerSettings=\{\{ barcodeTypes: \['qr'\] \}\}/, 'documented expo-camera setup');
  assert.match(src, /onBarcodeScanned=\{\(r\) => tryCode\(r\.data\)\}/, 'camera delivers raw data, unmodified');
  assert.match(src, /crewhouse:\/\/pair\?code=/, 'dev deep link carries the same payload');
  const entries = [...src.matchAll(/tryCode\((?:r\.data|decodeURIComponent\(m\[1\]\))\)/g)];
  assert.equal(entries.length, 2, 'camera and deep link must both end in tryCode, nowhere else');
  assert.match(src, /if \(!__DEV__ \|\| !devPairUrl\) return;/, 'release builds ignore the deep link');
});
