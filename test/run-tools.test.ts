import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, until } from './lab.ts';
import * as disk from '../src/bots.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
import { effectOf } from '../src/policy.ts';
import { herdrStatus, registry } from '../src/tools.ts';
import { card, herdr } from '../web/src/adapter.ts';

const openAsk = (db: any) => db.get("SELECT * FROM asks WHERE state = 'open'");

test('Herdr setup probes are asynchronous, bounded and report live state', async () => {
  const { cfg, root, done } = setup();
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    const missing = await herdrStatus(cfg);
    assert.equal(missing.ready, false);
    assert.equal(missing.connected, false);
    assert.deepEqual(herdr(missing), { state: 'missing', says: 'Not installed.', howto: missing.howto });
    const binary = join(bin, 'herdr');
    writeFileSync(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"status":"not_running","running":false}\'\n', { mode: 0o755 });
    const stopped = await herdrStatus(cfg);
    assert.deepEqual(stopped, { ready: true, connected: false, howto: missing.howto });
    assert.deepEqual(herdr(stopped), { state: 'setup', says: 'Installed, not answering. Open Herdr once, then Retry.', howto: '' });
    writeFileSync(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"running":true}\'\n');
    assert.deepEqual(await herdrStatus(cfg), { ready: true, connected: true, howto: '' });
    const started = join(root, 'probe-started');
    writeFileSync(binary, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nprocess.on('SIGTERM', () => {});\nwriteFileSync(${JSON.stringify(started)}, 'started');\nsetInterval(() => {}, 1000);\n`);
    let finished = false;
    const probe = herdrStatus(cfg).then((result) => { finished = true; return result; });
    await until('the unresponsive probe started without blocking the caller', () => existsSync(started));
    assert.equal(finished, false, 'other event-loop work proceeds during the probe');
    const result = await probe;
    assert.equal(result.ready, true);
    assert.equal(result.connected, false);
    assert.equal(herdr(result)!.state, 'setup');
    writeFileSync(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"running":true}\'\n');
    assert.equal((await herdrStatus(cfg)).connected, true, 'Retry probes again');
  } finally {
    process.env.PATH = originalPath;
    done();
  }
});

test('granted run tools work through crew_app, with grant and command checks intact', async () => {
  const { cfg, db, crew, root, done } = setup();
  crew.onboard('sir');
  crew.recruit('tracer', 'Tracer', 'person');
  const conf = disk.botConfig(cfg, 'tracer');
  writeFileSync(join(disk.botDir(cfg, 'tracer'), 'bot.json'), JSON.stringify({ ...conf, tools: ['people-search'] }));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'treg'), '#!/bin/sh\nprintf "catalog result: %s\\n" "$*"\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    const call = async (tool: string, args: string[]) => {
      const id = crew.assign('tracer', `[tool crew_app ${JSON.stringify({ tool, input: { args } })}]`, 'chief').task;
      await settled(db, id);
      return { id, result: task(db, id).result };
    };
    const lookup = await call('people_search', ['catalog', 'search', 'phone']);
    assert.match(lookup.result, /catalog result: catalog search phone/);
    const runtime = crew.runtime as StubRuntime;
    const key = task(db, lookup.id).session;
    assert.match(runtime.transcript(key), /crew_app: catalog result: catalog search phone/);
    assert.match(runtime.specOf(key)!.system, /crew_app:.*people_search/);
    assert.equal(db.all('SELECT * FROM asks').length, 0, 'free catalog reads never ask');
    for (const tool of ['constructor', 'toString', 'github']) {
      assert.match((await call(tool, ['catalog'])).result, /does not have that tool/);
    }
    assert.match((await call('people_search', ['login'])).result, /not something a bot may do/);
  } finally {
    process.env.PATH = originalPath;
    done();
  }
});

test('the CTO sees terminal agents read-only and every drive asks, naming its pane or agent', async () => {
  const { cfg, db, crew, root, done } = setup();
  crew.onboard('sir');
  crew.recruit('cto', 'CTO', 'person');
  assert.ok(disk.botConfig(cfg, 'cto').tools.includes('herdr'), 'the CTO template holds the grant');
  assert.ok(!disk.botConfig(cfg, 'cto').tools.includes('web'));
  assert.ok(!crew.snapshot().ideas.some((i: any) => i.bot === 'cto'));
  assert.ok(disk.templateKit(cfg, disk.loadTemplate(cfg, 'cto')).some((k) => k.id === 'herdr'), 'the recruit card offers it');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'herdr'), '#!/bin/sh\nprintf "herdr said: %s\\n" "$*"\n', { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  try {
    // Read-only lists ask once: the card says what it looks at, and Always covers later looks.
    const first = crew.assign('cto', `[tool crew_app ${JSON.stringify({ tool: 'herdr', input: { args: ['pane', 'list'] } })}]`, 'chief').task;
    await until('the look asks', () => openAsk(db));
    assert.equal(openAsk(db).title, 'CTO wants to look at your terminal agents.');
    assert.equal(crew.snapshot().asks[0].detail.always, 'your terminal agents');
    await crew.answer(openAsk(db).id, { answer: 'allow', scope: 'always' });
    await settled(db, first);
    assert.match(task(db, first).result, /herdr said: pane list/);
    const second = crew.assign('cto', `[tool crew_app ${JSON.stringify({ tool: 'herdr', input: { args: ['agent', 'read', 'reviewer'] } })}]`, 'chief').task;
    await settled(db, second);
    assert.match(task(db, second).result, /herdr said: agent read reviewer/, 'a standing answer covers later looks');
    assert.equal(db.all("SELECT * FROM asks WHERE state = 'answered'").length, 1);
    // Driving names its pane or agent and the command, asks every time, and is never money.
    const payload = 'echo harmless; '.repeat(12) + 'rm -rf /tmp/example; `codex`\n\t\u202e';
    const driveArgs = ['agent', 'prompt', 'reviewer', payload];
    const drive = crew.assign('cto', `[tool crew_app ${JSON.stringify({ tool: 'herdr', input: { args: driveArgs } })}]`, 'chief').task;
    await until('the drive asks', () => openAsk(db));
    assert.match(openAsk(db).title, /prompt.*reviewer/);
    assert.deepEqual(JSON.parse(card(crew.snapshot().asks[0], crew.snapshot()).preview!.body), driveArgs);
    assert.equal(crew.snapshot().asks[0].detail.spends, false, 'driving is not spending');
    await assert.rejects(crew.answer(openAsk(db).id, { answer: 'allow', scope: 'always' }), /once, for this task, or always/);
    await crew.answer(openAsk(db).id, { answer: 'allow' });
    await settled(db, drive);
    const ran = db.get("SELECT * FROM events WHERE kind = 'run.call' AND json_extract(data, '$.tool') = 'herdr' AND json_extract(data, '$.task') = ?", drive)!;
    assert.deepEqual(JSON.parse(JSON.parse(ran.data).input).input.args, driveArgs, 'the approved argv is what ran');
    assert.match(JSON.parse(ran.data).head, /herdr said: agent prompt reviewer echo harmless/, 'allowed, the drive ran');
    assert.equal(task(db, drive).state, 'unsure', 'an unconfirmed drive ends unsure, never done');
    const conf = registry(cfg).find((t) => t.id === 'herdr')!;
    const seen = { bot: 'CTO', space: root, secret: [], run: { herdr: { name: conf.name, ...conf.run! } } };
    for (const prefix of conf.run!.spend) {
      const args = [...prefix.split(' '), 'reviewer', payload, '--flag', 'two  spaces'];
      const e = effectOf('herdr', { args }, seen);
      assert.equal(e.kind, 'send');
      if (e.kind !== 'send') throw new Error('drive must ask');
      assert.deepEqual(JSON.parse(e.preview!.body), args);
      assert.equal(e.words, `CTO wants to drive your terminal agents: ${e.preview!.body}.`);
      const other = effectOf('herdr', { args: [...args.slice(0, 3), payload + 'different', ...args.slice(4)] }, seen);
      assert.notEqual(e.words, 'words' in other ? other.words : undefined);
      const split = effectOf('herdr', { args: [...args.slice(0, 4), '--flag two  spaces'] }, seen);
      assert.notEqual(e.words, 'words' in split ? split.words : undefined);
      const view = card({ id: 999, bot: 'cto', kind: 'permission', at: 0, detail: { effect: e.kind, words: e.words, preview: e.preview } }, crew.snapshot());
      assert.deepEqual(JSON.parse(view.preview!.body), args, 'the card preserves the exact arguments, including controls and command text');
      assert.equal(view.words, e.words, 'the approval identity is also shown without scrubbing');
      assert.equal(view.status, 'Needs your OK');
      assert.equal(view.head, 'CTO would like your OK');
      assert.deepEqual(view.choices.map((c) => c.label), ['Yes, go ahead', 'Not now']);
    }
    assert.equal(effectOf('herdr', { args: ['agent', 'start', 'new'] }, seen).kind, 'refuse');
    assert.equal(effectOf('herdr', { args: ['pane run', 'reviewer', payload] }, seen).kind, 'refuse');
    const again = crew.assign('cto', `[tool crew_app ${JSON.stringify({ tool: 'herdr', input: { args: ['agent', 'prompt', 'reviewer', 'ship it'] } })}]`, 'chief').task;
    await until('the drive asks again', () => openAsk(db));
    await crew.answer(openAsk(db).id, { answer: 'deny' });
    await settled(db, again);
    assert.doesNotMatch(task(db, again).result, /herdr said/, 'not allowed, never driven');
  } finally {
    process.env.PATH = originalPath;
    done();
  }
});
