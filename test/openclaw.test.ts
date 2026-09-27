import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GatewayClient } from '@openclaw/gateway-client';
import { OpenClawGateway, isolatedEnv } from '../src/openclaw/gateway.ts';
import { runSandboxed, sandboxReady } from '../src/engine.ts';

test('pinned engine uses isolated home, loopback token and no Control UI', { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-gateway-'));
  const owner = join(root, 'owner');
  mkdirSync(owner);
  for (const name of ['.pi', '.openclaw', '.clawdbot', '.codex']) {
    mkdirSync(join(owner, name));
    writeFileSync(join(owner, name, 'decoy'), 'unchanged');
  }
  const original = process.env.HOME;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.HOME = owner;
  process.env.OPENAI_API_KEY = 'decoy-secret';
  const gateway = new OpenClawGateway(join(root, 'state'));
  try {
    const env = isolatedEnv(gateway.stateDir, 'test');
    assert.equal(env.HOME, join(gateway.root, 'home'));
    assert.equal(env.OPENAI_API_KEY, undefined);
    const client = await gateway.start();
    assert.equal((await client.request<{ ok: boolean }>('health')).ok, true);
    const port = Number(readFileSync(join(gateway.root, 'port'), 'utf8'));
    assert.notEqual(port, 18789);
    const pid = Number(readFileSync(join(gateway.root, 'gateway.pid'), 'utf8'));
    const childEnv = readFileSync(`/proc/${pid}/environ`, 'utf8');
    assert.doesNotMatch(childEnv, /decoy-secret|\.pi|\.clawdbot/);
    assert.match(childEnv, /OPENCLAW_SKIP_CHANNELS=1/);
    assert.match(childEnv, /OPENCLAW_STATE_DIR=/);
    const sockets = new Set(readdirSync(`/proc/${pid}/fd`).flatMap((fd) => {
      try { return [readlinkSync(`/proc/${pid}/fd/${fd}`)].filter((link) => link.startsWith('socket:[')); }
      catch { return []; }
    }));
    const listeners = readFileSync('/proc/net/tcp', 'utf8').trim().split('\n').slice(1)
      .map((row) => row.trim().split(/\s+/)).filter((cols) => cols[3] === '0A' && sockets.has(`socket:[${cols[9]}]`));
    assert.ok(listeners.some((cols) => cols[1] === `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`));
    assert.ok(listeners.every((cols) => cols[1].startsWith('0100007F:')), 'Engine listeners must bind loopback');
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.notEqual(response.status, 200);
    const unauthenticated = new GatewayClient({ url: `ws://127.0.0.1:${port}`, clientName: 'cli',
      onHelloOk: () => assert.fail('A bot without the token authenticated') });
    unauthenticated.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await assert.rejects(unauthenticated.request('agents.list', {}, { timeoutMs: 500 }), /not connected|timeout|closed/i);
    unauthenticated.stop();
    if (sandboxReady()) {
      const bot = join(root, 'bot');
      mkdirSync(bot);
      const attack = await runSandboxed(bot, [], {},
        `test ! -e ${join(gateway.root, 'token')} && test ! -e ${join(gateway.root, 'crewd.sock')}`);
      assert.equal(attack.code, 0, 'bot shell can access the gateway credential or gate socket');
    }
    const snapshot = await client.request<{ path: string; hash: string }>('config.get');
    assert.ok(snapshot.path.startsWith(gateway.root));
    const workspace = join(gateway.root, 'workspaces/m1');
    await client.request('agents.create', { name: 'm1', workspace });
    // Empty isolated fixture only: prove the upstream weekly job can wake; production stays off until backup gates it.
    const updated = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: updated.hash,
      raw: JSON.stringify({ skills: { workshop: { autonomous: { mode: 'auto' } } } }) });
    const jobs = await client.request<{ jobs: { id: string; name: string; enabled: boolean; nextRunAtMs: number }[] }>('cron.list', { limit: 100 });
    const review = jobs.jobs.find((job) => job.name === 'skill-collection-review-m1');
    assert.ok(review?.enabled && review.nextRunAtMs > Date.now());
    const kicked = await client.request<{ runId: string }>('cron.run', { id: review.id, mode: 'force' });
    let finished = false;
    for (const until = Date.now() + 10_000; Date.now() < until && !finished;) {
      const runs = await client.request<{ entries: { runId: string; action: string; status: string }[] }>('cron.runs', { id: review.id });
      finished = runs.entries.some((entry) => entry.runId === kicked.runId && entry.action === 'finished' && entry.status === 'ok');
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(finished, 'system-owned review did not complete in empty fixture');
    assert.deepEqual(readdirSync(owner).sort(), ['.clawdbot', '.codex', '.openclaw', '.pi']);
    for (const name of readdirSync(owner)) assert.equal(readFileSync(join(owner, name, 'decoy'), 'utf8'), 'unchanged');
  } finally {
    await gateway.stop();
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    rmSync(root, { recursive: true, force: true });
  }
});
