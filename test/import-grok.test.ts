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
const SKILL_MD = `---\nname: test-skill\ndescription: Make tiny web toys. Use when the person asks for a small interactive page.\nlicense: Complete terms in LICENSE.txt\n---\n\nBuild it with [the template](template.js) and ship it. Missing notes live in \`gone.md\`.\n`;
const APACHE = 'Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/LICENSE-2.0\nTERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';
const stubSkillFetch = (license = APACHE) => { (globalThis as any).fetch = async (url: string) => {
  const file = String(url).split('/').at(-1) ?? '';
  const hit: Record<string, string> = { 'SKILL.md': SKILL_MD, 'LICENSE.txt': license, 'template.js': 'console.log("toy");' };
  if (!(file in hit)) return { ok: false, status: 404 };
  return { ok: true, status: 200, text: async () => hit[file], arrayBuffer: async () => Buffer.from(hit[file]) };
}; };

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

test('crew_import takes the handle however the model sends it (real run shapes), seated like a recruit', async () => {
  const { crew, cfg, done } = setup();
  stubFetch(page(recipe()));
  try {
    const tool = (crew as any).crewTools('chief').find((t: any) => t.name === 'crew_import');
    // Every input shape Chief actually sent on the real-model run (run.call events): slug never arrived.
    const shapes = [{ handle: 'tb', source: 'grok' }, { name: 'tb' }, { bot: 'tb' }, { id: 'tb' },
      { url: 'https://grok.com/marketplace/tb' }, { grok: 'tb' },
      { source: 'grok', handle: 'tb', name: 'tb', bot: 'tb', id: 'tb', template: 'tb', query: 'tb', address: 'tb' }];
    for (const input of shapes) {
      const out = JSON.parse(String(await tool.run(input)));
      assert.ok(out.imported ?? out.updated, `shape ${JSON.stringify(input)} imports, never "name a marketplace bot"`);
      (crew as any).db.run("DELETE FROM bots WHERE id IN ('tb', 'testy-prospecting')");
    }
    JSON.parse(String(await tool.run({ slug: 'tb' })));
    const dir = disk.botDir(cfg, 'testy-prospecting');
    const conf = JSON.parse(readFileSync(join(dir, 'bot.json'), 'utf8'));
    const helper = disk.loadTemplate(cfg, 'helper');
    assert.deepEqual(conf.models, helper.models, 'an import is seated on the crew\u2019s own accounts, like a recruit');
    assert.deepEqual(conf.tools, helper.tools, 'an import carries the crew\u2019s own tool grants, like a recruit');
    await assert.rejects(tool.run({ source: 'grok' }), /marketplace bot/, 'a marker with no handle still fails honestly');
  } finally { unstub(); done(); }
});

test('a marketplace miss falls back to the skill repo; a Claude marker goes straight there', async () => {
  const { crew, done } = setup();
  (globalThis as any).fetch = async (url: string) => {
    if (String(url).includes('x.ai')) return { ok: false, status: 404 };
    if (!String(url).includes('/test-skill')) return { ok: false, status: 404 };
    const file = String(url).split('/').at(-1) ?? '';
    const hit: Record<string, string> = { 'SKILL.md': SKILL_MD, 'LICENSE.txt': APACHE, 'template.js': 'console.log("toy");' };
    if (!(file in hit)) return { ok: false, status: 404 };
    return { ok: true, status: 200, text: async () => hit[file], arrayBuffer: async () => Buffer.from(hit[file]) };
  };
  try {
    const tool = (crew as any).crewTools('chief').find((t: any) => t.name === 'crew_import');
    // Run-5 shapes: the model sent recruit-shaped args and a source marker, never slug/skill.
    const fell = JSON.parse(String(await tool.run({ template: 'test-skill' })));
    assert.ok(fell.imported ?? fell.updated, 'marketplace miss still imports the skill');
    assert.match(JSON.stringify(fell), /github\.com\/anthropics/);
    (crew as any).db.run("DELETE FROM bots WHERE id = 'test-skill'");
    const marked = JSON.parse(String(await tool.run({ id: 'test-skill', source: 'claude' })));
    assert.ok(marked.imported ?? marked.updated, 'a Claude marker routes straight to the skill repo');
    (crew as any).db.run("DELETE FROM bots WHERE id = 'test-skill'");
    await assert.rejects(tool.run({ slug: 'nope' }), /no skill at/, 'both misses name both, so the model stops guessing');
  } finally { unstub(); done(); }
});

test('import refuses a page with no published recipe and a name clash', async () => {
  const { crew, cfg, done } = setup();
  try {
    stubFetch('<html><body>renamed or removed</body></html>');
    try {
      await assert.rejects((crew as any).importGrok('gone'), /no published recipe/);
    } finally { unstub(); }
    crew.recruit('scout', 'Scout', 'person');
    stubFetch(page(recipe()));
    try {
      await assert.rejects((crew as any).importGrok('tb', 'Scout'), /already a bot/);
    } finally { unstub(); }
    assert.match(readFileSync(join(disk.botDir(cfg, 'scout'), 'AGENTS.md'), 'utf8'), /Scout/, 'the refused import writes nothing over Scout');
    assert.ok(!readFileSync(join(disk.botDir(cfg, 'scout'), 'AGENTS.md'), 'utf8').includes('Testy'));
  } finally { done(); }
});

test('a Claude skill becomes its own helper, license-checked, resources carried', async () => {
  const { crew, cfg, done } = setup();
  try {
    stubSkillFetch();
    const r = await (crew as any).importGrok('', undefined, 'test-skill') as any;
    assert.equal(r.imported.name, 'Test Skill');
    assert.match(r.source, /github\.com\/anthropics\/skills\/tree\/main\/skills\/test-skill/);
    const b = (crew as any).bot('test-skill');
    assert.equal(b.template, 'skill-test-skill');
    const dir = disk.botDir(cfg, 'test-skill');
    const md = readFileSync(join(dir, 'skills', 'test-skill', 'SKILL.md'), 'utf8');
    assert.match(md, /name: test-skill/);
    assert.match(md, /says: /);
    assert.match(md, /license: Apache-2\.0/);
    assert.ok(readFileSync(join(dir, 'skills', 'test-skill', 'LICENSE.txt'), 'utf8').includes('Apache License'));
    assert.ok(existsSync(join(dir, 'skills', 'test-skill', 'template.js')), 'referenced resources ride along');
    assert.match(readFileSync(join(dir, 'SOURCE.md'), 'utf8'), /not carried over: gone\.md/);
    disk.validateJob(disk.readJob(cfg, 'test-skill'));
    const again = await (crew as any).importGrok('', 'Test Skill', 'anthropics/skills:skills/test-skill') as any;
    assert.equal(again.updated.id, 'test-skill', 're-import by owner/repo:path updates the same hire');
  } finally { unstub(); done(); }
});

test('a skill without a reusable license is refused, never copied', async () => {
  const { crew, done } = setup();
  try {
    stubSkillFetch('Some custom terms. All rights reserved.');
    await assert.rejects((crew as any).importGrok('', undefined, 'test-skill'), /no reusable license/);
    assert.equal((crew as any).bot('test-skill'), undefined, 'nothing hired, nothing written');
  } finally { unstub(); done(); }
});
