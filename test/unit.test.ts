// Unit checks for the deterministic half: store, queue, approvals, tool grants, memory. No CLI, no quota.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CREWHOUSE_HOLD_MS = '300';
process.env.CREWHOUSE_STUCK_MS = '5000';
process.env.CREWHOUSE_FALLBACK_MS = '1000';
const { Store } = await import('../src/db.ts');
const { Crew, browserAsk, quietNow } = await import('../src/crew.ts');
const accounts = await import('../src/accounts.ts');
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
    assert.deepEqual(g.missing, ['computer', 'video-download'], 'granted but not installed: listed, not offered');
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
    assert.match(s.hooks.PreToolUse[0].hooks[0].command, /hook pretool$/, 'every tool call passes the gate: the controls, then the browser rules');

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

test('models: per-bot fallback order, per-task choice, and a switch starts the other CLI', async () => {
  const { cfg, db, crew, runner, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const starts: any[] = [];
  const start = runner.start.bind(runner);
  runner.start = async (s) => { starts.push(s); return start(s); };

  assert.deepEqual(crew.thinks('reel').map((b) => b.name), ['Claude Sonnet', 'ChatGPT'], 'template model, then ChatGPT');
  assert.throws(() => disk.setBrains(cfg, 'reel', ['gemini:pro']), /not a model choice/);
  assert.throws(() => disk.setBrains(cfg, 'reel', ['claude:$(rm -rf ~)']), /not a model choice/);
  assert.throws(() => disk.setBrains(cfg, 'reel', []), /at least one/);
  assert.deepEqual(disk.setBrains(cfg, 'reel', ['claude:opus', 'codex', 'claude:opus']), ['claude:opus', 'codex']);
  assert.deepEqual(crew.thinks('reel').map((b) => b.name), ['Claude Opus', 'ChatGPT']);
  assert.throws(() => crew.assign('reel', 'x', 'chief', 'pi'), /not a model choice/);

  const a = crew.assign('reel', 'rename 400 files', 'chief', 'codex:gpt-5-mini').task;
  await sleep(150);
  assert.equal(task(db, a).state, 'done');
  assert.equal(starts[0].kind, 'codex');
  assert.deepEqual(starts[0].args.slice(-2), ['--model', 'gpt-5-mini']);
  assert.match(runner['out'].get('reel')!, /Address the person as "sir"/, 'codex is told who it serves; it has no CLAUDE.md imports');

  const b = crew.assign('reel', 'judge which take is best', 'chief').task;
  await sleep(150);
  assert.equal(task(db, b).state, 'done');
  assert.equal(starts[1].kind, 'claude', 'no per-task choice: the bot default');
  assert.deepEqual(starts[1].args.slice(-2), ['--model', 'opus']);
  assert.equal(crew.bot('reel')!.runtime, 'claude');
  done();
});

test('fallback: resting accounts are skipped, all resting pauses until the reset, a limit mid-run switches', async () => {
  const { db, crew, runner, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const kinds: string[] = [];
  const start = runner.start.bind(runner);
  runner.start = async (s) => { kinds.push(s.kind); return start(s); };

  // Before a run: Claude's 5-hour window at 97% means Claude is resting until it resets.
  const reset = Math.floor(Date.now() / 1000) + 3600;
  crew.hookStatus('scout', { rate_limits: { five_hour: { used_percentage: 97, resets_at: reset } } });
  assert.equal(crew.restingUntil('claude'), reset * 1000);
  const a = crew.assign('scout', 'look it up', 'chief').task;
  await sleep(150);
  assert.equal(task(db, a).state, 'done');
  assert.deepEqual(kinds, ['codex']);

  // Everyone resting: the task pauses with a wake-up time, and resumes when it passes.
  crew['limits'].set('1:codex', { restUntil: Date.now() + 60_000 });
  const b = crew.assign('scout', 'look it up again', 'chief').task;
  await sleep(100);
  assert.equal(task(db, b).state, 'paused');
  assert.ok(Math.abs(task(db, b).wake_at - (Date.now() + 60_000)) < 1000, 'earliest reset: ChatGPT in a minute, not Claude in an hour');
  assert.match(task(db, b).result, /All AI accounts are resting until \d+:\d\d [ap]m/);
  crew['limits'].clear();
  db.run('UPDATE tasks SET wake_at = ? WHERE id = ?', Date.now() - 1, b);
  crew.dispatch();
  await sleep(150);
  assert.equal(task(db, b).state, 'done');
  assert.equal(kinds.at(-1), 'claude', 'limits cleared: back to the first choice');

  // During a run: Claude's StopFailure(rate_limit) rests Claude and continues on ChatGPT from a brief.
  crew.hookStatus('scout', { rate_limits: { five_hour: { used_percentage: 60, resets_at: reset } } });
  const c = crew.assign('scout', 'ask permission then dig deep', 'chief').task; // the stub holds it working
  await sleep(100);
  assert.equal(kinds.at(-1), 'claude');
  db.event('task.progress', 'scout', { text: 'found three sources' });
  crew.hookFailure('scout', { error: 'rate_limit', last_assistant_message: 'API Error: Rate limit reached' });
  await sleep(100);
  assert.equal(kinds.at(-1), 'codex');
  assert.equal(task(db, c).state, 'working');
  assert.equal(crew.restingUntil('claude'), reset * 1000, 'rests until the known reset');
  const brief = runner['out'].get('scout')!;
  assert.match(brief, /continuing it in a new session/);
  assert.match(brief, /found three sources/);
  assert.match(brief, /dig deep/);
  const said = db.all("SELECT text FROM messages WHERE bot = 'scout' AND author = 'system'").map((m) => m.text);
  assert.ok(said.some((t) => /^Switched from Claude to ChatGPT: Claude is resting until/.test(t)), said.join('\n'));
  runner.complete('scout', 'here is the report');
  await sleep(50);
  assert.equal(task(db, c).state, 'done');

  // Any other API error fails the task plainly instead of pretending it finished.
  const d = crew.assign('scout', 'ask permission again', 'chief').task;
  await sleep(100);
  crew.hookFailure('scout', { error: 'authentication_failed' });
  assert.equal(task(db, d).state, 'failed');
  done();
});

test('fallback: a Codex usage-limit screen rests ChatGPT until the time it prints, then Claude continues', async () => {
  const { cfg, db, crew, runner, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  disk.setBrains(cfg, 'scout', ['codex', 'claude:haiku']);
  const kinds: string[] = [];
  const start = runner.start.bind(runner);
  runner.start = async (s) => { kinds.push(s.kind); return start(s); };
  const { limitResetFromText } = await import('../src/crew.ts');
  const year = new Date().getFullYear() + 1;
  const reset = Date.parse(`Sep 26, ${year} 12:15 PM`);
  assert.equal(limitResetFromText(`■ You've hit your usage limit. Visit x or try again at\nSep 26th, ${year} 12:15 PM.`), reset);
  assert.equal(limitResetFromText('try again later'), 0);

  // The stub shows its prompt in the pane and blocks on "needs approval", like Codex's model-switch dialog.
  const t = crew.assign('scout', `needs approval ■ You've hit your usage limit. Visit x or try again at Sep 26th, ${year} 12:15 PM.`, 'chief').task;
  await sleep(2500); // one watch-loop tick
  assert.equal(crew.restingUntil('codex'), reset);
  assert.deepEqual(kinds, ['codex', 'claude']);
  assert.equal(task(db, t).state !== 'failed', true);
  assert.ok(db.all("SELECT text FROM messages WHERE bot = 'scout'").some((m) => /^Switched from ChatGPT to Claude: ChatGPT is resting until \w{3} 12:15 pm/.test(m.text)));
  done();
});

test('take over: the bot pauses while the person drives; give back resumes it with their note', async () => {
  const { db, crew, runner, cfg, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'ask permission to open the site', 'chief').task; // the stub keeps this one working
  await sleep(100);
  const settings = JSON.parse(readFileSync(join(cfg.crewDir, 'bots', 'reel', '.claude', 'settings.local.json'), 'utf8'));
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /hook pretool$/, 'the CLI asks crewd before every tool call');
  assert.deepEqual(await crew.preTool('reel', { tool_name: 'Bash' }), {}, 'the bot acts freely while it has the controls');

  await crew.takeOver('reel');
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'reel')?.controls, 'person');
  assert.equal(await runner.state('reel'), 'idle', 'the running turn is interrupted');
  const deny = await crew.preTool('reel', { tool_name: 'Bash' }) as any;
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /owner has the controls/);
  crew.finish('reel', 'I will wait for the owner.');
  assert.equal(task(db, t).state, 'working', 'a turn cut short by Take over does not end the task');
  const next = crew.assign('reel', 'second job', 'chief').task;
  await sleep(100);
  assert.equal(task(db, next).state, 'queued', 'no new work starts while the person drives');

  await crew.giveBack('reel', 'signed you in to example.com');
  assert.deepEqual(await crew.preTool('reel', { tool_name: 'Bash' }), {});
  assert.match(await runner.read('reel'), /given them back\. What they did: signed you in to example\.com\./, 'the resume prompt carries the note');
  await sleep(300);
  assert.equal(task(db, t).state, 'done', 'the resumed turn finishes the task');
  assert.equal(task(db, next).state, 'done', 'then the queue moves again');
  assert.ok(db.get("SELECT 1 FROM messages WHERE bot = 'reel' AND text = 'You gave the controls back: signed you in to example.com'"));
  await assert.rejects(crew.giveBack('reel'), /already has the controls/);
  done();
});

test('approval scopes: once, for this task, always for the bot; compound commands only ever get exact grants', async () => {
  assert.deepEqual(disk.permissionRule('Bash', { command: 'ffmpeg -y -i a.png out.mp4' }), { rule: 'Bash(ffmpeg *)', covers: 'any ffmpeg command' });
  assert.equal(disk.permissionRule('Bash', { command: 'ffmpeg -i a && rm -rf ~' }).rule, 'Bash(ffmpeg -i a && rm -rf ~)');
  assert.equal(disk.permissionRule('Bash', { command: 'X=1 rm y' }).covers, 'this exact command');
  assert.equal(disk.permissionRule('WebFetch', { url: 'https://example.com/a' }).rule, 'WebFetch(domain:example.com)');
  assert.ok(!disk.ruleAllows('Bash(ffmpeg *)', 'Bash', { command: 'ffmpeg a; rm -rf ~' }), 'a granted prefix never covers a compound command');

  const { db, cfg, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const t = crew.assign('reel', 'ask permission to render', 'chief').task;
  await sleep(100);
  const ask = async (command: string) => {
    const held = crew.permission('reel', { tool_name: 'Bash', tool_input: { command } });
    await sleep(20);
    return { held, open: db.get("SELECT * FROM asks WHERE state = 'open'") };
  };

  let a = await ask('ffmpeg -i one.png');
  assert.equal(a.open!.title, 'Reel would like to run a command');
  await assert.rejects(crew.answer(a.open!.id, { answer: 'allow', scope: 'forever' }), /once, for this task, or always/);
  await crew.answer(a.open!.id, { answer: 'allow', scope: 'task' });
  assert.equal((await a.held).behavior, 'allow');
  a = await ask('ffmpeg -i two.png');
  assert.equal(a.open, undefined, 'the same kind of call in the same task goes through without asking');
  assert.equal((await a.held).behavior, 'allow');
  assert.ok(db.get("SELECT 1 FROM events WHERE kind = 'run.allowed'"));

  a = await ask('magick a.png b.png');
  await crew.answer(a.open!.id, { answer: 'allow', scope: 'always' });
  assert.ok(disk.botConfig(cfg, 'reel').allow!.includes('Bash(magick *)'), 'always is written where the CLI reads its allow list');
  const trail = crew.botPage('reel').trail.map((e: any) => e.kind);
  assert.ok(trail.includes('bot.allowed') && trail.includes('ask.answered'));
  crew.stop();

  // A new task keeps "always" but not "for this task".
  db.run("UPDATE tasks SET state = 'done' WHERE id = ?", t);
  crew.assign('reel', 'ask permission again', 'chief');
  crew.dispatch();
  await sleep(100);
  a = await ask('magick c.png d.png');
  assert.equal(a.open, undefined);
  a = await ask('ffmpeg -i three.png');
  assert.ok(a.open, 'task grants end with their task');
  await crew.answer(a.open!.id, { answer: 'deny' });
  await a.held;

  // Spending always asks: no standing grant covers it, and the card offers no wider scope.
  disk.setGrants(cfg, 'reel', ['files', 'media', 'people-search']);
  disk.setSettings(cfg, 'reel', { allow: ['Bash', 'Bash(treg *)'] });
  a = await ask('cd work && treg call apollo.people -H "X-Treg-Route-Max-Cost: 0.05"');
  assert.ok(a.open, 'an allow rule never lets a paid call through');
  assert.equal(JSON.parse(a.open!.detail).spends, true);
  await assert.rejects(crew.answer(a.open!.id, { answer: 'allow', scope: 'always' }), /once, for this task, or always/);
  await crew.answer(a.open!.id, { answer: 'allow' });
  assert.equal((await a.held).behavior, 'allow');
  a = await ask('ls work');
  assert.equal(a.open, undefined, 'the bare Bash rule still covers everything else');
  done();
});

test('home facts: ideas only from ready tools, stuck after quiet, memory switch', async () => {
  const { cfg, crew, db, done } = setup();
  crew.onboard('sir');
  crew.recruit('scout', 'Scout', 'person');
  const path = process.env.PATH;
  process.env.PATH = '/nonexistent'; // markitdown absent: its promise is not made
  try {
    const ideas = crew.snapshot().ideas;
    assert.ok(ideas.some((i: any) => i.bot === 'scout' && /sources/.test(i.promise)), 'web is built in');
    assert.ok(!ideas.some((i: any) => /PDF/.test(i.promise)), 'no idea for a tool that is missing here');
  } finally { process.env.PATH = path; }
  disk.setGrants(cfg, 'scout', ['files']);
  assert.equal(crew.snapshot().ideas.length, 0, 'no idea for a tool that is not granted');

  crew.assign('scout', 'ask permission to look', 'chief');
  await sleep(100);
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'scout')?.stuck, false);
  db.run('UPDATE events SET at = at - 10000');
  assert.equal(crew.snapshot().bots.find((b: any) => b.id === 'scout')?.stuck, true, 'quiet past the limit reads as stuck');

  disk.setSettings(cfg, 'scout', { memory: false });
  assert.throws(() => disk.remember(cfg, 'scout', 'likes tea'), /memory is off/);
  disk.launchSpec(cfg, crew.bot('scout') as any, 'http://127.0.0.1:1');
  assert.doesNotMatch(readFileSync(join(disk.botDir(cfg, 'scout'), 'CLAUDE.md'), 'utf8'), /notes\.md/, 'memory off: notes are not loaded');
  assert.throws(() => disk.setSettings(cfg, 'scout', { memory: 'yes' }), /on or off/);
  done();
});

test('household: bots and tasks belong to a member and run on that member\'s own config home', async () => {
  const { cfg, db, crew, runner, done } = setup();
  const starts: any[] = [];
  const start = runner.start.bind(runner);
  runner.start = async (s) => { starts.push(s); return start(s); };
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  const sam = crew.addMember('Sam').id;
  assert.throws(() => crew.addMember('sam'), /already here/);

  // The owner stays on the CLIs' usual sign-in: a one-person house launches exactly as before.
  assert.equal(accounts.home(cfg, accounts.OWNER, 'claude'), null);
  assert.equal(accounts.home(cfg, sam, 'claude'), join(cfg.stateDir, 'people', String(sam), 'claude'));
  assert.deepEqual(accounts.homeEnv(cfg, sam, 'codex'), { CODEX_HOME: join(cfg.stateDir, 'people', String(sam), 'codex') });

  // Sam meets Chief in their own thread; the owner's conversation isn't in it.
  assert.match(crew.botPage('chief', sam).messages.map((m: any) => m.text).join('\n'), /how would you like me to address you/);
  assert.ok(!crew.botPage('chief', sam).messages.some((m: any) => m.text === 'sir'));
  crew.post('chief', 'Sam', undefined, sam);
  assert.equal(crew.member(sam).address, 'Sam');
  assert.equal(crew.member(accounts.OWNER).address, 'sir', 'each person keeps their own form of address');

  // The owner's task runs with no config-home override; Sam's on the same bot restarts it on Sam's homes.
  const a = crew.post('reel', 'owner demo', undefined, accounts.OWNER)!.task;
  await sleep(150);
  assert.equal(task(db, a).state, 'done');
  assert.equal(starts[0].env.CLAUDE_CONFIG_DIR, undefined);
  const b = crew.post('reel', 'a demo for Sam', undefined, sam)!.task;
  await sleep(150);
  assert.equal(task(db, b).member, sam);
  assert.equal(starts[1].env.CLAUDE_CONFIG_DIR, join(cfg.stateDir, 'people', String(sam), 'claude'));
  assert.match(readFileSync(join(cfg.crewDir, 'bots/reel/.crewhouse/person.md'), 'utf8'), /chosen name, "Sam"/);
  assert.match(runner['out'].get('reel')!, /task #\d+ from Sam\]/);
  assert.equal(crew.bot('reel')!.account, sam);
  assert.ok(crew.botPage('reel', sam).messages.some((m: any) => m.text === 'a demo for Sam'));
  assert.ok(!crew.botPage('reel', accounts.OWNER).messages.some((m: any) => m.text === 'a demo for Sam'), 'threads are per person');
  const settings = JSON.parse(readFileSync(join(cfg.crewDir, 'bots/reel/.claude/settings.local.json'), 'utf8'));
  assert.ok(settings.permissions.deny.includes(`Read(/${join(cfg.stateDir, 'people')}/**)`), 'no bot reads anyone\'s sign-in');

  // Chief works for whoever asked him: what he recruits and hands over is theirs, on their accounts.
  const c = crew.post('chief', 'ask permission to find me a researcher', undefined, sam)!.task; // the stub keeps Chief working
  await sleep(100);
  assert.equal(task(db, c).member, sam);
  assert.equal(crew.recruit('scout', 'Scout', 'chief').member, sam);
  const d = crew.assign('scout', 'look it up', 'chief').task;
  await sleep(150);
  assert.equal(task(db, d).member, sam);
  assert.equal(starts.at(-1).env.CLAUDE_CONFIG_DIR, join(cfg.stateDir, 'people', String(sam), 'claude'));
  runner.complete('chief', 'Scout is on it.');

  // One person's limit rests only their own account; the other's work carries on.
  crew['limits'].set(`${sam}:claude`, { restUntil: Date.now() + 60_000 });
  crew['limits'].set(`${sam}:codex`, { restUntil: Date.now() + 60_000 });
  assert.equal(crew.restingUntil('claude', accounts.OWNER), 0);
  const e = crew.post('reel', 'another for Sam', undefined, sam)!.task;
  const f = crew.post('scout', 'owner lookup', undefined, accounts.OWNER)!.task;
  await sleep(200);
  assert.equal(task(db, e).state, 'paused');
  assert.match(task(db, e).result, /All Sam's AI accounts are resting/);
  assert.equal(task(db, f).state, 'done');
  assert.equal(starts.at(-1).env.CLAUDE_CONFIG_DIR, undefined, 'the owner never borrows Sam\'s account, nor Sam the owner\'s');

  // What each person sees: their own tasks and questions, their own accounts.
  assert.deepEqual(crew.snapshot(sam).tasks.map((t: any) => t.id).sort(), [b, d, e].sort());
  assert.ok(crew.snapshot(sam).resting.claude > 0);
  assert.equal(crew.snapshot(accounts.OWNER).resting.claude, 0);
  done();
});

test('household: quiet hours park questions at once; settings validate', async () => {
  const { db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 23, 30)), true);
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 6, 59)), true);
  assert.equal(quietNow('22:00-07:00', new Date(2026, 0, 1, 7, 0)), false);
  assert.equal(quietNow('13:00-14:00', new Date(2026, 0, 1, 13, 15)), true);
  assert.equal(quietNow(null), false);
  assert.throws(() => crew.updateMember(1, { quiet: '10pm-7am' }), /22:00-07:00/);
  assert.throws(() => crew.updateMember(1, { name: '  ' }), /name/);
  assert.equal(crew.updateMember(1, { name: 'Alex', quiet: '00:00-23:59' }).name, 'Alex');

  const t = crew.post('reel', 'ask permission to copy', undefined, 1)!.task;
  await sleep(100);
  const started = Date.now();
  const d = await crew.permission('reel', { tool_name: 'Bash', tool_input: { command: 'cp a b' } });
  assert.ok(Date.now() - started < 200, 'no hold while they sleep');
  assert.equal(d.behavior, 'deny');
  assert.equal(task(db, t).state, 'needs_you');
  assert.equal(crew.snapshot(1).asks.length, 1, 'the question waits for the morning');
  assert.equal(crew.snapshot(crew.addMember('Sam').id).asks.length, 0, 'and only for them');
  crew.updateMember(1, { quiet: null });
  done();
});

/** Stop crewd and start a new one on the same database. The same runner means the Herdr panes outlived crewd; a new one, that they did not. */
async function restart(s: ReturnType<typeof setup>, runner = s.runner) {
  s.crew.stop();
  const crew = new Crew(s.cfg, s.db, runner, 'http://127.0.0.1:1');
  runner.onTurn = (bot, reply) => crew.finish(bot, reply);
  after(() => crew.stop());
  await crew.init();
  return crew;
}
const prompts = (db: any, t: number) => db.all("SELECT * FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", t).length;

test('restart: a live pane is re-attached, not prompted again, and its result lands once', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  const t = s.crew.assign('reel', 'ask permission first', 'chief').task; // stays working
  await sleep(100);
  const crew = await restart(s);
  assert.equal(task(s.db, t).state, 'working');
  assert.ok(s.db.get("SELECT 1 FROM events WHERE kind = 'run.reattached'"));
  await sleep(200);
  assert.equal(prompts(s.db, t), 1, 'the running turn is left alone');
  s.runner.complete('reel', 'All done.');
  crew.finish('reel', 'All done.'); // the Stop hook retried across the restart
  assert.equal(task(s.db, t).state, 'done');
  assert.equal(s.db.all("SELECT * FROM messages WHERE bot = 'reel' AND text = 'All done.'").length, 1);
  crew.stop();
  s.done();
});

test('restart: a turn that ended while crewd was down is read from the terminal, not redone', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  const t = s.crew.assign('reel', 'ask permission first', 'chief').task;
  await sleep(100);
  s.crew.stop();
  (s.runner as any).states.set('reel', 'done'); // the Stop hook found nobody listening
  const crew = await restart(s);
  for (let i = 0; i < 40 && task(s.db, t).state !== 'done'; i++) await sleep(100);
  assert.equal(task(s.db, t).state, 'done');
  assert.match(task(s.db, t).result, /read from the terminal/);
  assert.equal(prompts(s.db, t), 1);
  crew.stop();
  s.done();
});

test('restart: with its pane gone, the task continues in a new session from its trail; a parked approval stays answerable', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  const t = s.crew.assign('reel', 'ask permission to copy', 'chief').task;
  await sleep(100);
  s.db.event('task.progress', 'reel', { task: t, text: 'Recorded the first scene' });
  assert.equal((await s.crew.permission('reel', { tool_name: 'Bash', tool_input: { command: 'cp a b' } })).behavior, 'deny');
  s.runner.complete('reel', 'Waiting for permission to copy.');
  assert.equal(task(s.db, t).state, 'needs_you');
  const fresh = new StubRunner(); // a reboot: Herdr's panes are gone
  const crew = await restart(s, fresh);
  await sleep(200);
  assert.equal(task(s.db, t).state, 'working');
  const brief = await fresh.read('reel');
  assert.match(brief, /stopped \(Crewhouse restarted\)/);
  assert.match(brief, /Recorded the first scene/);
  assert.match(brief, /Still waiting on the person's answer[^]*cp a b/);
  const ask = s.db.get("SELECT * FROM asks WHERE state = 'open' AND kind = 'permission'")!;
  await crew.answer(ask.id, { answer: 'allow' });
  assert.match(await fresh.read('reel'), /has answered your request to use Bash \(cp a b\): allowed/);
  assert.equal((await crew.permission('reel', { tool_name: 'Bash', tool_input: { command: 'cp a b' } })).behavior, 'allow');
  await sleep(200);
  assert.equal(task(s.db, t).state, 'done', 'and the new session finished it');
  crew.stop();
  s.done();
});

test('restart: a held approval keeps its card; the reconnecting hook gets the answer', async () => {
  const s = setup();
  s.crew.onboard('sir');
  s.crew.recruit('reel', 'Reel', 'person');
  s.crew.assign('reel', 'ask permission to write', 'chief');
  await sleep(100);
  const payload = { tool_name: 'Write', tool_input: { file_path: '/elsewhere/x.txt' } };
  s.crew.permission('reel', payload).catch(() => {}); // its connection dies with the old crewd
  await sleep(20);
  const crew = await restart(s);
  const held = crew.permission('reel', payload, undefined, 100);
  await sleep(20);
  const asks = s.db.all("SELECT * FROM asks WHERE kind = 'permission'");
  assert.equal(asks.length, 1, 'no second card for the same call');
  await crew.answer(asks[0].id, { answer: 'allow' });
  assert.deepEqual(await held, { behavior: 'allow' });
  crew.stop();
  s.done();
});
