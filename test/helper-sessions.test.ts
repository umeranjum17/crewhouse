// Real HTTP recruitment, messages, memory and restart; only the model is scripted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setup, settled, holding, release } from './lab.ts';
import { Crew } from '../src/crew.ts';
import { Store } from '../src/db.ts';
import { startServer } from '../src/server.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';

test('old and newly hired helpers keep their own session, persona and notes after restart', async () => {
  const lab = setup();
  Object.assign(lab.cfg, { port: 0, linkPort: 0, host: '127.0.0.1' });
  let crew = lab.crew, db = lab.db, server = await startServer(lab.cfg, db, crew);
  const api = async (method: string, path: string, body?: object) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method,
      headers: { authorization: `Bearer ${readFileSync(join(lab.cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const stop = async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await crew.stop(); if (crew === lab.crew) lab.done(); else db.close(); };
  const turn = async (bot: string, text: string) => {
    const { task } = await api('POST', `/api/bots/${bot}/messages`, { text });
    await settled(db, task);
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', task)!.state, 'done');
    const key = db.get('SELECT session FROM tasks WHERE id = ?', task)!.session;
    return { task, key, spec: (crew.runtime as StubRuntime).specOf(key)! };
  };
  try {
    await api('POST', '/api/onboard', { address: 'Umer' });
    await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
    const notes = join(lab.cfg.crewDir, 'people/1/notes/scout.md');
    assert.ok(existsSync(notes), 'a memory file is ready at hire time');
    writeFileSync(join(lab.cfg.crewDir, 'bots/scout/IDENTITY.md'), '- Name: Scout\n- Style: curious\n');
    const first = await turn('scout', 'For my research, remember: put the cheapest option first. [tool crew_remember {"text":"Put the cheapest option first"}]');
    assert.equal(first.key, 'agent:m1:crewhouse:scout');
    assert.match(first.spec.system, /# Scout/);
    assert.match(first.spec.system, /- Name: Scout\n- Style: curious/);
    assert.doesNotMatch(first.spec.system, /Chief's voice for the house|# Chief/);
    assert.match(readFileSync(notes, 'utf8'), /cheapest option first/);
    const held = await api('POST', '/api/bots/scout/messages', { text: 'ask permission before comparing another option' });
    await holding(crew, 'scout');
    await release(crew, 'scout', 'Here is another option.');
    await settled(db, held.task);
    assert.equal(db.get('SELECT state FROM tasks WHERE id = ?', held.task)!.state, 'done', 'closing the finished job never cancels the next turn on its session');
    await stop();
    lab.done();
    db = new Store(lab.cfg.stateDir); crew = new Crew(lab.cfg, db); crew.init();
    server = await startServer(lab.cfg, db, crew);
    const recall = await turn('scout', 'How should you order my research?');
    assert.equal(recall.key, first.key, 'a new job after restart continues the helper conversation');
    assert.notEqual(recall.task, first.task);
    assert.match(recall.spec.message, /Your notes[\s\S]*cheapest option first/);
    await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
    assert.ok(existsSync(join(lab.cfg.crewDir, 'people/1/notes/scribe.md')));
    const other = await turn('scribe', 'What ordering preference did I tell Scout?');
    assert.equal(other.key, 'agent:m1:crewhouse:scribe');
    assert.match(other.spec.system, /# Scribe/);
    assert.doesNotMatch(other.spec.message + other.spec.system, /cheapest option first|# Scout/);
    assert.equal(readFileSync(notes, 'utf8'), '- Put the cheapest option first\n', 'hiring and boot never overwrite existing notes');
  } finally { await stop(); }
});
