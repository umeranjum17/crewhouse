// The person's rule: chat -> confirmation -> durable settings -> a helper's draft. No model or send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { setup, settled } from './lab.ts';
import { startServer } from '../src/server.ts';
import * as A from '../web/src/adapter.ts';

test('confirmed rules save, cancel, edit and reach a helper without changing safety permissions', async () => {
  const { cfg, db, crew, done } = setup();
  cfg.port = 0; cfg.host = '127.0.0.1'; cfg.linkPort = 0;
  const server = await startServer(cfg, db, crew);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = async (method: string, path: string, body?: object, status = 200) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(join(cfg.stateDir, 'person.key'), 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(r.status, status, `${method} ${path}`); return r.json();
  };
  const call = (name: string, p: object) => `[tool ${name} ${JSON.stringify(p)}]`;
  const turn = async (bot: string, text: string) => { const t = await api('POST', `/api/bots/${bot}/messages`, { text }); await settled(db, t.task); return t.task; };
  const rule = 'Only prepare drafts. I will send messages myself.';
  try {
    await api('POST', '/api/onboard', { address: 'Umer' });
    assert.deepEqual((await api('GET', '/api/rules')).rules, []);
    const offered = await turn('chief', `Never send for me. ${call('crew_rule', { text: rule })}`);
    const initial = (crew.runtime as any).specOf(db.get('SELECT session FROM tasks WHERE id = ?', offered)!.session);
    assert.doesNotMatch(initial.message, /Confirmed custom rules/, 'a run with no saved rules carries no empty rules block');
    let state = await api('GET', '/api/state'), card = A.cards(state).find((c) => c.rule)!;
    assert.ok(card, JSON.stringify({ asks: state.asks, calls: db.all("SELECT data FROM events WHERE kind = 'run.call'") })); assert.equal(card.preview?.body, rule);
    assert.deepEqual(card.choices.map((c) => c.label), ['Create rule', 'Cancel']);
    assert.deepEqual((await api('GET', '/api/rules')).rules, [], 'a proposal saves nothing');
    await api('POST', `/api/asks/${card.id}/answer`, { answer: 'deny' });
    state = await api('GET', '/api/state');
    assert.equal(A.answeredReceipts(state).at(-1)?.word, 'Cancelled');
    assert.deepEqual((await api('GET', '/api/rules')).rules, []);
    await turn('chief', call('crew_rule', { text: rule }));
    card = A.cards(await api('GET', '/api/state')).find((c) => c.rule)!;
    await api('POST', `/api/asks/${card.id}/answer`, { answer: 'allow' });
    assert.deepEqual((await api('GET', '/api/rules')).rules, [{ text: rule }]);
    assert.equal(A.answeredReceipts(await api('GET', '/api/state')).at(-1)?.word, 'Saved');
    await api('POST', `/api/asks/${card.id}/answer`, { answer: 'allow' }, 409);
    const edited = rule + ' Keep each draft short.';
    await api('PUT', '/api/rules', { text: edited, replaces: rule });
    await api('PUT', '/api/rules', { text: 'x', replaces: rule }, 409);
    await api('PUT', '/api/rules', { text: 'x'.repeat(1001) }, 400);
    assert.deepEqual((await api('GET', '/api/rules')).rules, [{ text: edited }]);
    await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
    const job = await turn('scribe', `${call('crew_write', { path: 'files/reply.txt', content: 'Thanks, Umer will reply tomorrow.' })} ${call('crew_draft', { path: 'files/reply.txt', channel: 'message', to: 'Alex' })}`);
    const spec = (crew.runtime as any).specOf(db.get('SELECT session FROM tasks WHERE id = ?', job)!.session);
    assert.ok(spec.message.includes(edited), 'the actual helper run reads the edited confirmed rule');
    state = await api('GET', '/api/state');
    assert.ok(A.cards(state).some((c) => c.evidence === 'draft'));
    assert.equal(db.all("SELECT * FROM events WHERE kind = 'bot.allowed'").length, 0, 'custom rules grant no safety permission');
    assert.match((await api('GET', '/api/bots/chief')).rules, /\S/, 'static safety limits remain separate');
    await api('PUT', '/api/rules', { text: '', replaces: edited });
    assert.deepEqual((await api('GET', '/api/rules')).rules, []);
  } finally { await new Promise<void>((r) => server.close(() => r())); done(); }
});
