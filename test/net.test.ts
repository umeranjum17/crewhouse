// A fenced helper reaches only the hosts its template lists: its shell has no network but crewd's proxy, and every
// refusal is an event. Local servers stand in for the internet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup, settled, task } from './lab.ts';
import { proxy } from '../src/net.ts';
import * as disk from '../src/bots.ts';
import { toolBin } from '../src/tools.ts';
import { runSandboxed, sandboxReady } from '../src/engine.ts';

const serve = () => new Promise<number>((r) => { const s = createServer((_q, res) => res.end('hello')).listen(0, '127.0.0.1', () => r((s.address() as any).port)); s.unref(); });

test('the fenced shell reaches a listed host through the proxy; any other is refused and recorded, and going around it finds no network',
  { skip: !sandboxReady() && 'bubblewrap is not usable here' }, async () => {
    const [ok, other] = [await serve(), await serve()];
    const dir = mkdtempSync(join(tmpdir(), 'crewhouse-net-')), sock = join(dir, 'net.sock');
    const refused: string[] = [];
    const p = proxy(sock, [`127.0.0.1:${ok}`], (h, port) => refused.push(`${h}:${port}`));
    const curl = (port: number, extra = '') => runSandboxed(dir, [], {}, `curl -sS -p ${extra} http://127.0.0.1:${port}/`, sock, 30_000);
    try {
      assert.deepEqual(await curl(ok), { code: 0, tail: 'hello' });
      const no = await curl(other);
      assert.notEqual(no.code, 0);
      assert.match(no.tail, /403/);
      assert.deepEqual(refused, [`127.0.0.1:${other}`]);
      assert.notEqual((await curl(ok, '--noproxy "*"')).code, 0, 'no way out but the proxy');
    } finally { p.close(); }
  });

test('a fenced helper: web reads off its list and tools that go elsewhere are refused and recorded', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('support', 'Desk', 'person');
  // Granted, and its program here (a stand-in that must never run): still refused, since it reaches out on its own.
  mkdirSync(toolBin(cfg), { recursive: true });
  writeFileSync(join(toolBin(cfg), 'gh'), '#!/bin/sh\necho ran\n', { mode: 0o755 });
  const conf = disk.botConfig(cfg, 'desk');
  writeFileSync(join(disk.botDir(cfg, 'desk'), 'bot.json'), JSON.stringify({ ...conf, tools: [...conf.tools, 'github'] }));
  const call = (name: string, args: object) => `[tool ${name} ${JSON.stringify(args)}]`;
  const t = (await crew.post('desk', `look ${call('web_fetch', { url: 'https://example.com/x' })} ${call('web_search', { query: 'muxr' })} ${call('github', { args: ['issue', 'list'] })}`))!.task;
  await settled(db, t);
  const seen = db.all("SELECT data FROM events WHERE kind = 'net.refused' ORDER BY seq").map((e: any) => JSON.parse(e.data));
  assert.deepEqual(seen.map((e: any) => e.to), ['example.com', 'html.duckduckgo.com', 'github']);
  assert.ok(seen.every((e: any) => e.task === t));
  assert.equal(task(db, t).state, 'done');
  assert.ok(!db.all("SELECT text FROM messages WHERE bot = 'desk'").some((m: any) => /\bran\b/.test(m.text)), 'the program never ran');
  done();
});
