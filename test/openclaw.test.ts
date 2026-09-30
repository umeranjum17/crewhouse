import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawKit } from '@byokit/openclaw';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
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
  const runtime = new OpenClawRuntime(join(root, 'state'));
  const { kit } = runtime;
  const engine = join(root, 'state', 'openclaw');
  try {
    await kit.prepare();
    const configPath = join(engine, 'openclaw.json');
    const oldConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    oldConfig.memory = { search: { provider: 'auto', fallback: 'openai' } };
    oldConfig.agents.entries = { m9: { memory: { search: { provider: 'openai' } } } };
    writeFileSync(configPath, JSON.stringify(oldConfig));
    await kit.prepare();
    const safeConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(safeConfig.memory.search.provider, 'none');
    assert.equal(safeConfig.memory.search.fallback, 'none');
    assert.equal(safeConfig.agents.entries.m9.memory.search.provider, 'none');
    assert.equal(kit.memoryLimited('m9'), true);
    const { env } = kit.doctorContext();
    assert.equal(env.HOME, join(engine, 'home'));
    assert.equal(env.OPENAI_API_KEY, undefined);
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no runs here' }), call: async () => 'no calls here' });
    const health = await kit.call('health', {}) as { ok: boolean; plugins: { loaded: string[] } };
    assert.equal(health.ok, true);
    assert.ok(health.plugins.loaded.includes('crewhouse'), 'fail-closed hook did not load');
    const port = Number(readFileSync(join(engine, 'port'), 'utf8'));
    assert.notEqual(port, 18789);
    const pid = Number(readFileSync(join(engine, 'gateway.pid'), 'utf8'));
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
    // A client holding everything but the token — the same port and device identity — never gets in.
    const thief = join(root, 'thief');
    mkdirSync(join(thief, 'openclaw'), { recursive: true });
    for (const file of ['port', 'device.json']) cpSync(join(engine, file), join(thief, 'openclaw', file));
    writeFileSync(join(thief, 'openclaw', 'token'), 'not-the-token');
    const outsider = new OpenClawKit({ stateDir: thief, spawnEngine: false });
    await assert.rejects(outsider.start(), 'a client without the token authenticated');
    await outsider.stop();
    if (sandboxReady()) {
      const bot = join(root, 'bot');
      mkdirSync(bot);
      const attack = await runSandboxed(bot, [], {},
        `test ! -e ${join(engine, 'token')} && test ! -e ${join(engine, 'bridge.sock')}`);
      assert.equal(attack.code, 0, 'bot shell can access the gateway credential or gate socket');
    }
    const snapshot = await kit.call('config.get', {}) as { path: string };
    assert.ok(snapshot.path.startsWith(engine));
    await kit.ensureMember('m1');
    // Empty isolated fixture only: prove the upstream weekly job can wake; production stays off until backup gates it.
    await runtime.setLearning(true);
    const jobs = await kit.call('cron.list', { limit: 100 }) as { jobs: { id: string; name: string; enabled: boolean; nextRunAtMs: number }[] };
    const review = jobs.jobs.find((job) => job.name === 'skill-collection-review-m1');
    assert.ok(review?.enabled && review.nextRunAtMs > Date.now());
    const kicked = await kit.call('cron.run', { id: review.id, mode: 'force' } as { id: string }) as { runId: string };
    let finished = false;
    for (const until = Date.now() + 10_000; Date.now() < until && !finished;) {
      const runs = await kit.call('cron.runs', { id: review.id }) as { entries: { runId: string; action: string; status: string }[] };
      finished = runs.entries.some((entry) => entry.runId === kicked.runId && entry.action === 'finished' && entry.status === 'ok');
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(finished, 'system-owned review did not complete in empty fixture');
    // A9: the reviewed bundled list is the one the agent sees; a bundled skill outside it is blocked by allowlist.
    const skills = await kit.call('skills.status', { agentId: 'm1' }, { timeoutMs: 30000 }) as { skills?: Record<string, unknown>[] };
    const byName = Object.fromEntries((skills.skills ?? []).map((s) => [s.name, s]));
    assert.equal(byName.weather?.blockedByAllowlist, true, 'a bundled skill outside the reviewed list is blocked');
    for (const allowed of ['video-frames', 'summarize', 'diagram-maker'])
      assert.equal(byName[allowed]?.blockedByAllowlist, false, `${allowed} stays eligible`);
    assert.deepEqual(readdirSync(owner).sort(), ['.clawdbot', '.codex', '.openclaw', '.pi']);
    for (const name of readdirSync(owner)) assert.equal(readFileSync(join(owner, name, 'decoy'), 'utf8'), 'unchanged');
  } finally {
    await runtime.stop();
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});
