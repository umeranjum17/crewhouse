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
import { readTyped } from '../web/src/typed.ts';
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
});
