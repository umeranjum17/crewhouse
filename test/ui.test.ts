// The "no technical text" gate: whatever crewd sends, nothing a person reads may show a command, a file path,
// an engine or model name, a usage percentage, a raw prompt or terminal text (persona brief rule 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../web/src/adapter.ts';

const now = Date.now();
const bot = (id: string, extra = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), role: 'Makes demo videos from screenshots', template: id, runtime: 'claude', model: 'sonnet',
  thinks: [{ key: 'claude:sonnet', name: 'Claude Sonnet' }], state: 'on', computer: true, controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra });
// The owner's screenshot, as crewd sends it today: a raw fc-list approval, "Claude · 9% of 5h used", the prompt as the task.
const state = {
  person: { id: 2, name: 'Nadia', address: 'Nadia', onboarded: 1 },
  members: [{ id: 1, name: 'Umer' }, { id: 2, name: 'Nadia' }],
  bots: [
    bot('chief'),
    bot('reel', { task: { id: 5, title: 'Make a birthday video for mum', state: 'needs_you' }, stuck: true, quietSince: now - 6 * 60_000,
      step: { kind: 'run.tool', at: now, data: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } } }),
    bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, step: { kind: 'run.tool', at: now, data: { tool: 'Read', summary: '/home/umer/Crewhouse/bots/scout/notes.md' } } }),
    bot('tracer', { template: 'tracer' }),
  ],
  templates: [{ id: 'chief' }, { id: 'reel', display: 'Reel', role: 'Makes videos' }, { id: 'tracer', display: 'Tracer', role: 'Finds emails' }],
  tasks: [
    { id: 4, bot: 'reel', title: 'Eid collage', state: 'done', updated_at: now, files: ['files/eid-collage.png'], result: 'Saved to /home/umer/Crewhouse/bots/reel/files/eid-collage.png with `magick montage -tile 4x3`' },
    { id: 3, bot: 'scout', title: 'Flights', state: 'failed', updated_at: now, files: [], result: 'Stopped on an error from claude: 529 overloaded' },
  ],
  ideas: [],
  asks: [
    { id: 1, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like to run a command', detail: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20', rule: 'Bash(fc-list *)', covers: 'fc-list commands' } },
    { id: 2, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like to use mcp__people__search', detail: { tool: 'mcp__people__search', summary: 'curl -X POST https://api.example.com', spends: true } },
    { id: 3, bot: 'scout', task_id: 6, kind: 'blocked', at: now, title: 'Scout is waiting on a question in its terminal', detail: { pane: '❯ 1. Yes\n  2. No, and tell Claude what to do (esc)' } },
    { id: 4, bot: 'reel', task_id: null, kind: 'propose', at: now, title: 'Reel would like to remember how to do this: make a birthday video', detail: { words: 'Reel would like to remember how to do this: make a birthday video', preview: { head: 'How Reel would do it', body: '1. Pick the happiest photos from ~/Pictures/eid\n2. Run `ffmpeg -i x.mp4`' } } },
  ],
  events: [
    { seq: 1, at: now, kind: 'run.tool', bot: 'reel', data: { task: 5, tool: 'Bash', summary: 'ffmpeg -i in.mp4 out.mp4' } },
    { seq: 2, at: now, kind: 'run.tool', bot: 'reel', data: { task: 5, tool: 'mcp__browser__browser_click', summary: 'ref=e12' } },
    { seq: 3, at: now, kind: 'ask.opened', bot: 'reel', data: { task: 5, kind: 'permission', tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } },
    { seq: 4, at: now, kind: 'run.allowed', bot: 'reel', data: { task: 5, summary: 'fc-list 2>&1 | head -20', rule: 'Bash(fc-list *)' } },
    { seq: 5, at: now, kind: 'file.delivered', bot: 'reel', data: { task: 5, path: 'files/mum-birthday_v2.mp4' } },
    { seq: 6, at: now, kind: 'account.limit', bot: null, data: { fiveHour: { used: 9 } } },
    { seq: 7, at: now, kind: 'task.failed', bot: 'scout', data: { task: 3, title: 'Flights', result: 'Stopped on an error from claude' } },
  ],
  limits: { claude: { fiveHour: { used: 9, resetsAt: now + 3600_000 } } },
  resting: { claude: now + 3600_000, codex: 0 },
  routines: [{ id: 1, bot: 'reel', kind: 'task', name: 'Weekly demo', words: 'Every Monday at 9:00', state: 'on', next_at: now, brain: 'claude:haiku', history: [] }],
};
const page = { messages: [
  { id: 1, author: 'person', text: 'can you make a birthday video for mum' },
  { id: 2, author: 'bot', text: 'Done! I ran `ffmpeg -i /home/umer/Crewhouse/bots/reel/files/in.mp4 out.mp4` with Claude Code.\n```sh\nls -la\n```' },
  { id: 3, author: 'system', text: 'Delivered files/mum-birthday_v2.mp4: first cut' },
], notes: '# Notes\n- Nadia likes soft piano\n- Keep videos in ~/Crewhouse/bots/reel/files', trail: state.events,
  soul: '# Reel\n\nYou are Reel.\n\n## Voice\n- Upbeat. Say what you made, never `ffmpeg -i in.mp4`.',
  skills: [{ name: 'make-reel', description: 'Turn screenshots into a demo video (mp4) with ffmpeg.', says: 'Turn photos into a short video' }, { name: 'plan-dinners', description: 'Uses the browser MCP tools' }] };

const FORBIDDEN = /fc-list|2>&1|\| ?head|\bBash\b|claude|anthropic|codex|sonnet|haiku|opus|gpt-|mcp__|\/home\/|~\/|files\/|\.md\b|\bpane\b|terminal|\d+ ?%|a command|ffmpeg|magick|\bls -la\b|```|`|\besc\b|529/i;
// URLs are for fetching files, never shown as text.
const shown = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'url' ? undefined : v));

test('nothing technical survives the adapter', () => {
  const h = A.chatgpt([{ member: 2, account: 'chatgpt', name: 'ChatGPT', signedIn: false, signIn: { state: 'waiting', url: 'https://auth.openai.com/codex/device', code: 'AB12-CDE34' } }], 2);
  const views = {
    crew: A.crew(state), chief: A.chief(state), cards: A.cards(state), work: A.work(state), things: A.things(state), ideas: A.ideas(state),
    steps: A.steps(page.trail, undefined, true), lines: A.lines(page, 'reel'), memories: A.memories(page.notes), personality: A.personality(page.soul), knows: A.knows(page.skills), routines: A.routines(state), gallery: A.gallery(state),
    resting: A.resting(state), apps: A.apps(state), chatgpt: { ...h, signing: { code: h.signing?.code } },
  };
  for (const [name, v] of Object.entries(views)) assert.doesNotMatch(shown(v), FORBIDDEN, name);
  assert.equal(h.signing?.code, 'AB12-CDE34', 'the one-time code reaches the sign-in sheet');
  assert.deepEqual(A.knows(page.skills).map((k) => k.says), ['Turn photos into a short video', 'plan dinners'], 'the person\'s words, never the model\'s');
  assert.equal(A.personality(page.soul)[0], 'You are Reel.', 'the name heading is not repeated');
  assert.equal(A.soulText('Reel', A.soulDraft(page.soul)), page.soul + '\n', 'editing keeps the name heading');
  assert.equal(A.withoutMemory(A.withMemory('- One\n', 'Two'), 0), '- Two\n');
});

test('asks become plain cards: money never gets "always", a blocked terminal becomes a question', () => {
  const [run, spend, question, keep] = A.cards(state);
  assert.equal(keep.head, 'Reel learned something');
  assert.deepEqual(keep.choices.map((c) => c.label), ['Yes, keep it', 'Not now'], 'a suggestion is yes or no, never "always"');
  assert.equal(keep.preview?.head, 'How Reel would do it');
  assert.equal(run.words, 'Reel would like your OK to carry on.');
  assert.deepEqual(run.choices.map((c) => c.label), ['Yes, go ahead', 'Always OK for Reel', 'Not now']);
  assert.equal(spend.kind, 'spend');
  assert.ok(!spend.choices.some((c) => /always/i.test(c.label)));
  assert.equal(question.kind, 'question');
  assert.ok(question.reply);
  // The engine's own words and preview win once it sends them (docs/ui-contract.md).
  const send = A.card({ id: 9, bot: 'reel', kind: 'permission', at: now, detail: { effect: 'send', words: 'Reel wants to email Aunty Sara. Send it?', always: 'Aunty Sara', preview: { head: 'To Aunty Sara', body: 'Dear Aunty Sara' } } }, state);
  assert.equal(send.words, 'Reel wants to email Aunty Sara. Send it?');
  assert.deepEqual(send.choices.map((c) => c.label), ['Send', 'Always OK for Aunty Sara', 'Not now']);
  assert.equal(A.card({ id: 8, bot: 'reel', kind: 'connect', at: now, detail: { app: 'drive' } }, state).app?.name, 'Google Drive');
});

test('owner-only helpers stay with the owner', () => {
  assert.ok(!A.crew(state).some((h) => h.id === 'tracer'));
  assert.ok(!A.gallery(state).some((t: any) => t.id === 'tracer'));
  const owner = { ...state, person: { ...state.person, id: 1 } };
  assert.ok(A.crew(owner).some((h) => h.id === 'tracer'));
});

test('plain() keeps what a person wrote and drops the machinery', () => {
  assert.equal(A.plain('Saved it to /home/umer/x/report.pdf for you'), 'Saved it to “Report” for you');
  assert.equal(A.plain('I used `ls -la` and it worked'), 'I used and it worked');
  assert.equal(A.plain('Your `Birthday` video'), 'Your Birthday video');
  assert.equal(A.plain('It is saved at `files/birthday-card.mp4` and is 1080p.'), 'It is saved at “Birthday card” and is 1080p.', 'a file named by the bot keeps its name');
  assert.equal(A.plain('She said 3/4 of us are in'), 'She said 3/4 of us are in');
  assert.equal(A.pretty('files/mum-birthday_v2.mp4'), 'Mum birthday v2');
});

test('the screens read view models only, and the mono face draws art only', () => {
  const dir = join(import.meta.dirname, '..', 'web', 'src');
  // The phone app's screens too (mobile/App.tsx), which read the same adapter.
  for (const f of [...readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)), join(dir, '..', '..', 'mobile', 'App.tsx')]) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /detail\.(summary|pane|rule|tool)|\.thinks\b|\.limits\b|\.runtime\b|\bclaude\b|terminal/i, f);
    if (f.endsWith('App.tsx')) assert.doesNotMatch(src, /monospace/, 'the phone app draws its art as dots, and sets no text in mono');
    else assert.doesNotMatch(src, /<pre(?![^>]*className="art)/, f);
  }
  const css = readFileSync(join(dir, 'styles.css'), 'utf8');
  for (const rule of css.split('}')) {
    if (!/var\(--art\)|monospace/.test(rule)) continue;
    assert.match(rule, /(\.art\b|--art:|@font-face)/, `mono type outside the art: ${rule.trim().slice(0, 80)}`);
  }
});

test('sign-in states reach the screens as plain states, never the engine\'s words', () => {
  const row = (signIn: any, extra = {}) => A.account([{ member: 2, account: 'chatgpt', name: 'ChatGPT', signedIn: false, signIn, ...extra }], 2);
  const page = row({ state: 'waiting', via: 'browser', url: 'https://auth.openai.com/oauth/authorize?x' });
  assert.equal(page.page, 'https://auth.openai.com/oauth/authorize?x', 'the redirect: a page to open, no code');
  assert.equal(page.signing, null);
  assert.equal(row({ state: 'waiting', via: 'code', url: 'https://auth.openai.com/codex/device', code: 'AB12-CD34' }).signing?.code, 'AB12-CD34');
  assert.ok(row({ state: 'failed', why: 'declined', error: 'The sign-in was declined' }).declined);
  assert.ok(row({ state: 'failed', why: 'busy', error: 'Something else…' }).busy);
  assert.ok(row({ state: 'failed', error: 'The sign-in took too long.' }).expired);
  const ready = row(null, { signedIn: true, notIncluded: true, work: 'sara@acme.com' });
  assert.deepEqual([ready.state, ready.notIncluded, ready.work], ['ready', true, 'sara@acme.com']);
  assert.equal(A.resting({ resting: { chatgpt: Date.now() + 3600_000 } }).startsWith('Your ChatGPT is resting until'), true);
  assert.deepEqual(A.apps({ connections: [] }).map((a) => a.id), ['drive', 'calendar', 'gmail', 'notion', 'canva'], 'v1: no Outlook');
  assert.ok(A.needsHouse({ house: { google: false } }, A.apps({})[1]));
  assert.ok(!A.needsHouse({ house: { google: false } }, A.apps({})[3]), 'Notion needs no setup');
});

test('the mascots: every mood draws a whole grid in known colours, and Chief\'s moods all look different', async () => {
  const art = await import('../web/src/art.ts');
  const moods = ['blink', 'twitch', 'hello', 'happy', 'work', 'ask', 'listen', 'rest', 'error'] as const;
  const faces = [
    ...[undefined, ...moods].map((m) => [art.chief(m), art.CHIEF_PAL] as const),
    ...[undefined, ...moods].map((m) => [art.chiefSmall(m), art.CHIEF_PAL] as const),
    ...(['reel', 'scout', 'scribe', 'pip', 'tracer'] as const).flatMap((k) => [undefined, ...moods].map((m) => [art.pal(k, m), art.palPalette(k)] as const)),
  ];
  for (const [rows, pal] of faces) {
    assert.ok(rows.every((r) => r.length === rows[0].length), 'a ragged bitmap breaks the dot grid');
    for (const k of rows.join('').replace(/\./g, '')) assert.ok(pal[k], `no colour for "${k}"`);
  }
  assert.equal(new Set(moods.map((m) => art.chief(m).join())).size, moods.length, 'two of Chief\'s moods look the same');
});
