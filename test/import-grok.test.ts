// Importing a Grok marketplace template: the public page becomes the person's own helper. No network:
// fetch is stubbed with a synthetic page built to the extractor's contract, never creator text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './lab.ts';
import * as disk from '../src/bots.ts';

const blob = (o: unknown) => '\\"template\\":{' + JSON.stringify(o).replace(/"/g, '\\"').slice(1) + '},\\"featured\\":false';
const page = (o: unknown) => `<html><body><ul><li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">I am Testy the prospector. I research named people on the public web and draft the first line. I never send without your yes.</p></li><li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">Job: outbound prospecting. Build a list, research each name, draft the opener.</p></li><li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">User prefs, fill during getting started: what they sell = unset, who buys it = unset.</p></li></ul><script>${blob(o)}</script></body></html>`;
const recipe = () => ({ id: 'tb', name: 'Testy Prospecting', creatorName: 'Grok Team', handle: 'grokteam', description: 'Finds prospects and drafts the first line. Nothing sends without your yes.', summary: 'Prospecting.', categories: ['Sales'], installCount: 0, color: 'magenta', shape: 'pebble', addHref: '/bot/share1', imageUrl: '', instructions: '',
  memories: [{ id: 'memory-0', name: 'memory 1', description: '$42' }],
  skills: [{ id: 'skill-0', name: 'Getting started', description: 'Use to start.', content: 'Ask what they sell and who buys it.' }, { id: 'skill-1', name: 'Draft a first line', description: 'Use to draft.', content: 'Draft one line with a source link.' }],
  routines: [{ id: 'routine-0', name: 'Monday list top-up', summary: 'Every Monday, adds new names.' }],
  integrations: [{ id: 'Gmail', name: 'Gmail', description: 'Drafts sit unsent in your account.' }, { id: 'slack', name: 'slack', description: 'Posts drafts to a channel.' }] });
const stubFetch = (p: string) => { (globalThis as any).fetch = async () => ({ ok: true, text: async () => p }); };
const unstub = () => { delete (globalThis as any).fetch; };

test('import hires the marketplace bot as the person\u2019s own helper, re-import pulls the latest', async () => {
  const { crew, cfg, done } = setup();
  stubFetch(page(recipe()));
  try {
    const r = await (crew as any).importGrok('tb') as any;
    assert.equal(r.imported.name, 'Testy Prospecting');
    assert.deepEqual(r.routines, ['Monday list top-up: Every Monday, adds new names.']);
    assert.equal(r.needs.length, 1, 'slack has no Crewhouse equivalent; Gmail maps to the Gmail app');
    assert.match(r.needs[0], /^slack:/);
    const b = (crew as any).bot('testy-prospecting');
    assert.equal(b.template, 'grok-tb');
    const dir = disk.botDir(cfg, 'testy-prospecting');
    const conf = JSON.parse(readFileSync(join(dir, 'bot.json'), 'utf8'));
    assert.deepEqual(conf.tools, ['crew', 'files', 'web', 'browser', 'computer', 'documents', 'search-files']);
    assert.equal(conf.ideas[0].ask, 'Get us started');
    assert.match(readFileSync(join(dir, 'soul.md'), 'utf8'), /I am Testy the prospector/);
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /## Your job/);
    disk.validateJob(disk.readJob(cfg, 'testy-prospecting'));
    assert.ok(existsSync(join(dir, 'skills', 'getting-started', 'SKILL.md')));
    assert.match(readFileSync(join(dir, 'SOURCE.md'), 'utf8'), /marketplace: https:\/\/x\.ai\/bot\/marketplace\/bots\/tb/);
    assert.match(readFileSync(join(dir, 'SOURCE.md'), 'utf8'), /creator: Grok Team/);
    const again = await (crew as any).importGrok('https://x.ai/bot/marketplace/bots/tb', 'Testy Prospecting') as any;
    assert.equal(again.updated.id, 'testy-prospecting', 'the same hire updates instead of doubling');
    await assert.rejects((crew as any).importGrok('no page here!'), /marketplace bot/, 'a bad slug fails before any fetch');
  } finally { unstub(); done(); }
});

test('import refuses a page with no published recipe and a name clash', async () => {
  const { crew, done } = setup();
  try {
    stubFetch('<html><body>renamed or removed</body></html>');
    try {
      await assert.rejects((crew as any).importGrok('gone'), /no published recipe/);
    } finally { unstub(); }
    crew.recruit('scout', 'Scout', 'person');
    stubFetch(page(recipe()));
    try {
      await assert.rejects((crew as any).importGrok('tb', 'Scout'), /already a helper/);
    } finally { unstub(); }
  } finally { done(); }
});
