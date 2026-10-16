// The "no technical text" gate: whatever crewd sends, nothing a person reads may show a command, a file path,
// an engine or model name, a usage percentage, a raw prompt or terminal text (persona brief rule 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDERS } from '../src/accounts.ts';
import { PROVIDERS as ROUTES, route } from '@byokit/accounts';
import * as A from '../web/src/adapter.ts';
import { color } from '../web/src/tokens.ts';

const now = Date.now();

/** The phone app's screens: App.tsx, the office room beside it, and the bubble's panel. */
const PHONE_SCREENS = ['App.tsx', 'src/office.tsx', 'src/panel.tsx'].map((f) => join(import.meta.dirname, '..', 'mobile', f));

const bot = (id: string, extra = {}) => ({ id, display: id[0].toUpperCase() + id.slice(1), role: 'Makes demo videos from screenshots', template: id, runtime: 'claude', model: 'sonnet',
  thinks: [{ key: 'claude:sonnet', name: 'Claude Sonnet' }], state: 'on', computer: true, controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra });
// The owner's screenshot, as crewd sends it today: a raw fc-list approval, "Claude · 9% of 5h used", the prompt as the task.
const state = {
  person: { id: 1, name: 'Umer', address: 'Umer', onboarded: 1 },
  bots: [
    bot('chief'),
    bot('reel', { task: { id: 5, title: 'Make a birthday video for mum', state: 'needs_you' }, stuck: true, quietSince: now - 6 * 60_000,
      step: { kind: 'run.tool', at: now, data: { tool: 'Bash', summary: 'fc-list 2>&1 | head -20' } } }),
    bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, step: { kind: 'run.tool', at: now, data: { tool: 'Read', summary: '/home/alex/Crewhouse/bots/scout/notes.md' } } }),
    bot('tracer', { template: 'tracer' }),
  ],
  templates: [{ id: 'chief' }, { id: 'reel', display: 'Reel', role: 'Makes videos' }, { id: 'tracer', display: 'Tracer', role: 'Finds emails' }],
  tasks: [
    { id: 4, bot: 'reel', title: 'Eid collage', state: 'done', updated_at: now, files: ['files/eid-collage.png'], result: 'Saved to /home/alex/Crewhouse/bots/reel/files/eid-collage.png with `magick montage -tile 4x3`' },
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
  resting: { codex: now + 3600_000, ollama: 0 },
  routines: [{ id: 1, bot: 'reel', kind: 'task', name: 'Weekly demo', words: 'Every Monday at 9:00', state: 'on', next_at: now, brain: 'claude:haiku', history: [] }],
};

test('Chats run as mock 2: Chief with his asks as a count, the crew by Office group (latest first inside one), The crew last', () => {
  const said = (at: number) => ({ last: { author: 'bot', text: 'Hello.', at } });
  const s = { ...state, room: {}, events: [], ideas: [], routines: [],
    bots: [bot('chief', said(now)), bot('tracer', { template: 'tracer', ...said(now) }), bot('scribe', { template: 'scribe', ...said(now - 1000) }),
      bot('scout', { task: { id: 6, title: 'Flights', state: 'working' }, ...said(now - 5000) }), bot('reel', { task: { id: 5, title: 'Video', state: 'working' }, ...said(now - 2000) }),
      bot('pip', { template: 'pip', task: { id: 7, title: 'Taxes', state: 'needs_you' }, ...said(now - 9000) })],
    tasks: [{ id: 4, bot: 'scribe', title: 'Cover letter', state: 'done', updated_at: now, files: ['files/letter.docx'], result: 'Your cover letter is ready.' }],
    asks: [{ id: 9, bot: 'pip', task_id: 7, kind: 'permission', at: now, title: 'Pip would like to read a file', detail: { tool: 'Read', summary: 'taxes.pdf' } }] };
  const rows = A.chats(s);
  assert.deepEqual(rows.map((c) => [c.id, c.status]), [['chief', 'Needs you'], ['pip', 'Waiting'], ['reel', 'At work'], ['scout', 'At work'],
    ['scribe', 'Done'], ['tracer', 'Free'], ['room', '']]);
  assert.deepEqual(rows.map((c) => c.asks), [1, 0, 0, 0, 0, 0, 0], 'only Chief carries a badge: the asks in his thread');
});

test('the account list is the one crewd really serves: every route, none made up', () => {
  // The honest matrix: every subscription route /api/accounts serves renders on Settings — no route hidden,
  // none invented, and ChatGPT (the verified front door) first.
  const providers = Object.keys(PROVIDERS);
  assert.deepEqual(A.AIS.map((ai) => ai.key), providers);
  assert.equal(A.AIS[0].key, 'chatgpt');
  const rows = providers.map((key) => ({ account: key, name: key, signedIn: false, restingUntil: 0 }));
  for (const ai of A.AIS) {
    const g = A.account(rows, ai.key);
    assert.equal(g.state, 'signed-out');
    assert.ok(!/connected|ready/i.test(JSON.stringify(g)), 'a route without an account never reads as tested');
  }
  // The honest word under the list: a plan they already pay for, and the pay-for-each-use kind is not set up here.
  assert.match(A.AI_ROUTES, /plan you already pay for/, 'the limitation is a person\'s words');
  assert.doesNotMatch(A.AI_ROUTES, /API key|bill|\broutes?\b|provider/i, 'no billing or machinery words under the account list');
  for (const ai of A.AIS) assert.doesNotMatch(ai.cli ?? '', /\bCLI\b/, `${ai.name}'s prerequisite names a product, never an acronym`);
  // Name and billing come from the kit's own catalogue, so a new kit route lands labelled and nothing drifts.
  for (const ai of A.AIS) if (ROUTES[ai.key]) assert.deepEqual([ai.name, ai.billing], [ROUTES[ai.key].name, ROUTES[ai.key].billing], `${ai.key} is the kit's own row`);
  // OpenCode Go's row comes from the kit's plan-key route, like crewd's own list (src/accounts.ts).
  const GO = route('opencode:plan_key:opencode-go'), GO_KEY = GO.aliases?.[0] ?? 'opencode-go';
  assert.deepEqual(A.AIS.filter((ai) => ai.key === GO_KEY).map((ai) => [ai.name, ai.billing]), [[GO.name, GO.billing]], "OpenCode Go's row is the kit's own");
  // Every route says honestly how the person pays: a plan they already have, or charged per use.
  const listed = A.aiList(rows).more.map((r) => ({ name: r.ai.name, cli: r.ai.cli, says: r.says }));
  for (const row of listed) {
    if (row.cli) continue; // this one needs a tool installed first; its billing shows in the line under the list
    const api = ROUTES[providers.find((k) => ROUTES[k]?.name === row.name) ?? '']?.billing === 'api';
    assert.match(row.says, api ? /charged per use/i : /your own .* plan/i, `${row.name}'s row states its billing honestly`);
  }
  assert.deepEqual(listed.find((r) => r.name === 'OpenRouter'), { name: 'OpenRouter', cli: undefined, says: 'Not set up. Charged per use on your OpenRouter account.' });
  const phone = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.match(phone, /<Label>Your AI accounts<\/Label>/);
  assert.match(phone, /\{row\(A\.AIS\[0\]\)\}/, 'ChatGPT, the front door, is named first');
  assert.match(phone, /\{A\.AIS\.slice\(1\)\.map\(row\)\}/, 'the phone shows the same six routes, not a second list');
  assert.match(phone, /\{A\.AI_ROUTES\}/, 'the pay-for-each-use limitation reaches the phone');
  assert.match(phone, /Signing in happens on the home computer, in Settings\. This phone can't tell whether an account is signed in\./, 'no invented phone sign-in state');
  assert.match(phone, /onPress=\{\(\) => go\(\{ view: 'phone' \}\)\} accessibilityRole="button" accessibilityLabel="Check AI account sign-in/, 'Home leads to the disclosure');
  // The resting sentence names the account when it can and stays generic when it can't — both machinery-free.
  assert.match(A.resting({ resting: { chatgpt: now + 60_000 } }), /^Your ChatGPT is resting until /);
  assert.match(A.resting({ resting: { notARoute: now + 60_000 } }), /^Your AI accounts are resting until /);
  // The runs-at-home line never names one account: with several sign-ins it cannot know which a job will use.
  for (const line of A.atHome()) assert.doesNotMatch(line, /ChatGPT|Grok|Copilot|OpenRouter|MiniMax|Claude|OpenCode Go/, 'the privacy line names no provider');
  assert.match(A.atHome()[2], /goes to the AI plan you picked/, "a job's words go to the picked plan");
});

test('the screens read view models only, and the mono face draws art only', () => {
  const dir = join(import.meta.dirname, '..', 'web', 'src');
  // The phone app's screens too (mobile/App.tsx), which read the same adapter.
  for (const f of [...readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)), ...PHONE_SCREENS]) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /detail\.(summary|pane|rule|tool)|\.thinks\b|\.limits\b|\.runtime\b|\bclaude\b|terminal/i, f);
    if (f.includes('mobile')) assert.doesNotMatch(src, /monospace/, 'the phone app draws its art as dots, and sets no text in mono');
    else assert.doesNotMatch(src, /<pre(?![^>]*className="art)/, f);
  }
  const css = readFileSync(join(dir, 'styles.css'), 'utf8');
  for (const rule of css.split('}')) {
    if (!/var\(--art\)|monospace/.test(rule)) continue;
    // Mono draws the art, standalone times/counts in a column (.time), and inline code chips
    // in chat answers (.chat-code) - never other reading text.
    assert.match(rule, /(\.art\b|\.ascii\b|\.time\b|\.chat-code\b|--art:|@font-face)/, `mono type outside the art: ${rule.trim().slice(0, 80)}`);
  }
});


test('no jargon anywhere: the machinery\'s words never reach a person', () => {
  // The captain's sweep (CREWHOUSE-APK-04): relay, link, Noise, ticket, grant, host, daemon, crewd, engine, token,
  // port and stub never show in the screens' own words or the adapter's views. Tailscale is the one allowed name,
  // and only in the two places a person is asked to set it up or switch it on (adapter.anywhere/away).
  const JARGON = /\b(relay|noise|tickets?|grants?|daemon|crewd|engine|tokens?|ports?|stub|hosted?|links?|host)\b/i;
  // A literal of all lower-case tokens (class names, import paths, hrefs) is never read as words on a screen.
  const TOKENY = /^[a-z0-9-./:]+( [a-z0-9-./:]+)*$/;
  const prose = (src: string) => {
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' '); // comments are for us
    const lits = [...bare.matchAll(/(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).filter((l) => !/^https?:/i.test(l.trim()));
    // JSX text: anything between tags that is not an expression fragment (&&, ===, x.y, "?) :" are code, not copy).
    const jsx = [...bare.matchAll(/>([^<>{}\n]{3,})</g)].map((m) => m[1]).filter((t) => !/&&|\?\?|===|\.\w|\)\s*[?:]/.test(t));
    return [...lits, ...jsx].filter((l) => !TOKENY.test(l.trim()));
  };
  const srcDir = join(import.meta.dirname, '..', 'web', 'src');
  for (const f of ['main.tsx', 'parts.tsx', 'flows.tsx', 'office.tsx', 'dialog.ts', 'draft.ts', 'kept.ts', 'chat-md.ts', 'demo.ts', 'adapter.ts'])
    for (const w of prose(readFileSync(join(srcDir, f), 'utf8')))
      assert.doesNotMatch(w, JARGON, `${f} shows: ${w.trim().slice(0, 80)}`);
  for (const f of PHONE_SCREENS) for (const w of prose(readFileSync(f, 'utf8'))) assert.doesNotMatch(w, JARGON, `${f} shows: ${w.trim().slice(0, 80)}`);
  const app = readFileSync(join(import.meta.dirname, '..', 'mobile', 'App.tsx'), 'utf8');
  assert.doesNotMatch(app, /Use a relay code|Relay address|Short relay code|legacy/, 'the phone pairs through one code box; no relay toggle');
  // The adapter is everything a person reads: no view says a machinery word, and Tailscale appears only in the
  // away explainer on the phone — Settings itself never names it.
  const linkView = { on: true, lan: false, pinned: false, tailscale: false, hosts: ['127.0.0.1'], relay: 'https://go.example.com', relayStatus: 'online', push: 'ready', asking: [] };
  const views: Record<string, unknown> = {
    crew: A.crew(state), cards: A.cards(state), chats: A.chats(state), things: A.things(state), ideas: A.ideas(state), jobs: A.jobs(state),
    reach: A.reach(linkView), reached: A.reached({ reached: { home: now, tailscale: now - 9e6, relay: now - 5e6 } }),
    push: A.pushWords(linkView), typed: A.phoneTyped({ short: 'K7M2QX', code: '7KQ4-M2XP-9RTH', relay: 'https://go.example.com' }),
    anywhere: A.anywhere(linkView), away: A.away({ tailnet: true, vpn: true, knock: 'timeout', reached: { tailscale: now - 3.6e6 } }),
    status: A.status(state), crewLine: A.crewLine(state),
    profile: A.profileParts('I run a bakery for local families. My business is called Morning Loaf.'),
    bubble: [null, 'off' as const, { text: 'Friday 3pm www.x.top order', picked: '' }, { text: 'a', picked: 'a' }].flatMap((box) => A.quick({ ...state, connections: [] }, { box })).map(({ label, ask }) => ({ label, ask })),
    canned: [A.canned(state, 'status'), A.canned(state, 'details', '- Vegetarian at home'), A.secretOf('PIN 1234'), A.secretOf('www.x.top')],
  };
  const words = (x: unknown): string => typeof x === 'string' ? x : Array.isArray(x) ? x.map(words).join(' ')
    : x && typeof x === 'object' ? Object.entries(x).filter(([k]) => k !== 'url' && k !== 'at').map(([, v]) => words(v)).join(' ') : '';
  for (const [name, v] of Object.entries(views)) assert.doesNotMatch(words(v), JARGON, name);
  assert.match(words(views.typed), /^K7M2QX-7KQ4-M2XP-9RTH@go\.example\.com$/, 'the typed code is one string, the mailbox carried inside it');
  assert.doesNotMatch(words(views.reach) + words(views.reached) + words(views.push) + words(views.typed) + words(views.anywhere), /tailscale/i, 'Tailscale is named only where it is set up');
  assert.match(words(views.away), /Tailscale/, 'away may name Tailscale');
  // The failure words are people words too: the phone's pairing lines and the toasts on both ends.
  for (const w of ["That code has run out. Show a new one on your computer, then try again.", "That code didn't match. Show a fresh one and try again.",
    "Couldn't reach your computer. Check it's awake, then try again.", "That didn't go through. Check the code, then try again.",
    'That code is missing where to look it up. Copy the whole code from your computer, then try again.',
    "Can't reach the home computer right now. Check it's on, then try again.", 'That didn’t work. Please try again.'])
    assert.doesNotMatch(w, JARGON);
});

test('the one plain rule for a helper\'s files is asked on the card, in plain words, and a forgotten file keeps no card', () => {
  const ask = { id: 8, bot: 'chief', task_id: 5, kind: 'unlock', at: now, title: 'A file is locked', detail: { bot: 'reel', files: ['files/inbox/march.pdf'], all: ['files/inbox/march.pdf'] } };
  const c = A.card(ask, state);
  assert.match(c.keep!.line, /not locked any more, so it can sit in Reel's folder for good/, 'the rule, said once, in plain words');
  assert.deepEqual(c.keep!.options.map((o) => [o.label, o.rule]), [['Remove it when the job ends', 'job'], ['Keep them', 'keep']], 'and the person\'s pick');
  assert.deepEqual(c.choices.map((x) => x.label), ['Unlock the file', 'Not now']);
  // A kept copy reads by the name of the file it came from; only the person's own documents and the copies are theirs to forget.
  assert.equal(A.pretty('files/unlocked/files%2Finbox%2Fmarch.pdf'), 'March');
  assert.ok(A.sentFile(A.fileView('reel', 'files/inbox/3-1.pdf')) && A.sentFile(A.fileView('reel', 'files/unlocked/files%2Finbox%2Fmarch.pdf')));
  assert.ok(!A.sentFile(A.fileView('reel', 'files/letter.docx')));
  // A file the person forgot is gone from the folder, so the chat keeps no card for it.
  const page = { messages: [{ id: 1, bot: 'reel', author: 'person', text: 'Here is a file.\n[file reel] files/inbox/3-1.pdf 12000B statement.pdf', at: now }] };
  const kept = A.lines(page, 'reel', state).flatMap((l) => l.files.map((f) => f.name));
  assert.deepEqual(kept, ['statement.pdf']);
  assert.deepEqual(A.lines(page, 'reel', { ...state, forgotten: [{ bot: 'reel', path: 'files/inbox/3-1.pdf' }] }).flatMap((l) => l.files), []);
});

test('reading text clears 4.5:1 against the surfaces it sits on, day and night', () => {
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const [name, pal, bgs] of [
    ['day', color.day, [color.day.surface, color.day.bg, color.day.sunken, color.day.cellIn, color.day.cellCalc]],
    ['night', color.night, [color.night.bg, color.night.surface, color.night.sunken, color.night.cellIn, color.night.cellCalc]],
  ] as const) {
    for (const t of [pal.ink, pal.ink2]) {
      for (const b of bgs) assert.ok(ratio(t, b) >= 4.5, `${name}: ${t} on ${b} is ${ratio(t, b).toFixed(2)}`);
    }
  }
  // Both dialogs own the keyboard through the one hook.
  for (const f of ['web/src/parts.tsx', 'web/src/flows.tsx']) {
    assert.match(readFileSync(join(import.meta.dirname, '..', f), 'utf8'), /useDialogOwn\(/, f);
  }

});
