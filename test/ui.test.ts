// The "no technical text" gate: whatever crewd sends, nothing a person reads may show a command, a file path,
// an engine or model name, a usage percentage, a raw prompt or terminal text (persona brief rule 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Json } from '../web/src/api.ts';
import * as A from '../web/src/adapter.ts';
import { draftOf, keepDraft, sent } from '../web/src/draft.ts';
import { color } from '../web/src/tokens.ts';
import { cycle } from '../web/src/dialog.ts';

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
// URLs are for fetching files, never shown as text; nor are times, which are numbers (a timestamp can contain "529").
const shown = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'url' || k === 'at' ? undefined : v));

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

test('the phone app moves only through mobile/src/motion.ts, where Reduce Motion always snaps', () => {
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /\bAnimated\b|LayoutAnimation|animated: true|animationType="(slide|fade)"/, 'a move named outside motion.ts');
  for (const [m] of app.matchAll(/animationType=\{[^}]*\}|animationType="[^"]*"/g)) assert.match(m, /motion\.\w+\(reduce\)|"none"/, m);
  const rule = readFileSync(join(import.meta.dirname, '..', 'mobile', 'src', 'motion.ts'), 'utf8');
  assert.match(rule, /reduce \? 'none'/, 'Reduce Motion snaps a sheet');
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
  const moods = ['blink', 'twitch', 'hello', 'happy', 'work', 'ask', 'listen', 'rest', 'worried', 'error'] as const;
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
  // The redraw: content is a ∪ (ends curled up, lowest dots in the centre), sad lost the sweat drop, worried keeps it,
  // and content still smiles in the small cut that draws every face under 48 px.
  const shape = (r: string) => [...r].map((c) => (c === 'm' ? 'm' : '.')).join('').replace(/^\.+|\.+$/g, '');
  assert.deepEqual(art.chief('idle').filter((r) => r.includes('m')).slice(-4).map(shape),
    ['m..............m', 'mm...mmmmmm...mm', 'mmmmmmmmmmmmmm', 'mmmmmmmm'], 'content: a ∪ moustache, lowest dots in the centre');
  assert.ok(!art.chief('error').join().includes('d'), 'sad lost the sweat drop');
  assert.ok(art.chief('worried').join().includes('d'), 'worried keeps the drop');
  assert.notEqual(art.chiefSmall('idle').join(), art.chiefSmall('error').join(), 'small content is not the small cut');
  assert.deepEqual(art.chiefSmall('idle').filter((r) => r.includes('m')).map(shape), ['m........m', 'mmmmmmmm'], 'small content: ends curled up above the bar');
});

test("Chief's mood is the first matching row of the table, and the line follows the face", () => {
  const min = 60_000, ago = (m: number) => Date.now() - m * min;
  const bot = (id: string, extra: Json = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), template: id, ...extra });
  const base: Json = { person: { id: 1 }, members: [], asks: [], tasks: [], events: [], resting: {}, bots: [bot('chief'), bot('reel'), bot('scout')] };
  const withBots = (...bs: Json[]) => ({ ...base, bots: [bot('chief'), ...bs] });
  const mood = (v: { mood: string }) => v.mood;
  // 9 · nothing applies: content
  assert.equal(A.chief(base).mood, 'idle');
  assert.equal(A.chief(base).line, 'Keeping an eye on things');
  assert.equal(A.chief(base).tone, 'ok');
  // 1 · the computer is asleep, whatever else is true
  const busyHouse = withBots(bot('reel', { task: { id: 1, title: 'A video', state: 'working' } }));
  const off = A.chief(busyHouse, { offline: true });
  assert.deepEqual([off.mood, off.tone, off.line], ['rest', 'off', 'The home computer is asleep']);
  // 2 · listening: the face changes, the line stays
  const work = A.chief(busyHouse);
  assert.deepEqual([work.mood, work.rank], ['work', 7]);
  const listen = A.chief(busyHouse, { listen: true });
  assert.deepEqual([listen.mood, listen.line], ['listen', work.line]);
  // 3 · an unread failure in the last 30 minutes is sad, and said once
  const failed = { ...base, bots: [bot('chief'), bot('reel', { unread: 2 })], events: [{ kind: 'task.failed', bot: 'reel', at: ago(4), data: { title: 'Flights' } }] };
  const sad = A.chief(failed);
  assert.deepEqual([sad.mood, sad.tone, sad.rank], ['error', 'wait', 3]);
  assert.equal(sad.line, "Reel couldn't finish \u201cFlights\u201d");
  assert.equal(A.chief({ ...failed, events: [{ kind: 'task.failed', bot: 'reel', at: ago(31), data: { title: 'Flights' } }] }).mood, 'idle', 'over half an hour old: over it');
  assert.equal(A.chief({ ...failed, bots: [bot('chief'), bot('reel')] }).mood, 'idle', 'read: over it');
  assert.equal(A.chief({ ...failed, events: [{ kind: 'task.unsure', bot: 'reel', at: ago(2), data: { title: 'Booking' } }] }).mood, 'error', 'unsure counts too');
  // 4 · a helper gone quiet, or the sign-in out, is worried — and beats waiting on you
  const worried = A.chief(withBots(bot('reel', { stuck: true, quietSince: ago(6) }), bot('scout', { task: { id: 2, title: 'Flights', state: 'needs_you' } })));
  assert.deepEqual([worried.mood, worried.line], ['worried', 'Reel has gone quiet']);
  assert.equal(A.chief(base, { signedOut: true }).line, 'Waiting for your sign-in');
  // 5 · waiting on you
  const ask = A.chief(withBots(bot('reel', { task: { id: 3, title: 'A video', state: 'needs_you' } })));
  assert.deepEqual([ask.mood, ask.tone, ask.line], ['ask', 'wait', 'Reel needs you']);
  const askCard = A.chief({ ...base, asks: [{ id: 1, bot: 'scout' }] });
  assert.deepEqual([askCard.mood, askCard.line], ['ask', 'Scout needs you']);
  // 6 · fresh finished work is pleased
  const done = { ...base, bots: [bot('chief'), bot('reel', { task: { id: 4, title: 'A video', state: 'working' } }), bot('scout')], events: [{ kind: 'task.done', bot: 'scout', at: ago(2), data: { title: 'Dinners' } }] };
  const pleased = A.chief(done);
  assert.deepEqual([pleased.mood, pleased.line], ['happy', 'Scout finished “Dinners”']);
  assert.equal(A.chief({ ...done, events: [{ kind: 'task.done', bot: 'scout', at: ago(6), data: { title: 'Dinners' } }] }).mood, 'work', 'five minutes gone: back to the work');
  // 7 · on the job, even while the account rests
  const resting = { ...busyHouse, resting: { chatgpt: Date.now() + 30 * min } };
  assert.deepEqual([mood(A.chief(resting)), A.chief(resting).tone], ['work', 'ok']);
  // 8 · the crew rests
  const rest = A.chief({ ...base, resting: { chatgpt: Date.now() + 30 * min } });
  assert.deepEqual([rest.mood, rest.tone], ['rest', 'off']);
  assert.match(rest.line, /resting until/);
  // And the whole ladder, top down: each row beats the one under it.
  const ladder = { ...failed, events: [...failed.events, { kind: 'task.done', bot: 'scout', at: ago(1), data: { title: 'Dinners' } }], bots: [...failed.bots, bot('scout', { stuck: true, quietSince: ago(6), task: { id: 9, title: 'Flights', state: 'needs_you' } })] };
  assert.equal(mood(A.chief(ladder)), 'error', 'sad over worried');
  assert.equal(mood(A.chief({ ...ladder, bots: (ladder.bots as Json[]).map((b) => (b.id === 'reel' ? { ...b, unread: 0 } : b)) })), 'worried', 'worried over ask');
  const askOver = withBots(bot('scout', { task: { id: 5, title: 'Flights', state: 'needs_you' } }), bot('pip', { task: { id: 6, title: 'Week', state: 'working' } }));
  assert.equal(mood(A.chief({ ...askOver, events: [{ kind: 'task.done', bot: 'pip', at: ago(1), data: { title: 'Week' } }] })), 'ask', 'ask over happy');
  assert.equal(mood(A.chief({ ...done, resting: { chatgpt: Date.now() + min } })), 'happy', 'happy over work');
  assert.equal(A.chief({ ...resting, asks: [{ id: 2, bot: 'reel' }] }).rank, 5, 'the rank rides along for the hold');
});

test('helpers wear the same story on their own faces', () => {
  const min = 60_000, ago = (m: number) => Date.now() - m * min;
  const s = { person: { id: 1 }, asks: [], tasks: [], resting: {}, events: [
    { kind: 'task.failed', bot: 'scribe', at: ago(3), data: { title: 'The note' } },
    { kind: 'task.done', bot: 'scout', at: ago(2), data: { title: 'Flights' } },
  ], bots: [
    { id: 'chief', display: 'Chief' },
    { id: 'scribe', display: 'Scribe', template: 'scribe', unread: 1 },                       // unread failure → sad
    { id: 'reel', display: 'Reel', template: 'reel', task: { id: 1, title: 'A video', state: 'needs_you' } }, // → ask
    { id: 'scout', display: 'Scout', template: 'scout' },                                     // fresh work → happy
    { id: 'pip', display: 'Pip', template: 'scout', stuck: true, quietSince: ago(7) },        // → worried
    { id: 'tracer', display: 'Tracer', template: 'tracer', task: { id: 2, title: 'An email', state: 'working' } }, // → work
    { id: 'muse', display: 'Muse', template: 'reel', pausedUntil: ago(-30) },                 // → rest
    { id: 'ink', display: 'Ink', template: 'reel' },                                          // → idle
  ] } as Json;
  const moodOf = (id: string) => A.crew(s).find((h) => h.id === id)!.mood;
  assert.deepEqual(['scribe', 'reel', 'scout', 'pip', 'tracer', 'muse', 'ink'].map(moodOf), ['error', 'ask', 'happy', 'worried', 'work', 'rest', 'idle']);
  assert.equal(moodOf('scribe') === 'error' && A.crew(s).find((h) => h.id === 'scribe')!.ring, '', 'sad is a face, not a ring');
  // The owner only test below keeps tracer visible; here the mapping is what matters.
});

test('the phone\'s tab icons: whole 9×9 grids of one ink, each its own shape, and no font glyphs in the tab bar', async () => {
  const { TABS } = await import('../web/src/art.ts');
  for (const [k, b] of Object.entries(TABS)) assert.ok(b.length === 9 && b.every((r) => /^[.x]{9}$/.test(r)), k);
  assert.equal(new Set(Object.values(TABS).map((b) => b.join())).size, Object.keys(TABS).length);
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app.slice(app.indexOf('const nav:'), app.indexOf('</View>', app.indexOf('s.tabbar'))), /[⌂☺▤↻▯]/);
});

test('a checkout asks for review first: the yes names the order, an unreadable total sends the person to do it themselves', () => {
  const ask = (detail: Json) => A.card({ id: 11, bot: 'scout', kind: 'permission', at: now, detail }, state);
  const known = ask({ effect: 'spend', words: 'Scout wants to place this order at shop.example: Garlic, 2 kg. Total $43.10.', spends: true,
    preview: { head: 'The order at shop.example', body: 'Garlic, 2 kg — $6.20\nTotal $43.10' }, order: { shown: '$43.10', known: true, dollars: true } });
  assert.equal(known.head, "Review Scout's order");
  assert.ok(known.review, 'the inbox opens the review before any yes');
  assert.deepEqual(known.choices.map((c) => c.label), ['Place order · $43.10', "Don't place order"], 'the yes names the action and the amount');
  assert.deepEqual(known.choices.filter((c) => c.body.answer === 'deny').map((c) => c.label), ["Don't place order"], 'deny says what it does');
  const unknown = ask({ effect: 'spend', words: "Scout wants to act on a checkout page at shop.example. I couldn't read the total on this page.", spends: true,
    order: { shown: '', known: false, dollars: false } });
  assert.equal(unknown.review, true);
  assert.ok(!unknown.choices.some((c) => c.body.answer === 'allow'), 'no yes without a readable total');
  assert.deepEqual(unknown.choices.map((c) => c.label), ["Don't place order", "I'll buy it myself"], 'the safe way out is offered');
  // The un-readable total is said once — in the order's own line — and the note only adds the consequence.
  unknown.preview = { head: 'The order at shop.example', body: 'Garlic, 2 kg \u2014 $6.20\nTotal: couldn\u2019t read it on this page' };
  const sheetLines = unknown.preview.body.split('\n');
  assert.equal(sheetLines.filter((l) => /couldn.t read/.test(l)).length, 1, 'the total is said once');
  // A spend without an order (a paid lookup, the words carry its cap) keeps a direct answer.
  const lookup = ask({ effect: 'spend', words: "Tracer wants to make a paid lookup with Finder, up to $0.50.", spends: true });
  assert.ok(!lookup.review);
  assert.deepEqual(lookup.choices.map((c) => c.label), ['OK, spend it', 'Not now']);
});

test('the crew\'s share is words, never a number; money is whole dollars and only for the owner', () => {
  for (const s of [{ choice: 'light', used: false }, { choice: 'light', used: true }, { choice: 'full', used: false }]) {
    const v = A.share({ share: s });
    assert.doesNotMatch(shown(v), FORBIDDEN);
    assert.doesNotMatch(v.today, /\d/, 'no counts, no percentages');
  }
  assert.match(A.share({ share: { choice: 'light', used: true } }).today, /start again tomorrow/);
  assert.equal(A.money({}), null, 'not the owner: nothing about money');
  assert.equal(A.money({ money: { cap: 20, spent: 0 } })!.month, 'This month: nothing spent yet.');
  assert.equal(A.money({ money: { cap: 20, spent: 4.5 } })!.month, 'This month: $4.50 of $20 spent.');
});

test('chats: Chief first, then the latest talk; last lines in plain words, never a path', () => {
  const now = Date.now();
  const s = {
    person: { id: 1 }, events: [], asks: [], tasks: [],
    bots: [
      { id: 'chief', display: 'Chief', last: { author: 'bot', text: 'Reel is on it.', at: now - 50_000 }, unread: 2 },
      { id: 'reel', display: 'Reel', template: 'reel', role: 'Makes demo videos', last: { author: 'system', text: 'Delivered files/mum-birthday_v2.mp4: 31 s', at: now - 1000 }, unread: 12 },
      { id: 'scout', display: 'Scout', template: 'scout', role: 'Researches', last: { author: 'person', text: 'find   rentals\nin Phuket', at: now - 9000 }, unread: 0 },
      { id: 'scribe', display: 'Scribe', template: 'scribe', role: 'Drafts letters', last: null, unread: 0 },
      { id: 'pip', display: 'Pip', template: 'scout', role: 'Plans', task: { id: 9, title: 'Plan the week', state: 'working' }, last: { author: 'bot', text: 'old', at: now - 99_000 }, unread: 0 },
    ],
  };
  const c = A.chats(s);
  assert.deepEqual(c.map((x) => x.id), ['chief', 'reel', 'scout', 'pip', 'scribe']);
  assert.equal(c[1].line, 'Sent “Mum birthday v2”');
  assert.equal(c[2].line, 'You: find rentals in Phuket');
  assert.equal(c[3].line, 'Working on: Plan the week');
  assert.equal(c[4].line, 'Drafts letters', 'nothing said yet: what it does');
  assert.equal(A.unreadBadge(c[1].unread), '9+');
  assert.doesNotMatch(shown(c), FORBIDDEN);
  const f = A.found(s, { messages: [{ id: 3, bot: 'reel', author: 'system', text: 'Delivered files/x.mp4', at: now }], things: [{ id: 4, bot: 'scout', title: 'Rentals in Phuket', at: now }] });
  assert.deepEqual(f.map((x) => [x.name, x.text]), [['Scout', 'Made “Rentals in Phuket”'], ['Reel', 'Sent “X”']]);
  assert.doesNotMatch(shown(f), FORBIDDEN);
});

test('reach from anywhere: one plain sentence per relay state, naming only the relay\'s host', () => {
  assert.equal(A.reach({ relay: '', relayStatus: 'off' }).on, false);
  for (const st of ['connecting', 'online', 'offline', 'refused', 'replaced']) {
    const r = A.reach({ relay: 'https://relay.example.com', relayStatus: st });
    assert.ok(r.on && r.words.length > 10, st);
    assert.doesNotMatch(r.words, /https?:|wss?:|\/relay\/v1|undefined/, st);
  }
  assert.equal(A.reach({ relay: 'https://relay.example.com', relayStatus: 'online' }).online, true);
});

test('reach it from anywhere: three plain states and numbered steps, and the phone says which step is missing', () => {
  // Whatever crewd sends, no address, port, command or network jargon reaches a screen.
  const TECH = /\d+\.\d+|:\d{2,5}\b|ws:|https?:|\b100\.x\b|tailscale (up|serve|funnel|status)|\bserve\b|\bfunnel\b|port|\bIP\b|undefined/i;
  const home = A.anywhere({ anywhere: 'home', hosts: ['127.0.0.1', '100.101.2.3'], tailscale: false });
  assert.equal(home.state, 'home');
  assert.match(home.words, /^Only at home\./);
  assert.deepEqual(home.steps.map((x) => x.split(' ').slice(0, 2).join(' ')), ['Install Tailscale', 'For each', 'On their']);
  const anywhere = A.anywhere({ anywhere: 'anywhere', hosts: ['100.101.2.3'] });
  assert.match(anywhere.words, /^Reachable from anywhere\./);
  assert.equal(anywhere.steps.length, 2, 'this computer is done; the steps for each person stay');
  const signin = A.anywhere({ anywhere: 'signin' });
  assert.match(signin.words, /^Tailscale needs signing in again/);
  assert.equal(A.anywhere(null).state, 'home');
  for (const x of [home, anywhere, signin]) assert.doesNotMatch(shown(x), TECH);
  assert.match(home.steps[1], /Share/, 'share the computer, not an invitation into the network');
  assert.doesNotMatch(shown(home), /invite/i);

  const away = [
    A.away({ home: true, tailnet: true, vpn: true }),
    A.away({ home: false, tailnet: false }),
    A.away({ tailnet: true, vpn: false }),
    A.away({ tailnet: true, vpn: true, anywhere: 'signin' }),
    A.away({ tailnet: true, vpn: true, anywhere: 'anywhere', knock: 'timeout' }),
    A.away({ tailnet: true, vpn: true, knock: 'refused' }),
    A.away({ tailnet: true, vpn: true, knock: 'answers' }),
    A.away({ tailnet: true, vpn: true, knock: 'timeout', peer: false }),
    A.away({ tailnet: true, vpn: true, knock: 'timeout', reached: { tailscale: Date.now() - 3_600_000 } }),
    A.away({ home: true, knock: 'refused' }),
    A.away({ home: true, knock: 'answers' }),
  ];
  assert.match(away[0], /on the home Wi-Fi, but the home computer doesn't answer at all/);
  assert.match(away[1], /share the computer with you in Tailscale/);
  assert.match(away[2], /Tailscale is off on this phone/);
  assert.match(away[3], /needs signing in again/);
  // No answer over Tailscale and nothing else known: never one cheerful guess, but both causes and who checks them.
  assert.match(away[4], /Either the computer is asleep or off, or it hasn't been shared with this phone's Tailscale account/);
  assert.match(away[4], /check both/);
  assert.match(away[5], /answers over Tailscale, but Crewhouse isn't running/, 'refused: the computer is there');
  assert.match(away[6], /getting back in touch/);
  assert.match(away[7], /isn't shared with this phone's Tailscale account: it checked/, 'the computer\'s own Tailscale said so');
  assert.match(away[8], /reached it that way before .*so sharing works/, 'sharing proven, so only then the likely cause');
  assert.match(away[9], /Either Crewhouse isn't running on it, or its setting for phones on this Wi-Fi is off/);
  assert.match(away[10], /getting back in touch/);
  assert.equal(new Set(away).size, away.length);
  for (const w of away) assert.doesNotMatch(w, /may be asleep or switched off\.$/, 'the old single guess is gone');
  for (const w of away) assert.doesNotMatch(w.replace(/\d{1,2}:\d{2}(\s?[ap]m)?/gi, ''), TECH); // a clock time is not a port
});

test('a knock on the computer\'s address ends within its bound: answers, refused, or timed out', async () => {
  const { createServer } = await import('node:net');
  const { createServer: web } = await import('node:http');
  const listen = (s: any) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const up = web((_q, res) => res.writeHead(404).end());
  const silent = createServer(() => {}); // takes the connection, never answers: like a peer that drops the packets
  const closed = createServer();
  const [a, b, c] = [await listen(up), await listen(silent), await listen(closed)];
  await new Promise((r) => closed.close(r));
  try {
    assert.equal(await A.knock(`ws://127.0.0.1:${a}/link`, 1500), 'answers');
    assert.equal(await A.knock(`ws://127.0.0.1:${c}/link`, 1500), 'refused');
    const t0 = Date.now();
    assert.equal(await A.knock(`ws://127.0.0.1:${b}/link`, 600), 'timeout');
    assert.ok(Date.now() - t0 < 1500, 'no spinner without an end');
  } finally { up.closeAllConnections(); up.close(); silent.close(); }
});

test('Settings, Phones: when each phone last reached the computer and how, and missing notifications said once', () => {
  assert.equal(A.reached({}), 'Not in touch yet');
  assert.match(A.reached({ reached: { home: Date.now() } }), /^Last reached it .* over home Wi-Fi · never from away yet$/);
  assert.match(A.reached({ reached: { home: Date.now() - 9e6, tailscale: Date.now() } }), /over Tailscale$/);
  assert.match(A.reached({ reached: { tailscale: Date.now() - 9e6, home: Date.now() } }), /over home Wi-Fi$/, 'the latest route, with away proven');
  assert.equal(A.pushWords({ push: 'ready' }), '');
  assert.match(A.pushWords({ push: 'missing' }), /^Phone notifications aren't switched on for this app yet/);
});

test('watches and hand-offs read as plain words, with only the page\'s host', () => {
  const s = { routines: [{ id: 1, bot: 'scout', name: 'Watch rentals.example.com', words: 'Every hour', next_at: Date.now() + 1000, state: 'on', kind: 'task', quiet: 1,
    watch: 'https://www.rentals.example.com/phuket?max=900&sort=new', history: [{ at: Date.now(), kind: 'routine.fired', watch: 'same' }, { at: Date.now() - 9e5, kind: 'routine.fired', watch: 'changed', task: 3 }] }] };
  const [r] = A.routines(s);
  assert.equal(r.watching, 'rentals.example.com');
  assert.match(r.last, /^Checked .*, no change$/);
  assert.equal(r.changes, 1);
  assert.doesNotMatch(shown(r), /phuket\?|https?:/);
  const [l] = A.lines({ messages: [{ id: 1, author: 'reel', text: 'find three songs' }] }, 'scout');
  assert.deepEqual([l.from, l.text], ['note', 'Reel asked: find three songs']);
});

test('not sure it worked stands apart: in the chat, in Chief\'s thread and in the trail', () => {
  const ls = A.lines({ messages: [{ id: 1, author: 'bot', text: 'Booked it.' }, { id: 2, author: 'bot', text: "Not sure it worked: I pressed Book, but saw no confirmation." },
    { id: 3, author: 'bot', text: "Pip isn't sure “Book the dentist” worked. Worth checking your email." }] }, 'pip');
  assert.deepEqual(ls.map((l) => !!l.unsure), [false, true, true]);
  assert.equal(A.step({ kind: 'task.unsure', data: { title: 'Book the dentist' } }), 'Not sure “Book the dentist” worked');
});

test('a new helper from Chief is a yes-or-no card with its own yes', () => {
  const s = { person: { id: 1 }, bots: [], asks: [{ id: 5, bot: 'chief', kind: 'propose', at: 1, title: 'Shall I take on a new helper? Pip: Watches rentals',
    detail: { words: 'Shall I take on a new helper? Pip: Watches rentals', yes: 'Yes, take Pip on', preview: { head: 'Pip, a new helper', body: 'Watches rentals.' } } }] };
  const [c] = A.cards(s);
  assert.deepEqual(c.choices.map((x: any) => x.label), ['Yes, take Pip on', 'Not now']);
  assert.ok(!c.choices.some((x: any) => /always/i.test(x.label)));
});

test('the week under the share is a third in words, never a number', () => {
  assert.equal(A.share({ share: { choice: 'light', used: false, week: 'fair' } }).week, 'This week the crew has used a fair part of what it may use of your ChatGPT.');
  assert.equal(A.share({ share: { choice: 'full', used: false, week: null } }).week, '');
  for (const w of ['small', 'fair', 'most']) assert.doesNotMatch(A.share({ share: { choice: 'light', week: w } }).week, /\d|%/);
});

test('a failed send keeps the words for a Retry; every chat keeps its own draft', () => {
  keepDraft('chief', 'Please keep this unsent draft');
  keepDraft('reel', 'a different chat');
  sent('chief', false, draftOf('chief').text); // the send failed: nothing left the composer
  assert.equal(draftOf('chief').text, 'Please keep this unsent draft', 'the failed send kept the words');
  assert.equal(draftOf('reel').text, 'a different chat', 'the other chat kept its own draft');
  keepDraft('chief', 'Please keep this unsent draft, with one more word'); // the person edits before retrying
  sent('chief', true, draftOf('chief').text); // the retry went out
  assert.equal(draftOf('chief').text, '', 'a sent message is no longer held');
  assert.equal(draftOf('never-typed').text, '', 'an untouched chat has no draft');
  keepDraft('chief', '');
  assert.equal(draftOf('chief').text, '', 'emptying the box clears the hold');
  // One Retry sends once: the Retry affordance is a plain button, never a second form submit (the duplicate-message
  // regression this pins sent the same words twice). And the pink "Not sent" line reads against its background.
  const parts = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'parts.tsx'), 'utf8');
  assert.match(parts, /send-failed[\s\S]{0,200}type="button"/, 'the composer\u2019s Retry is type="button"');
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  assert.ok(ratio(color.day.pinkInk, '#ffffff') >= 4.5, `the "Not sent" pink on white is ${ratio(color.day.pinkInk, '#ffffff').toFixed(2)}`);
});

test('the words people read make only claims Crewhouse can keep', () => {
  for (const f of ['web/src/main.tsx', 'web/src/flows.tsx', 'web/src/adapter.ts', 'mobile/App.tsx', 'src/crew.ts']) {
    const src = readFileSync(join(import.meta.dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /so it's safe|stays in this house|treat them like you|plenty left|never more than this in a month|that's us/i, f);
  }
  // The usage line describes the crew's own share, never a provider balance.
  assert.equal(A.meter({ share: { used: false } }), 'ChatGPT: the crew is within its share today');
  assert.equal(A.share({ share: { choice: 'light', used: false } }).today, 'The crew stays within the share you gave it.');
});

test('a dialog owns the keyboard: Tab cycles inside and wraps, and an outside focus still lands inside', () => {
  let on = '';
  const el = (name: string) => ({ name, focus: () => { on = name; } });
  const [a, b, c] = [el('a'), el('b'), el('c')];
  const list = [a, b, c];
  assert.equal(cycle(list, a), b, 'forward');
  assert.equal(cycle(list, c), a, 'forward wraps');
  assert.equal(cycle(list, c, true), b, 'back');
  assert.equal(cycle(list, a, true), c, 'back wraps');
  assert.equal(cycle(list, null), a, 'focus not yet inside: Tab moves in');
  assert.equal(cycle(list, null, true), c, 'Shift+Tab moves in at the end');
  assert.equal(cycle(list, el('outside')), a);
  assert.equal(cycle([], a), null, 'an empty dialog traps nothing, but nothing is in it');
  assert.equal(on, '', 'deciding a move focuses nothing by itself');
});

test('secondary text clears 4.5:1 against the surfaces it sits on, day and night', () => {
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // Card is translucent over the page, so white is its lightest possible read.
  for (const [name, pal, bgs] of [
    ['day', color.day, ['#ffffff', color.day.bg, color.day.soft]],
    ['night', color.night, [color.night.bg, color.night.solid, '#1a1626', color.night.soft]],
  ] as const) {
    for (const t of [pal.ink, pal.ink2, pal.mute, pal.okInk, pal.pinkInk]) {
      for (const b of bgs) assert.ok(ratio(t, b) >= 4.5, `${name}: ${t} on ${b} is ${ratio(t, b).toFixed(2)}`);
    }
  }
  // Both dialogs own the keyboard through the one hook.
  for (const f of ['web/src/parts.tsx', 'web/src/flows.tsx']) {
    assert.match(readFileSync(join(import.meta.dirname, '..', f), 'utf8'), /useDialogOwn\(/, f);
  }

});

test('a photo in a message is a picture, not words', () => {
  const [l] = A.lines({ messages: [{ id: 1, author: 'person', text: 'Here is a photo.\n[photo reel] files/photos/5-1.png' }] }, 'reel');
  assert.equal(l.text, '');
  assert.equal(l.files[0].kind, 'image');
  const [c] = A.lines({ messages: [{ id: 2, author: 'person', text: 'the school poster\n[photo pip] files/photos/6-1.jpg' }] }, 'chief');
  assert.equal(c.text, 'the school poster');
  assert.match(c.files[0].url, /\/files\/pip\/photos\/6-1\.jpg/);
  assert.equal(A.preview({ author: 'person', text: 'Here is a photo.\n[photo reel] files/photos/5-1.png' }), 'You: Photo');
  assert.doesNotMatch(shown([l, c]), FORBIDDEN);
});
