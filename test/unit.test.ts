// Unit checks for the deterministic half: store, queue, approvals, tool grants, memory. No CLI, no quota.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CREWHOUSE_HOLD_MS = '300';
const { Store } = await import('../src/db.ts');
const { Crew, browserAsk } = await import('../src/crew.ts');
const kit = await import('../src/tools.ts');
const { StubRunner } = await import('../src/runner.ts');
const disk = await import('../src/bots.ts');
const { loadConfig } = await import('../src/config.ts');

function setup(maxConcurrent = 3) {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-unit-'));
  const cfg = { ...loadConfig(), stateDir: join(root, 'state'), crewDir: join(root, 'crew'), toolsDir: join(root, 'tools'), maxConcurrent, runner: 'stub' as const };
  const db = new Store(cfg.stateDir);
  const runner = new StubRunner();
  const crew = new Crew(cfg, db, runner, 'http://127.0.0.1:1');
  runner.onTurn = (bot, reply) => crew.finish(bot, reply);
  crew.init();
  let closed = false;
  const done = () => { if (!closed) { closed = true; crew.stop(); db.close(); } };
  after(done); // a failed assertion must not leave the watch loop running
  return { root, cfg, db, runner, crew, done };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const task = (db: any, id: number) => db.get('SELECT * FROM tasks WHERE id = ?', id);

test('store: a failed transaction leaves nothing behind; events fan out after commit', async () => {
  const { db, done } = setup();
  const seen: string[] = [];
  db.onEvent((e) => seen.push(e.kind));
  assert.throws(() => db.tx(() => { db.event('x.one', null); throw new Error('boom'); }));
  assert.equal(db.all("SELECT * FROM events WHERE kind = 'x.one'").length, 0);
  const e = db.event('x.two', null, { a: 1 });
  await sleep(0);
  assert.ok(seen.includes('x.two'));
  assert.deepEqual(db.events(e.seq - 1).map((x) => x.data), [{ a: 1 }]);
  done();
});

test('queue: one task at a time per bot, and a global cap across bots', async () => {
  const { db, crew, runner, done } = setup(1);
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  crew.recruit('scout', 'Scout', 'person');
  const a = crew.assign('reel', 'ask permission first', 'chief').task; // the stub keeps this one working
  const b = crew.assign('reel', 'second job', 'chief').task;
  const c = crew.assign('scout', 'look something up', 'chief').task;
  await sleep(100);
  assert.equal(task(db, a).state, 'working');
  assert.equal(task(db, b).state, 'queued', 'same bot waits its turn');
  assert.equal(task(db, c).state, 'queued', 'global cap of 1 holds the other bot');
  runner.complete('reel', 'done with the first');
  await sleep(300);
  assert.equal(task(db, a).state, 'done');
  assert.equal(task(db, b).state, 'done', 'next task for the bot ran');
  assert.equal(task(db, c).state, 'done', 'then the other bot');
  done();
});

test('approvals: held answer allows; no answer denies with "wait" and parks the task', async () => {
  const { db, crew, runner, done } = setup();
  crew.onboard("ma'am");
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'ask permission to write', 'chief').task;
  await sleep(100);
  const held = crew.permission('reel', { tool_name: 'Write', tool_input: { file_path: '/elsewhere/x.txt' } });
  await sleep(20);
  const ask = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  assert.equal(task(db, t).state, 'needs_you');
  await crew.answer(ask.id, { answer: 'allow' });
  assert.deepEqual(await held, { behavior: 'allow' });
  assert.equal(task(db, t).state, 'working');

  const late = await crew.permission('reel', { tool_name: 'Bash', tool_input: { command: 'rm -r /tmp/x' } });
  assert.equal(late.behavior, 'deny');
  assert.match(late.message!, /hasn't answered/);
  runner.complete('reel', 'Waiting on you.');
  assert.equal(task(db, t).state, 'needs_you', 'parked, not done');
  await assert.rejects(crew.answer(9999, { answer: 'allow' }), /already settled/);
  const parked = db.get("SELECT * FROM asks WHERE state = 'open'")!;
  await assert.rejects(crew.answer(parked.id, { answer: 'maybe' }), /allow or deny/);
  await crew.answer(parked.id, { answer: 'deny' });
  await sleep(200);
  assert.equal(task(db, t).state, 'done', 'the answer resumed the same session and it finished');
  done();
});

test('tool grants: only granted, installed tools reach the CLI; credentials always denied', () => {
  const { root, cfg, crew, done } = setup();
  const bot = crew.recruit('reel', 'Reel', 'person');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const b of ['ffmpeg', 'ffprobe', 'node']) { writeFileSync(join(bin, b), '#!/bin/sh\n'); chmodSync(join(bin, b), 0o755); }
  const path = process.env.PATH;
  process.env.PATH = bin; // ffmpeg present, gh and magick absent
  try {
    assert.throws(() => disk.setGrants(cfg, 'reel', ['files', 'teleport']), /unknown tools: teleport/);
    disk.setGrants(cfg, 'reel', ['files', 'media', 'github', 'images', 'computer']);
    const tools = disk.botTools(cfg, 'reel');
    assert.equal(tools.find((t) => t.id === 'media')!.ready, true);
    assert.deepEqual(tools.find((t) => t.id === 'github')!.missing, ['gh']);
    disk.launchSpec(cfg, bot as any, 'http://127.0.0.1:1');
    const s = JSON.parse(readFileSync(join(disk.botDir(cfg, 'reel'), '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(s.permissions.allow.includes('Bash(ffmpeg *)'));
    assert.ok(s.permissions.allow.includes('Bash(crew *)'), 'crew is always granted');
    assert.ok(!s.permissions.allow.some((a: string) => a.startsWith('Bash(gh ')), 'missing tool not offered');
    assert.ok(!s.permissions.allow.includes('Bash(magick *)'));
    assert.ok(s.permissions.deny.includes('Read(~/.ssh/**)'));
    assert.ok(s.permissions.deny.includes('CronCreate'), 'crewd owns schedules');
  } finally {
    process.env.PATH = path;
    done();
  }
});

test('Tracer: people search is free to price, every paid call asks first with its cap, the treg token is denied', () => {
  const { root, cfg, crew, done } = setup();
  const tool = kit.registry(cfg).find((t) => t.id === 'people-search')!;
  assert.deepEqual(tool.bins, ['treg']);
  assert.equal(tool.source, 'system');
  assert.match(tool.install.system!, /treg login/, 'setup names the sign-in step');
  assert.ok(!tool.allow.some((a) => a.startsWith('Bash(treg call')), 'spending is never pre-allowed');
  assert.deepEqual(tool.ask, ['Bash(treg call *)']);
  assert.ok(disk.listTemplates(cfg).some((t) => t.id === 'tracer' && t.tools.includes('people-search')));

  const bot = crew.recruit('tracer', 'Tracer', 'person');
  const dir = disk.botDir(cfg, 'tracer');
  const skill = readFileSync(join(dir, 'skills', 'find-leads', 'SKILL.md'), 'utf8');
  assert.match(skill, /treg call \S+ --header 'X-Treg-Route-Max-Cost: [\d.]+'/, 'the example call carries its price cap');
  assert.deepEqual(disk.listSkills(cfg, 'tracer').map((s) => s.name), ['find-leads']);
  // No key or token ships with the template.
  for (const f of ['AGENTS.md', 'bot.json', 'skills/find-leads/SKILL.md']) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /(sk|tk|tr)_[A-Za-z0-9]{16,}|X-Treg-Token:/);

  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const b of ['treg', 'node']) { writeFileSync(join(bin, b), '#!/bin/sh\n'); chmodSync(join(bin, b), 0o755); }
  const path = process.env.PATH;
  process.env.PATH = bin;
  try {
    disk.launchSpec(cfg, bot as any, 'http://127.0.0.1:1');
    const s = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(s.permissions.allow.includes('Bash(treg catalog *)'));
    assert.deepEqual(s.permissions.ask, ['Bash(treg call *)']);
    assert.ok(s.permissions.deny.includes('Read(~/.treg/**)'));
  } finally {
    process.env.PATH = path;
    done();
  }
});

const fakeBin = (dir: string, ...names: string[]) => {
  mkdirSync(dir, { recursive: true });
  for (const b of names) { writeFileSync(join(dir, b), '#!/bin/sh\necho fake\n'); chmodSync(join(dir, b), 0o755); }
};

test('grant resolution: MCP browser, pinned bin dir, asks-first gate, per-CLI wiring', () => {
  const { root, cfg, crew, done } = setup();
  const bot = crew.recruit('scout', 'Scout', 'person');
  fakeBin(join(root, 'bin'), 'node', 'rg', 'jq');
  fakeBin(kit.toolBin(cfg), 'playwright-mcp', 'markitdown'); // as a pinned install leaves them
  const path = process.env.PATH;
  process.env.PATH = join(root, 'bin');
  try {
    const dir = disk.botDir(cfg, 'scout');
    const g = kit.resolveGrants(cfg, disk.botConfig(cfg, 'scout').tools, { 'bot.dir': dir, 'bot.id': 'scout' });
    assert.deepEqual(g.tools.sort(), ['browser', 'crew', 'documents', 'files', 'search-files', 'web']);
    assert.deepEqual(g.missing, ['video-download'], 'granted but not installed: listed, not offered');
    assert.equal(g.mcp.browser.command, join(kit.toolBin(cfg), 'playwright-mcp'), 'pinned copy, absolute');
    assert.ok(g.mcp.browser.args.includes(`${dir}/browser`), "the bot's own profile");
    assert.equal(g.mcp.browser.env.PLAYWRIGHT_BROWSERS_PATH, join(cfg.toolsDir, 'browser', 'ms-playwright'));

    const spec = disk.launchSpec(cfg, bot as any, 'http://127.0.0.1:1');
    assert.ok(spec.env.PATH.split(':').includes(kit.toolBin(cfg)));
    const mcp = JSON.parse(readFileSync(join(dir, '.crewhouse', 'mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(mcp.mcpServers), ['browser']);
    assert.ok(spec.args.includes('--strict-mcp-config'), "the person's own MCP servers stay out");
    const s = JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(s.permissions.allow.includes('mcp__browser'));
    assert.ok(s.permissions.allow.includes('Bash(markitdown *)'));
    assert.ok(s.permissions.allow.includes('Edit(./**)') && !s.permissions.allow.includes('Write'), 'edits are confined to the bot folder');
    assert.equal(s.hooks.PreToolUse[0].matcher, 'mcp__browser__.*');

    // Revoke the browser: gone from the allow list and the MCP config.
    disk.setGrants(cfg, 'scout', ['files', 'web']);
    disk.launchSpec(cfg, bot as any, 'http://127.0.0.1:1');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.crewhouse', 'mcp.json'), 'utf8')).mcpServers, {});

    disk.setGrants(cfg, 'scout', ['files', 'web', 'browser']);
    const codex = disk.launchSpec(cfg, { ...bot, runtime: 'codex' } as any, 'http://127.0.0.1:1');
    assert.ok(codex.args.includes('--search'));
    assert.ok(codex.args.some((a) => a.startsWith('mcp_servers.browser.command=')));

    // Recruit card: the template's tools with their rules in plain words.
    const card = disk.templateKit(cfg, disk.loadTemplate(cfg, 'scout'));
    assert.match(card.find((k) => k.id === 'browser')!.asks.join(), /payment page/);
    assert.ok(existsSync(join(dir, 'skills', 'use-the-browser', 'SKILL.md')), 'library skills copied in');
  } finally {
    process.env.PATH = path;
    done();
  }
});

test('browser asks first on signed-in sites and payment pages, only for actions', () => {
  assert.equal(browserAsk('browser_navigate', 'https://shop.example/checkout', []), null, 'looking is fine');
  assert.match(browserAsk('browser_click', 'https://shop.example/checkout', [])!, /payment/);
  assert.match(browserAsk('browser_type', 'https://mail.google.com/x', ['google.com'])!, /signed it in/);
  assert.equal(browserAsk('browser_click', 'https://news.ycombinator.com/', ['google.com']), null);
  assert.equal(browserAsk('browser_snapshot', 'https://pay.google.com/', []), null);
});

test('installs: pinned npm and checksummed download land in the tool folder; bad checksum keeps nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-kit-'));
  const payload = '#!/bin/sh\necho downloaded\n';
  const sha = createHash('sha256').update(payload).digest('hex');
  const srv = createServer((_q, r) => r.end(payload)).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/fake-dl`;
  const pkg = join(root, 'pkg');
  fakeBin(join(pkg, 'bin'), 'fake-npm');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'fake-npm', version: '1.0.0', bin: { 'fake-npm': 'bin/fake-npm' } }));
  const manifest = (id: string, install: object, bins: string[]) => {
    mkdirSync(join(root, 'repo', 'tools', id), { recursive: true });
    writeFileSync(join(root, 'repo', 'tools', id, 'tool.json'), JSON.stringify({ id, name: id, provides: '', kind: 'cli', bins, license: 'MIT', source: 'pinned', install, asks: [], allow: [] }));
  };
  manifest('npmtool', { npm: `file:${pkg}`, then: [['fake-npm']] }, ['fake-npm']);
  manifest('dltool', { download: { url, sha256: sha } }, ['fake-dl']);
  manifest('badtool', { download: { url, sha256: '0'.repeat(64) } }, ['fake-bad']);
  const cfg = { ...loadConfig(), repoDir: join(root, 'repo'), toolsDir: join(root, 'tools') };
  try {
    await kit.installTool(cfg, 'npmtool');
    await kit.installTool(cfg, 'dltool');
    await assert.rejects(kit.installTool(cfg, 'badtool'), /checksum mismatch/);
    assert.match(readlinkSync(join(kit.toolBin(cfg), 'fake-npm')), /npmtool\/node_modules\/\.bin\/fake-npm$/);
    assert.equal(readFileSync(join(kit.toolBin(cfg), 'fake-dl'), 'utf8'), payload);
    assert.ok(!existsSync(join(kit.toolBin(cfg), 'fake-bad')));
    const st = () => new Map(kit.toolStatus(cfg).map((t) => [t.id, t]));
    assert.equal(st().get('dltool')!.ready, true);
    assert.equal(st().get('badtool')!.ready, false);
    const logs: string[] = [];
    await kit.installTool(cfg, 'dltool', (l) => logs.push(l));
    assert.match(logs.join(), /already installed/);
    manifest('dltool', { download: { url: url + '?v=2', sha256: sha } }, ['fake-dl']); // Crewhouse moved the pin
    assert.equal(st().get('dltool')!.outdated, true);
    await assert.rejects(kit.installTool(cfg, 'nope'), /unknown tool/);
  } finally {
    srv.close();
  }
});

test('bots on disk: persona rename, capped notes, folder confinement, slugs', () => {
  const { cfg, crew, done } = setup();
  crew.recruit('reel', 'Frames', 'person');
  const dir = disk.botDir(cfg, 'frames');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /^# Frames/);
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /You are Frames/);
  assert.throws(() => crew.recruit('reel', 'Frames', 'person'), /already a bot/);
  assert.throws(() => crew.recruit('chief', 'Deputy', 'person'), /only one Chief/);
  disk.remember(cfg, 'frames', 'Likes slow transitions');
  assert.throws(() => disk.remember(cfg, 'frames', 'x'.repeat(disk.NOTES_CAP)), /notes are full/);
  assert.equal(disk.readNotes(cfg, 'frames'), '- Likes slow transitions\n');
  assert.throws(() => disk.insideBot(cfg, 'frames', '../chief/notes.md'), /outside/);
  assert.equal(disk.slug('Ma Reel 2!'), 'ma-reel-2');
  assert.match(disk.addressLine('Umer'), /chosen name, "Umer", never as "sir"/);
  assert.equal(disk.addressLine("Ma'am"), 'Address the person as "ma\'am".');
  done();
});
