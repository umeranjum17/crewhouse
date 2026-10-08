import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, until } from './lab.ts';
import * as disk from '../src/bots.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';

const openAsk = (db: any) => db.get("SELECT * FROM asks WHERE state = 'open'");

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
    const drive = crew.assign('cto', `[tool crew_app ${JSON.stringify({ tool: 'herdr', input: { args: ['agent', 'prompt', 'reviewer', 'ship it'] } })}]`, 'chief').task;
    await until('the drive asks', () => openAsk(db));
    assert.match(openAsk(db).title, /reviewer.*prompt/);
    assert.equal(crew.snapshot().asks[0].detail.spends, false, 'driving is not spending');
    await assert.rejects(crew.answer(openAsk(db).id, { answer: 'allow', scope: 'always' }), /once, for this task, or always/);
    await crew.answer(openAsk(db).id, { answer: 'allow' });
    await settled(db, drive);
    const ran = db.get("SELECT * FROM events WHERE kind = 'run.call' AND json_extract(data, '$.tool') = 'herdr' AND json_extract(data, '$.task') = ?", drive)!;
    assert.match(JSON.parse(ran.data).head, /herdr said: agent prompt reviewer ship it/, 'allowed, the drive ran');
    assert.equal(task(db, drive).state, 'unsure', 'an unconfirmed drive ends unsure, never done');
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
