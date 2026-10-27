// `./crewhouse phones code` run for real against a stand-in crewd that answers its two calls with a relay code, then
// the printed "away" line pasted through the one code box (readTyped): the same rules the phone and the web app use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readLink, readTyped } from '../web/src/typed.ts';
import { temp } from './tmp.ts';

const run = promisify(execFile);
const repo = join(import.meta.dirname, '..');
const dir = temp('phones-code');
const state = join(dir, 'state');
mkdirSync(state, { recursive: true });
writeFileSync(join(state, 'person.key'), 'test-key');

async function printedCode(relay: string) {
  const server: Server = createServer((req, res) => {
    const reply = req.url === '/api/phones/pair'
      ? { typed: 'long-letter-envelope', expires: Date.now() + 60_000 }
      : { short: 'K7M2QX', code: '7KQ4M2XP9RTH', relay, expires: Date.now() + 60_000 };
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply)); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await run('bash', [join(repo, 'crewhouse'), 'phones', 'code'], {
      cwd: repo,
      env: { ...process.env, CREWHOUSE_STATE_DIR: state, CREWHOUSE_PORT: String((server.address() as AddressInfo).port) },
    });
    return stdout.trimEnd().split('\n').at(-1)!;
  } finally {
    server.close();
  }
}

test('the printed away code pastes back through the one code box, for an https, a wss and a local http relay', async () => {
  assert.deepEqual(readTyped(await printedCode('https://relay.example.com')),
    { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://relay.example.com' });
  assert.deepEqual(readTyped(await printedCode('wss://relay.example.com:8443')),
    { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://relay.example.com:8443' });
  assert.deepEqual(readTyped(await printedCode('http://127.0.0.1:7712')),
    { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'http://127.0.0.1:7712' });
  assert.deepEqual(readTyped(await printedCode('https://localhost:8443')),
    { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://localhost:8443' });
  assert.deepEqual(readTyped(await printedCode('wss://[::1]:8443')),
    { kind: 'relay', short: 'K7M2QX', code: '7KQ4M2XP9RTH', base: 'https://[::1]:8443' });
});

// `./crewhouse link` against a stand-in crewd, and the one box on the phone's first screen taking what it prints.
async function ranLink(status: object, ...args: string[]) {
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(status)); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const out = await run('bash', [join(repo, 'crewhouse'), 'link', ...args], { cwd: repo, env: { ...process.env, CREWHOUSE_STATE_DIR: state, CREWHOUSE_PORT: String((server.address() as AddressInfo).port) } }).then((r) => ({ ...r, code: 0 }), (e) => ({ stdout: e.stdout as string, stderr: e.stderr as string, code: e.code as number }));
    return { ...out, seen };
  } finally {
    server.close();
  }
}

test('./crewhouse link prints the standing link, and what it prints pastes back as a page link', async () => {
  const link = 'http://100.101.102.103:7712/pair/q3VxK0aTn8mC2RwYb7LpZg';
  const printed = await ranLink({ pairLink: link, tailscale: true });
  assert.equal(printed.code, 0);
  assert.deepEqual(printed.seen, ['GET /api/phones/link']);
  assert.match(printed.stdout, new RegExp(`^  ${link}$`, 'm'), 'the link on a line of its own, to copy');
  assert.doesNotMatch(printed.stdout, /no Tailscale address/);
  assert.deepEqual(readLink(printed.stdout), { kind: 'page', url: link }, 'the whole printout pastes as the link');
  assert.match((await ranLink({ pairLink: link, tailscale: false })).stdout, /no Tailscale address/, 'a link that reaches only the home Wi-Fi says so');
  const renewed = await ranLink({ pairLink: link, tailscale: true }, 'new');
  assert.deepEqual(renewed.seen, ['POST /api/phones/link']);
  assert.match(renewed.stdout, /old link no longer opens/);
  const idle = await ranLink({ pairLink: '' });
  assert.notEqual(idle.code, 0);
  assert.match(idle.stderr, /not listening for phones yet/);
});

test('a tapped, scanned or pasted link is read the same way in every build; anything else is not a link', () => {
  const offer = 'byokit-link:1:eyJ2IjoxfQ';
  assert.deepEqual(readLink(`crewhouse://pair?code=${encodeURIComponent(offer)}`), { kind: 'offer', text: offer }, 'the page button, as the app is opened with it');
  assert.deepEqual(readLink(offer), { kind: 'offer', text: offer }, 'a QR of the ticket');
  assert.deepEqual(readLink('BYOKIT-LINK:2:ABC'), { kind: 'offer', text: 'BYOKIT-LINK:2:ABC' }, 'the small QR form');
  const page = 'http://100.101.102.103:7712/pair/q3VxK0aTn8mC2RwYb7LpZg';
  assert.deepEqual(readLink(page), { kind: 'page', url: page });
  assert.deepEqual(readLink(`  Open ${page}?install=1 on your phone.\n`), { kind: 'page', url: page }, 'words around it, and the page\'s own install query, are left behind');
  assert.deepEqual(readLink('https://computer.tail1234.ts.net:7712/pair/AbC_-123'), { kind: 'page', url: 'https://computer.tail1234.ts.net:7712/pair/AbC_-123' });
  for (const no of ['', '7KQ4-M2XP-9RTH', 'K7M2QX-7KQ4M2XP9RTH@relay.example.com', 'https://example.com/', 'crewhouse://needs', 'crewhouse://pair?code=%E0%A4%A']) assert.equal(readLink(no), null, no);
});
