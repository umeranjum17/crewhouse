import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';

const exec = promisify(execFile);
const empty = { text: '', tooltip: '', class: 'quiet' };

test('desktop bar reads only the owner and exposes counts, then clears stale status', async (t) => {
  const bot = (id: string, task: unknown) => ({ id, display: `Private ${id}`, template: 'scout', state: 'on', task });
  let state: unknown = {
    person: { id: 1 }, tasks: [], asks: [], events: [],
    bots: [bot('scout', { state: 'working', title: 'Private tax return' }), { ...bot('other', null), live: 'working' }],
  };
  let code = 200;
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/state');
    assert.equal(req.headers['x-crewhouse-member'], undefined);
    res.writeHead(code, { 'content-type': 'application/json', location: 'http://127.0.0.1:1/' });
    res.end(JSON.stringify(state));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = String((server.address() as AddressInfo).port);
  const run = async (value = port) => {
    const { stdout, stderr } = await exec(process.execPath, ['packaging/bar-pill.mjs'], {
      env: { ...process.env, CREWHOUSE_PORT: value }, timeout: 5000,
    });
    assert.equal(stderr, '');
    assert.equal(stdout.trim().split('\n').length, 1);
    return JSON.parse(stdout);
  };
  assert.deepEqual(await run(), { text: '1 working', tooltip: '1 working', class: 'working' });
  state = { person: { id: 1 }, tasks: [], asks: [{ id: 1, bot: 'scout', kind: 'question', detail: { words: 'Private question' } }], events: [], bots: [bot('scout', null)] };
  assert.deepEqual(await run(), { text: '1 needs you', tooltip: '1 needs you', class: 'ask' });
  state = { person: { id: 1 }, tasks: [], asks: [], events: [], bots: [{ ...bot('other', null), live: 'working' }] };
  assert.deepEqual(await run(), empty, 'another member working does not count');
  state = { person: { id: 2 } };
  assert.deepEqual(await run(), empty, 'non-owner snapshots are refused');
  state = {};
  assert.deepEqual(await run(), empty, 'malformed snapshots clear the bar');
  for (const failure of [503, 302]) { code = failure; assert.deepEqual(await run(), empty); }
  assert.deepEqual(await run('7711/other'), empty, 'the port cannot redirect the request');
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  assert.deepEqual(await run(), empty, 'offline clears the bar');
});
