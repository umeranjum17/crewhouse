import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task } from './lab.ts';
import * as disk from '../src/bots.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';

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
