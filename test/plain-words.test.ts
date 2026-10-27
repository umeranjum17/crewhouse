// The plain-words gate (docs/plain-words.md): the copy a person reads keeps to short sentences and everyday words.
// It reads the same strings a person does — the adapter's view models (which the web and the phone both render),
// the screens' own literal copy, a template's role, and the exact words crewd writes on an approval card — and
// fails on the worst offenders: a banned word, or a sentence past the length bound. A reasoned exception list
// stays below, each entry naming why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../web/src/adapter.ts';
import { PATH_NOTE, path } from '../web/src/career.ts';
import type { Json } from '../web/src/api.ts';
import { effectOf, coversOf, type Seen } from '../src/policy.ts';

// A banned word is one a non-technical person should not have to read, with the everyday word to use instead.
// The rule (docs/plain-words.md): short sentences, everyday words, say what happens and what the person gets.
const BANNED: [RegExp, string][] = [
  // formal words STE100 rules out
  [/\butilis(e|es|ed|ing|ation)\b/i, 'use'],
  [/\bassist(s|ed|ing)?\b/i, 'help'],
  [/\bcommenc(e|es|ed|ing)\b/i, 'start'],
  [/\bterminat(e|es|ed|ing|ion)\b/i, 'stop'],
  [/\bobtain(s|ed|ing)?\b/i, 'get'],
  [/\brequir(e|es|ed|ing|ement|ements)\b/i, 'need'],
  [/\bensur(e|es|ed|ing)\b/i, 'make sure'],
  [/\bleverag(e|es|ed|ing)\b/i, 'use'],
  [/\bfunctionality\b/i, 'what it does'],
  [/\bdemonstrat(e|es|ed|ing)\b/i, 'show'],
  [/\badditional\b/i, 'more'],
  [/\bapproximately\b/i, 'about'],
  [/\bsufficient\b/i, 'enough'],
  [/\bpersonnel\b/i, 'people'],
  [/\binitiat(e|es|ed|ing)\b/i, 'start'],
  [/\bsubsequently\b/i, 'then'],
  [/\bwhilst\b/i, 'while'],
  [/\bamongst\b/i, 'among'],
  [/\bperuse\b/i, 'read'],
  [/\bendeavour(s|ed|ing)?\b/i, 'try'],
  [/\belucidate(s|d)?\b/i, 'explain'],
  [/\bcognizant\b/i, 'aware'],
  [/\bprior to\b/i, 'before'],
  [/\bin order to\b/i, 'to'],
  // machinery words a person should not read (the ones ui.test.ts does not already own)
  [/\bterminal\b/i, 'the programs you run'],
  [/\bpanes?\b/i, 'screens'],
  [/\bsourced\b/i, 'with its sources'],
  [/\bdrafts? only\b/i, 'you send them yourself'],
];

// Sentences in a person's copy run to at most this many words; past it, split them (docs/plain-words.md).
const MAX_WORDS = 30;

// A string allowed past the list, each with the reason it is the only wording that does the job. Keep it short.
const EXCEPTIONS: RegExp[] = [
  // The verbatim terminal approval (docs/ui-contract.md): the card's identity is the exact command crewd runs.
  /^The exact command$/,
  // Terminal Tess, the picked name for the one helper that runs terminal programs (ch-helper-names,
  // Firstmate decision B-plain): the fixed name itself carries the banned word.
  /\bTerminal Tess\b/,
];

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** The strings a person could read, recursively, from an adapter view model. */
function collect(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (!['url', 'href', 'icon', 'logo', 'key', 'id', 'path', 'body'].includes(k)) collect(v, out);
  return out;
}

/** Source literals a screen writes itself: comments off, quoted strings and JSX text (as test/ui.test.ts reads them). */
function prose(src: string): string[] {
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const lits = [...bare.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).filter((l) => !/^https?:/i.test(l.trim()));
  const jsx = [...bare.matchAll(/>([^<>{}\n]{3,})</g)].map((m) => m[1]).filter((t) => !/&&|\?\?|===|\.\w|\)\s*[?:]/.test(t));
  return [...lits, ...jsx];
}

/** Template-literal text with `${…}` dropped. Safe on src/policy.ts (no backtick-bearing regex). */
function templates(src: string): string[] {
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const out: string[] = [];
  for (const m of bare.matchAll(/`((?:\\.|[^\\`])*)`/g)) {
    let t = m[1], res = '', i = 0;
    while (i < t.length) {
      if (t[i] === '$' && t[i + 1] === '{') { let d = 1; i += 2; while (i < t.length && d) { if (t[i] === '{') d++; else if (t[i] === '}') d--; i++; } res += ' '; }
      else { res += t[i]; i++; }
    }
    out.push(res);
  }
  return out;
}

const TOKENY = /^[a-z0-9-./:_]+( [a-z0-9-./:_]+)*$/;
/** Is this a phrase a person reads, or code that only looks like words? */
function isCopy(s: string): boolean {
  const t = s.trim();
  if (!t || TOKENY.test(t)) return false;
  if (/[<>{};]|=>|\$\{|^\s*[({[]|\breturn\b|\bconst\b|function\s*\(|\w+\.\w+\(|\\[bdw]/.test(t)) return false;
  return /\s[A-Za-z]/.test(t) && (t.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= 2;
}

function offenders(strings: string[]): string[] {
  const bad: string[] = [];
  for (const raw of strings) {
    if (!isCopy(raw)) continue;
    const s = raw.replace(/\s+/g, ' ').trim();
    if (EXCEPTIONS.some((re) => re.test(s))) continue;
    for (const [re, fix] of BANNED) {
      const m = re.exec(s);
      if (m) bad.push(`“${m[0]}” → use “${fix}” in: ${s.slice(0, 120)}`);
    }
    for (const sentence of s.split(/(?<=[.!?])\s+/)) {
      const n = words(sentence).length;
      if (n > MAX_WORDS) bad.push(`sentence of ${n} words (max ${MAX_WORDS}): ${sentence.slice(0, 140)}`);
    }
  }
  return [...new Set(bad)];
}

// --- the surfaces ---
const root = join(import.meta.dirname, '..');
// demo.ts holds `?demo` sample content (realistic answers, sample souls), not UI copy: skip it. career.ts holds the
// sources' own words, quoted verbatim; its plain copy (titles, lines, notes, what each claim says) is checked below.
const screenFiles = readdirSync(join(root, 'web', 'src')).filter((f) => /\.tsx?$/.test(f) && !['adapter.ts', 'demo.ts', 'career.ts'].includes(f))
  .map((f) => join(root, 'web', 'src', f)).concat(join(root, 'mobile', 'App.tsx'));

test('a list in a chat preview reads as sentences, with no dash marker', () => {
  assert.equal(A.preview({ author: 'bot', text: 'Node.js LTS is v24 (patched 20 October 2026).\n- Active LTS: v24.22.1\n- Maintenance: v22.23.4' }), 'Node.js LTS is v24 (patched 20 October 2026). Active LTS: v24.22.1 Maintenance: v22.23.4');
});
test('every string the app shows keeps to the plain-words rule', () => {
  const now = Date.now();
  const bot = (id: string, extra: object = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), role: 'Keeps your invoices in order', template: id, runtime: 'claude', model: 'sonnet',
    thinks: [{ key: 'claude:sonnet', name: 'Claude Sonnet' }], state: 'on', computer: true, controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra });
  const state = {
    person: { id: 1, name: 'Umer', address: 'Umer', onboarded: 1 },
    bots: [
      bot('chief'),
      bot('reel', { task: { id: 5, title: 'A birthday video for mum', state: 'needs_you' }, stuck: true, quietSince: now - 6 * 60_000,
        step: { kind: 'run.tool', at: now, data: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } } }),
      bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, step: { kind: 'run.tool', at: now, data: { tool: 'Read', summary: '/home/alex/notes.md' } } }),
      bot('tracer', { template: 'tracer' }),
    ],
    templates: [{ id: 'chief' }, { id: 'reel', display: 'Reel', role: 'Makes videos' }, { id: 'scout', display: 'Scout', role: 'Researches a question' }],
    tasks: [
      { id: 4, bot: 'reel', title: 'Eid collage', state: 'done', updated_at: now, files: ['files/eid-collage.png'], result: 'Your collage is ready.' },
      { id: 3, bot: 'scout', title: 'Flights', state: 'failed', updated_at: now, files: [], result: 'Stopped on an error.' },
      { id: 8, bot: 'scout', title: 'Taxes', state: 'paused', updated_at: now, files: [], result: 'Waiting for you to sign in', wake_at: null },
    ],
    ideas: [
      { bot: 'scout', group: 'money', needs: ['web'], promise: 'I will search the unclaimed-money lists and get the claims ready.', ask: 'Search for money owed to me', title: 'Find money owed to you', line: 'checks the unclaimed-money lists' },
      { bot: 'reel', group: 'life', needs: [], promise: 'Send me three screenshots and I will make a video.', ask: 'Make a video' },
    ],
    asks: [
      { id: 1, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like your OK', detail: { effect: 'files', words: 'Reel wants to change a file in your Documents folder: “plan.txt”.', rule: 'change files', covers: 'your Documents folder' } },
      { id: 2, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like your OK', detail: { effect: 'spend', spends: true, words: 'Reel wants to place this order at shop.example. Total $43.10.', order: { shown: '$43.10', known: true, dollars: true }, preview: { head: 'Order', body: 'One thing — $43.10' } } },
      { id: 3, bot: 'scout', task_id: 6, kind: 'permission', at: now, title: 'Scout would like your OK', detail: { effect: 'send', press: true, words: 'Scout wants to act as you on example.com, a site you signed it in to.', preview: { head: 'Press “Claim”', body: 'Claim your refund' } } },
      { id: 4, bot: 'scout', task_id: 6, kind: 'permission', at: now, title: 'Scout has a question', detail: { effect: 'send', words: 'Scout wants to add “Dentist” to your Google Calendar.' } },
      { id: 5, bot: 'reel', task_id: null, kind: 'propose', at: now, title: 'Shall I take on Pip?', detail: { words: 'Shall I take on Pip?', hire: 'Pip', hireId: 'pip', role: 'Keeps your invoices in order', will_do: ['Sorts your invoices', 'Flags what is due'], wont_do: ['Never sends anything'], first_step: 'Nothing for now', first_job: 'Sort out my invoices', preview: { head: 'Pip', body: 'Keeps your invoices in order' } } },
      { id: 6, bot: 'chief', task_id: null, kind: 'propose', at: now, title: 'A new routine', detail: { words: 'Check the trains each morning?', routine: { schedule: '0 8 * * *' }, preview: { body: 'Every morning at 8.\nWhat: look at the trains.\nFirst run: tomorrow at 8.' } } },
      { id: 7, bot: 'chief', task_id: null, kind: 'propose', at: now, title: 'A plan to start', detail: { words: 'Here is my plan.', plan: { bot: 'scout', steps: ['Look at the listings', 'Shortlist three', 'Draft the emails'] } } },
      { id: 8, bot: 'reel', task_id: null, kind: 'propose', at: now, title: 'A suggestion', detail: { words: 'Reel would like to remember this.', preview: { head: 'How Reel would do it', body: 'Pick the best photos first.' } } },
      { id: 9, bot: 'scout', task_id: 6, kind: 'connect', at: now, title: 'Connect Gmail', detail: { app: 'gmail', words: 'Scout can do this with your Gmail. Connect it?' } },
      { id: 10, bot: 'chief', task_id: 6, kind: 'signin', at: now, title: 'Sign in to example.com', detail: { bot: 'scout', host: 'example.com', origin: 'https://example.com' } },
      { id: 11, bot: 'chief', task_id: 6, kind: 'unlock', at: now, title: 'A file is locked', detail: { bot: 'scout', files: ['files/inbox/march.pdf'], names: null, rule: 'job' } },
      { id: 12, bot: 'chief', task_id: 6, kind: 'style', at: now, title: 'Pick a style', detail: { pick: { deck: 'My deck', title: 'Hello', lines: ['One', 'Two'], styles: [{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'bold', label: 'Bold' }] } } },
      { id: 13, bot: 'chief', task_id: null, kind: 'mail', at: now, title: 'Send this one email?', detail: { send: { from: 'me@example.com', to: 'aunty@example.com', subject: 'Hello' }, preview: { body: 'Dear Aunty.' } } },
      { id: 14, bot: 'reel', task_id: 5, kind: 'permission', at: now, title: 'Reel would like to create a draft', detail: { effect: 'send', mail: { action: 'draft', id: 'abc12345' }, words: 'Reel wants to create a reply in your Gmail drafts. Nothing will be sent.', preview: { head: 'Draft reply', body: 'Dear Aunty.' } } },
      { id: 15, bot: 'scout', task_id: 6, kind: 'blocked', at: now, title: 'Scout has a question', detail: { question: 'Which photos, the Eid ones or the beach?' } },
    ],
    answered: [{ id: 20, bot: 'chief', kind: 'propose', answer: 'allow', answered_at: now - 1000, detail: { words: 'Approve the draft' } }],
    events: [
      { seq: 1, at: now, kind: 'run.tool', bot: 'reel', data: { task: 5, words: 'Searched the web for “school trips”' } },
      { seq: 2, at: now, kind: 'task.done', bot: 'reel', data: { task: 4, title: 'Eid collage' } },
      { seq: 3, at: now, kind: 'task.failed', bot: 'scout', data: { task: 3, title: 'Flights' } },
      { seq: 4, at: now, kind: 'file.delivered', bot: 'scout', data: { task: 6, path: 'files/plan.patch' } },
      { seq: 5, at: now, kind: 'memory.learned', bot: 'reel', data: { text: 'Mum likes tulips.' } },
      { seq: 6, at: now, kind: 'verify.result', bot: 'scout', data: { task: 6, patch: 'files/plan.patch', passed: false } },
      { seq: 7, at: now, kind: 'soul.changed', bot: 'reel', data: {} },
      { seq: 8, at: now, kind: 'run.allowed', bot: 'reel', data: { task: 5, permission: 'x', effect: 'send', words: 'Sent a message' } },
    ],
    routines: [
      { id: 1, bot: 'reel', kind: 'task', name: 'Weekly video', words: 'Every Monday at 9:00', on: '', state: 'on', next_at: now, quiet: false, history: [{ at: now - 1000, state: 'done', msg: 'Done.' }] },
      { id: 2, bot: 'chief', kind: 'digest', name: 'Morning brief', words: 'Every day at 8:00', on: '', state: 'on', next_at: now + 86400000, history: [] },
      { id: 3, bot: 'scout', kind: 'remind', name: 'Call the bank', words: 'One time', on: '', state: 'on', next_at: now, history: [] },
    ],
    connections: ['gmail'],
    house: { google: true, steps: null },
    share: { choice: 'light', used: false, week: 'small' },
    money: { cap: 20, spent: 4 },
    resting: { chatgpt: now + 3600_000 },
    installing: ['browser'],
    update: { version: '0.2.0', url: 'https://example.com/x' },
    showing: { reel: { what: 'trim a video', steps: 3 } },
    zone: 'Asia/Karachi',
    forgotten: [],
    room: { last: { author: 'bot', text: 'Scout passed the plan to Reel.', at: now }, busy: ['reel'] },
  } as Json;

  const linkView = { on: true, lan: false, pinned: false, tailscale: false, hosts: ['127.0.0.1'], relay: 'https://go.example.com', relayStatus: 'online', push: 'ready', asking: [] };
  const accounts = [{ account: 'chatgpt', name: 'ChatGPT', signedIn: true, restingUntil: 0 }];
  const texts: string[] = [
    ...collect(A.where(false)), ...collect(A.PUT), ...collect(A.CLOUD), ...collect(A.computer(null)),
    ...collect(A.atHome()), ...collect(A.trust), A.keptWhere, A.awake(),
    ...collect(A.shares('ChatGPT plan')), ...collect(A.share(state)), ...collect(A.money(state)), A.resting(state), A.meter(state),
    A.chief(state).line, ...collect(A.stripLine(state)), A.zoneNote(state),
    ...collect(A.crew(state)), ...collect(A.chats(state)),
    ...collect(A.needsYou(state)), ...collect(A.jobs(state)), ...collect(A.ideas(state)),
    ...collect(A.things(state)), ...collect(A.work(state)), ...collect(A.made(state, 'reel')),
    ...collect(A.homeCounts(state)), A.homeSummary(state), ...collect(A.status(state)), A.crewLine(state),
    ...collect(A.canned(state, 'status')), ...collect(A.canned(state, 'details', '- Vegetarian at home')),
    ...collect(A.quick(state, { box: { app: 'com.whatsapp', text: 'Friday 3pm www.x.top order', picked: '' } })),
    ...collect(A.quick(state, { box: null })),
    ...collect(A.routines(state)), ...collect(A.apps(state)), ...collect(A.crewRows(state, { purposes: { gmail: 'mail', herdr: 'code' }, starter: [] }, { ready: true, connected: true })),
    ...collect(A.herdr({ ready: true, connected: true })), ...collect(A.herdr({ ready: true, connected: false })), ...collect(A.herdr({ ready: false, connected: false, howto: 'Install Herdr, then open it once.' })),
    ...collect(A.aiList(accounts)), ...collect(A.account(accounts)), A.AI_ROUTES,
    ...collect(A.anywhere(linkView)), A.away({ home: true, knock: 'refused' }), A.away({ tailnet: false }), A.away({ tailnet: true, vpn: true, knock: 'answers' }),
    ...collect(A.reach(linkView)), A.reached({ reached: { home: now } }), A.pushWords(linkView), A.phoneTyped({ short: 'K7M2QX', code: '7KQ4-M2XP-9RTH', relay: 'https://go.example.com' }),
    A.gettingReady(state), ...collect(A.update(state)), ...collect(A.showing(state, 'reel')),
    ...collect(A.firstIdeas(state)), ...collect(A.homeSetup(state, accounts, linkView)),
    ...collect(A.receipt('draft.approved', { subject: 'Hello', to: 'aunty@example.com', channel: 'email', why: 'you said so' })),
    ...collect(A.reviews(state)), ...collect(A.answeredReceipts(state)),
    ...state.asks.flatMap((a: Json) => collect(A.card(a, state))),
  ];
  for (const b of state.bots) texts.push(...collect(A.helper(b, state.events, state.bots, state.tasks, state.asks)));
  // The career plan's own copy: everything but the quoted source words, their page names and dates.
  texts.push(...PATH_NOTE, ...path().flatMap((s) => [s.name, s.line, s.note ?? '', ...s.items.flatMap((i) => [i.title, i.line, i.note ?? '', ...i.claims.map((c) => c.says)])]));
  // The screens' own literal copy.
  for (const f of screenFiles) texts.push(...prose(readFileSync(f, 'utf8')));
  // A template's role, beside its helper on the crew and gallery.
  for (const t of readdirSync(join(root, 'templates'))) {
    const b = JSON.parse(readFileSync(join(root, 'templates', t, 'bot.json'), 'utf8'));
    if (b.role) texts.push(b.role);
  }
  // A tool's own words on the Apps screen (a plugin row's name, what it provides and its install line).
  for (const t of readdirSync(join(root, 'tools'))) {
    try {
      const m = JSON.parse(readFileSync(join(root, 'tools', t, 'tool.json'), 'utf8'));
      for (const s of [m.name, m.provides, m.install?.system, ...(m.asks ?? [])]) if (typeof s === 'string') texts.push(s);
    } catch { /* a tool without a manifest */ }
  }
  // The exact words crewd writes on an approval card (src/policy.ts).
  const seen: Seen = { bot: 'CTO', space: '/tmp/space', page: 'https://shop.example/checkout', signedIn: ['example.com'], filledHost: 'example.com', secret: ['/home/u/.ssh'],
    run: { herdr: { name: 'Herdr', free: ['pane list'], spend: ['pane send-text'] } }, apps: { calendar: { app: 'Google Calendar', title: 'Add an event', readOnly: false, destructive: false } } };
  for (const [tool, input] of [
    ['write', { path: '/home/u/Documents/plan.txt' }], ['read', { path: '/home/u/notes.md' }],
    ['browser', { args: ['click', 'https://shop.example/checkout'] }], ['browser', { args: ['press', 'e1'] }],
    ['herdr', { args: ['pane send-text'] }], ['herdr', { args: ['pane list'] }],
    ['calendar', { args: ['add', 'Dentist', 'tomorrow'] }], ['mail', { args: ['draft', 'abc12345', 'Dear Aunty.'] }],
  ] as [string, Record<string, unknown>][]) {
    const e = effectOf(tool, input, seen);
    if ('words' in e) { texts.push(e.words); if (e.covers) texts.push(e.covers); if (e.preview) texts.push(e.preview.head); }
  }
  texts.push(coversOf('herdr:look'), coversOf('files:/home/u/Documents'));

  // policy.ts's own person-facing words (its refusal reasons go to the model, not a person; scan what it writes anyway).
  texts.push(...prose(readFileSync(join(root, 'src', 'policy.ts'), 'utf8')), ...templates(readFileSync(join(root, 'src', 'policy.ts'), 'utf8')));

  const bad = offenders(texts);
  assert.deepEqual(bad, [], `plain-words rule (docs/plain-words.md) broke:\n${bad.join('\n')}`);
});

test('the plain-words gate catches a planted bad string', () => {
  // A guard on the gate itself: a banned word, an over-long sentence, and their clean rewrites.
  assert.ok(offenders(['Utilise the additional functionality to commence the work.']).length >= 3);
  assert.ok(offenders(['Use the extra parts to start the work.']).length === 0);
  assert.ok(offenders(['This sentence goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on.']).length === 1);
  assert.ok(offenders(['Short and clear.']).length === 0);
});
