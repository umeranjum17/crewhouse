// The gateway-upgrade migration (spec §6), part 1: recognition and repair —
// the canonical auth route, the config fence on an existing gateway, a retired
// import repaired through doctor, and an old engine login sealed across restart.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';
import { faked } from './kit-fake.ts';
import { host, house, legacyAuth, retired, sealed } from './migrate-house.ts';

test('ChatGPT uses the canonical gateway auth provider for status, logout and migration confirmation', async () => {
  const { legacy, stop } = await house();
  const f = faked({}, { 'models.authStatus': () => ({ providers: [{ provider: 'openai' }] }) });
  try {
    await f.started;
    writeFileSync(legacy, legacyAuth());
    assert.equal(await f.runtime.signedIn('chatgpt'), true);
    await f.runtime.signOut('chatgpt');
    assert.deepEqual(f.fake.calls.find((c) => c.method === 'models.authLogout')?.params, { provider: 'openai', agentId: 'm1' });
    assert.equal(await f.runtime.confirm(legacy), true);
    retired(legacy);
  } finally { await f.done(); await stop(); }
});

test('existing gateway config gains the subscription runtime rule and Crewhouse\'s tool fence', async () => {
  const { stateDir, runtime, stop } = await house();
  try {
    await runtime.kit.prepare();
    const path = join(stateDir, 'openclaw/openclaw.json');
    const config = JSON.parse(readFileSync(path, 'utf8'));
    config.agents.defaults.modelPolicy = { allow: ['anthropic/*'] };
    writeFileSync(path, JSON.stringify(config));
    await runtime.kit.prepare();
    const updated = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(updated.agents.defaults.modelPolicy.allow, [], 'an explicit model map never narrows the family\'s providers');
    assert.equal(updated.agents.defaults.models['openai/*'].agentRuntime.id, 'openclaw');
    assert.deepEqual(updated.tools.exec, { security: 'deny', ask: 'always' });
    assert.equal(updated.plugins.entries.codex.enabled, false);
  } finally { await stop(); }
});

test('a previously retired legacy import repairs through doctor without touching other accounts or deny', { timeout: 240_000 }, async () => {
  const { stateDir, legacy, runtime, stop } = await house();
  const old = new OpenClawRuntime(stateDir, '', { authSeal: undefined });
  const other = { type: 'token', provider: 'anthropic', token: 'synthetic-other' };
  try {
    writeFileSync(legacy, legacyAuth({ anthropic: other }));
    await old.kit.prepare();
    const agentDir = join(stateDir, 'openclaw/state/agents/m1/agent');
    mkdirSync(agentDir, { recursive: true });
    copyFileSync(legacy, join(agentDir, 'auth.json')); // the old shipped migration, before the repair
    const { entry, env } = old.kit.doctorContext();
    assert.equal(spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'],
      { env, cwd: env.HOME, timeout: 120_000, stdio: 'pipe' }).status, 0);
    renameSync(legacy, `${legacy}.moved-to-engine`);
    await old.start(host);
    assert.equal(await old.signedIn('chatgpt'), false, 'legacy recognition is not canonical route access');
    const denied = await old.run({ key: 'agent:m1:crewhouse:chief:before', bot: 'chief', task: 1,
      account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
    assert.ok(!denied.ok && 'message' in denied);
    assert.match(denied.message, /No route-compatible authentication source/);
    await old.stop();
    assert.equal(await runtime.migrate(legacy), true, 'the retained original is repaired offline');
    sealed(stateDir);
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), true);
    assert.equal(await runtime.confirm(legacy), true);
    assert.equal(await runtime.migrate(legacy), false, 'confirmed repairs are not repeated on restart');
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    const profiles = JSON.parse((db.prepare('SELECT store_json FROM auth_profile_store').get() as { store_json: string }).store_json).profiles;
    db.close();
    assert.equal(profiles['openai:default'].provider, 'openai');
    assert.equal(profiles['openai:default'].access, 'a-preserved');
    assert.deepEqual(profiles['anthropic:default'], other);
    const cfg = ((await runtime.kit.call('config.get', {})) as any).config;
    assert.deepEqual(cfg.tools.exec, { security: 'deny', ask: 'always' });
    assert.equal(cfg.plugins.entries.codex.enabled, false);
    retired(legacy);
    await runtime.stop();
    sealed(stateDir);
  } finally { if (!existsSync(join(stateDir, 'openclaw/auth-store.sealed'))) await old.stop(); await stop(); }
});

test('an existing engine login and migration archives seal on prepare, restore and survive restart', { timeout: 240_000 }, async () => {
  const { stateDir, legacy, runtime, stop } = await house();
  const old = new OpenClawRuntime(stateDir, '', { authSeal: undefined }); // the pre-sealing engine store
  const stub = await startModelStub();
  try {
    writeFileSync(legacy, legacyAuth());
    await old.migrate(legacy);
    await old.start(host);
    assert.equal(await old.signedIn('chatgpt'), true);
    await old.configureModelProvider(stub.url, 'stub-m1');
    await old.stop();
    const engine = join(stateDir, 'openclaw');
    const agent = join(engine, 'state/agents/m1/agent');
    assert.ok(existsSync(join(agent, 'openclaw-agent.sqlite')), 'the old engine login is plaintext SQLite');
    const archives = [join(agent, 'auth.json.migrated-old'), join(agent, 'auth-profiles.json.sqlite-import.old.bak'),
      join(stateDir, 'retained/auth.json.moved-to-engine')];
    for (const path of archives) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, legacyAuth()); }
    await runtime.kit.prepare();
    sealed(stateDir);
    assert.ok(!existsSync(archives[2]), 'the old retained archive is sealed');
    assert.ok(existsSync(archives[2] + '.sealed'));
    await runtime.start(host);
    for (const path of archives) assert.ok(!existsSync(path), 'migration archives never return as plaintext input');
    assert.equal(statSync(join(agent, 'openclaw-agent.sqlite')).mode & 0o777, 0o600);
    assert.equal(await runtime.signedIn('chatgpt'), true, 'the old engine sign-in is usable');
    const end = await runtime.run({ key: 'agent:m1:crewhouse:chief:engine-upgrade', bot: 'chief', task: 1,
      account: 'chatgpt', cwd: '', system: 'Be brief.', message: 'Hello', builtins: [] }, () => {});
    assert.ok(end.ok && end.text.includes('Hello'), JSON.stringify(end));
    assert.ok(stub.calls.length > 0);
    await runtime.stop();
    sealed(stateDir);
    const snapshot = join(engine, 'auth-store.sealed');
    const good = readFileSync(snapshot), tampered = Buffer.from(good);
    tampered[tampered.length - 1] ^= 1;
    writeFileSync(snapshot, tampered);
    await runtime.start(host);
    assert.equal(runtime.kit.state.phase, 'ready');
    assert.equal(runtime.kit.state.why, 'sign-in-reset', 'tampering reports the reset rather than restoring credentials');
    assert.equal(await runtime.signedIn('chatgpt'), false, 'the old engine login never returns from bad bytes');
    const unreadable = readdirSync(engine).filter((name) => /^auth-store\.sealed\.unreadable-\d+$/.test(name));
    assert.equal(unreadable.length, 1, 'the unreadable snapshot is kept aside once');
    assert.deepEqual(readFileSync(join(engine, unreadable[0])), tampered, 'the bad bytes are preserved exactly');
    await runtime.stop();
    assert.deepEqual(readFileSync(join(engine, unreadable[0])), tampered, 'stopping never overwrites the kept bytes');
    writeFileSync(snapshot, good);
    await runtime.start(host);
    assert.equal(await runtime.signedIn('chatgpt'), true, 'repairing the sealed snapshot preserves the login');
  } finally { if (!existsSync(join(stateDir, 'openclaw/auth-store.sealed'))) await old.stop(); await stop(); await stub.close(); }
});
