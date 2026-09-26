// A made-up household in crewd's own shape, plus the fields the engine rework will add (docs/ui-contract.md).
// Open the app with ?demo (Nadia's phone), ?demo=umer (the owner), ?demo=hello (first run), ?demo=first (her first
// request, waiting for her sign-in), ?demo=answer (Chief's first answer), ?demo=plan (a plan without helpers),
// ?demo=resting, ?demo=connect (a helper asks for Google Calendar in chat), ?demo=nogoogle (Google not on for the house), ?demo=share (the crew's share used up today, $4 spent).
// &sheet=signin or &sheet=connect opens that sheet, and &phase=… pins it to one state.
import type { Json } from './api.ts';
import { describe, nextRun, parseSchedule } from '../../src/routines.ts';

const variant = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('demo') || 'nadia';
const now = Date.now();
const min = 60_000;
const me = variant === 'umer' ? 1 : 2;
const signin = ['signin', 'hello', 'first', 'work'].includes(variant);
const firstRun = ['first', 'answer', 'plan', 'work'].includes(variant);

const svg = (a: string, b: string, label: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="320" y="215" font-family="Nunito,sans-serif" font-weight="900" font-size="46" fill="#fff" text-anchor="middle">${label}</text></svg>`)}`;

const bot = (id: string, display: string, role: string, extra: Json = {}) => ({
  id, display, role, template: id, state: 'on', member: 1, computer: id !== 'chief', controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra,
});
const task = (id: number, b: string, title: string, state: string, extra: Json = {}) => ({ id, bot: b, title, state, member: me, updated_at: now - 20 * min, files: [], ...extra });

const bots = [
  bot('chief', 'Chief', 'Runs the crew and answers to you', { last: { author: 'bot', text: 'Scout has found three flights to Lahore. Shall I book the Friday one?', at: now - 4 * min }, unread: 1 }),
  bot('reel', 'Reel', 'Makes videos and posters from your photos', {
    task: task(41, 'reel', "Mum's birthday video", 'working'), step: { kind: 'task.progress', at: now - 2 * min, data: { text: 'Picking the music…' } },
  }),
  bot('scout', 'Scout', 'Finds things out and compares them for you', {
    task: task(42, 'scout', 'Flights to Lahore in December', 'working'), step: { kind: 'task.progress', at: now - min, data: { text: 'Comparing three airlines' } },
  }),
  bot('scribe', 'Scribe', 'Writes notes, emails and letters with you', { task: task(43, 'scribe', 'Thank-you note for Aunty Sara', 'needs_you') }),
  bot('pip', 'Pip', 'Keeps your week and the school stuff in order', { last: { author: 'bot', text: 'Sports day is in your calendar, with a reminder the night before.', at: now - 3 * 60 * min }, unread: 0 }),
  bot('tracer', 'Tracer', "Finds a person's work email or number", { task: task(44, 'tracer', "Sara Malik's work email", 'needs_you', { member: 1 }) }),
];

// A first run, or one helper's chat: nobody else is busy.
if (firstRun || variant === 'connect') for (const b of bots) Object.assign(b, { task: b.id === 'pip' && variant === 'connect' ? task(45, 'pip', "What's on this week?", 'needs_you') : null, step: undefined });

const asks = [
  { id: 7, bot: 'scribe', task_id: 43, kind: 'permission', at: now - 3 * min, member: me, title: 'Scribe would like to send an email', detail: {
    effect: 'send', thing: 'note', always: 'Aunty Sara', rule: 'send:aunty-sara', chief: 'A lovely note, if I may say so.',
    words: 'Scribe wants to email your thank-you note to Aunty Sara. Send it?',
    preview: { head: 'To Aunty Sara · from your Gmail', body: "Dear Aunty Sara, thank you so much for the lovely dinner on Sunday. Mum hasn't stopped talking about your biryani, and neither have I. Next time, it's at ours! With love, Nadia" },
  } },
  { id: 10, bot: 'scout', task_id: null, kind: 'propose', at: now - 4 * min, member: me, title: 'Scout would like to remember how to do this: Plan the week’s dinners, with a shopping list', detail: {
    words: 'Scout would like to remember how to do this: Plan the week’s dinners, with a shopping list',
    preview: { head: 'How Scout would do it', body: '1. Five dinners, vegetarian, nothing over forty minutes.\n2. One shopping list, grouped by aisle.\n3. Keep Friday for pizza night.' } } },
  { id: 11, bot: 'scout', task_id: 42, kind: 'permission', at: now - 30_000, member: me, title: '', detail: {
    effect: 'spend', spends: true, ...(variant === 'unknown' ? {
      words: "Scout wants to act on a checkout page at shop.example. I couldn't read the total on this page.",
      preview: { head: 'The order at shop.example', body: "Garlic, 2 kg — $6.20\nWhole milk (1 gal) x2\nBasmati rice 10 lb\nTotal: couldn’t read it on this page" },
      order: { shown: '', known: false, dollars: false },
    } : {
      words: 'Scout wants to place this order at shop.example: Garlic, 2 kg, Whole milk (1 gal) x2, Basmati rice 10 lb. Total $43.10.',
      preview: { head: 'The order at shop.example', body: 'Garlic, 2 kg — $6.20\nWhole milk (1 gal) x2 — $7.90\nBasmati rice 10 lb $24.00\nTotal $43.10' },
      order: { shown: '$43.10', known: true, dollars: true },
    }) } },
  { id: 8, bot: 'reel', task_id: 41, kind: 'connect', at: now - min, member: me, title: '', detail: { app: 'drive', words: 'Want a copy in the family Drive too?' } },
  { id: 12, bot: 'reel', task_id: 41, kind: 'question', at: now - 2 * min, member: me, title: '', detail: { question: 'Include the baby photos Mum sent, or just the recent ones?' } },
  { id: 13, bot: 'pip', task_id: null, kind: 'question', at: now - 6 * min, member: me, title: '', detail: { question: 'Sports day and the dentist trip are both on Friday morning. Keep both?' } },
  { id: 14, bot: 'chief', task_id: null, kind: 'propose', at: now - 30_000, member: me, title: "Every weekday at 8:00 am, Pip will plan the week's dinners.", detail: {
    words: "Every weekday at 8:00 am, Pip will plan the week's dinners.",
    routine: { bot: 'pip', schedule: 'weekdays 8am', task: "Plan the week's dinners and make the shopping list", quiet: true },
    preview: { head: 'A new routine', body: "Every weekday at 8:00 am\nPip will plan the week's dinners\nTells you only when something changed\nFirst time: Mon 8:00 am" } } },
  ...(me === 1 ? [{ id: 9, bot: 'tracer', task_id: 44, kind: 'permission', at: now - 2 * min, member: 1, title: '', detail: {
    effect: 'spend', spends: true, words: "Tracer wants to spend about $0.50 to find Sara Malik's work email. OK?" } },
  ...(new URLSearchParams(location.search).has('nohouse') ? [{ id: 46, bot: 'chief', task_id: null, kind: 'setup', at: now - 8 * min, member: 1, title: 'Sara would like Calendar', detail: { app: 'calendar', person: 'Sara' } }] : [])] : []),
  ...(variant === 'nogoogle' && me === 2 ? [{ id: 45, bot: 'pip', task_id: null, kind: 'connect', at: now, member: me, title: 'Connect Google Calendar', detail: { app: 'calendar', words: 'Let Pip use your Google Calendar' } }] : []),
];

function routine(id: number, b: string, name: string, schedule: string, st: string, kind = 'task') {
  const when = parseSchedule(schedule);
  return { id, bot: b, kind, name, words: describe(when), state: st, next_at: nextRun(when, now), history: st === 'on' ? [{ at: nextRun(when, now - 8 * 86_400_000), kind: 'routine.fired' }] : [] };
}
const ev = (seq: number, ago: number, kind: string, b: string, data: Json) => ({ seq, at: now - ago * min, kind, bot: b, data });
const events = [
  ev(1, 70, 'task.created', 'scout', { task: 40, title: "This week's dinners" }),
  ev(2, 52, 'file.delivered', 'scout', { task: 40, path: 'files/dinners-and-shopping-list.pdf' }),
  ev(3, 50, 'task.done', 'scout', { task: 40, title: "This week's dinners" }),
  ev(4, 30, 'task.created', 'scribe', { task: 43, title: 'Thank-you note for Aunty Sara' }),
  ev(5, 26, 'task.progress', 'scribe', { task: 43, text: 'Wrote the note for Aunty Sara' }),
  ev(6, 22, 'task.created', 'reel', { task: 41, title: "Mum's birthday video" }),
  ev(7, 20, 'task.progress', 'reel', { task: 41, text: 'Picked 8 photos from Eid' }),
  ev(8, 16, 'task.progress', 'reel', { task: 41, text: 'Found a gentle piano song' }),
  ev(9, 14, 'run.tool', 'reel', { task: 41, tool: 'Bash', summary: 'fc-list 2>&1 | head -20' }),
  ev(10, 13, 'task.progress', 'reel', { task: 41, text: 'Checked your fonts so the title looks right' }),
  ev(11, 3, 'ask.opened', 'scribe', { task: 43, kind: 'permission' }),
  ev(12, 2, 'task.progress', 'reel', { task: 41, text: 'Writing “Happy Birthday, Mum”' }),
  ev(13, 1, 'task.progress', 'scout', { task: 42, text: 'Comparing three airlines' }),
];

const state = {
  person: variant === 'umer' ? { id: 1, name: 'Umer', address: 'sir', onboarded: 1 }
    : { id: 2, name: 'Nadia', address: 'Nadia', onboarded: variant === 'hello' || variant === 'signin' ? 0 : 1 },
  members: [
    { id: 1, name: 'Umer', address: 'sir', quiet: '23:00-07:00' },
    { id: 2, name: 'Nadia', address: 'Nadia', quiet: '22:00-07:00' },
    { id: 3, name: 'Sam', address: null, quiet: null },
  ],
  bots,
  templates: [
    { id: 'chief', display: 'Chief' },
    { id: 'reel', display: 'Reel', role: 'Makes videos and posters from your photos' },
    { id: 'scout', display: 'Scout', role: 'Finds things out and compares them for you' },
    { id: 'scribe', display: 'Scribe', role: 'Writes notes, emails and letters with you' },
    { id: 'pip', display: 'Pip', role: 'Keeps your week and the school stuff in order' },
    { id: 'tracer', display: 'Tracer', role: "Finds a person's work email or number" },
  ],
  tasks: [
    task(40, 'scout', "This week's dinners", 'done', { updated_at: now - 50 * min, result: 'Seven dinners the kids will actually eat, and one shopping list sorted by aisle.', files: ['files/dinners-and-shopping-list.pdf'] }),
    task(38, 'reel', 'Eid photo collage', 'done', { updated_at: now - 26 * 60 * min, result: 'A collage of the twelve best Eid photos, sized for WhatsApp.', files: [svg('#ffc27a', '#ff7aa2', 'Eid Mubarak ♡')] }),
    task(36, 'scribe', 'Letter to the school about the trip', 'done', { updated_at: now - 50 * 60 * min, result: 'A short, polite letter asking to move Ayaan to the Friday group.', files: ['files/letter-to-school.pdf'] }),
    task(35, 'pip', 'Sports day in the calendar', 'done', { updated_at: now - 3 * 24 * 60 * min, result: 'Added sports day, Friday 9 am, with a reminder the night before.' }),
    task(46, 'scribe', 'Hotel guest reception', 'done', { updated_at: now - 22 * min, result: 'A workbook the front desk can run the day on: the dashboard, the booking log, the room board and the payments.', files: ['files/hotel-guest-reception.xlsx'] }),
  ],
  ideas: [
    { bot: 'pip', promise: 'Plan a birthday party', ask: 'Plan a birthday party for ' },
    { bot: 'chief', promise: "What's on this week?", ask: "What's on this week?" },
    { bot: 'reel', promise: 'Make a poster from photos', ask: 'Make a poster from these photos: ' },
  ],
  asks: variant === 'connect' ? [{ id: 11, bot: 'pip', task_id: 45, kind: 'connect', at: now, member: me, title: 'Connect Google Calendar', detail: { app: 'calendar', words: 'Let Pip use your Google Calendar' } }]
    : firstRun ? [] : asks.filter((a) => a.member === me),
  events,
  resting: variant === 'resting' ? { chatgpt: now + 95 * min } : {},
  routines: [
    routine(1, 'chief', 'Your week, every morning', 'every day 8:00', 'on', 'digest'),
    routine(2, 'scout', 'Plan the week’s dinners', 'every Saturday 10:00', 'on'),
    { ...routine(3, 'pip', 'Check the school newsletter', 'every Friday 16:00', 'paused'), quiet: 1 },
  ],
  connections: variant === 'connect' ? [] : ['drive', 'gmail'],
  share: { choice: 'light', used: variant === 'share' },
  money: { cap: 20, spent: variant === 'share' ? 4 : 0 },
  house: { google: variant !== 'nogoogle' && !new URLSearchParams(location.search).has('nohouse'), steps: [
    { state: 'checked', note: 'Google knows the project.' }, { state: 'missing', note: 'Gmail API is still off. Enable it.' },
    { state: 'said', note: 'Checked the first time someone connects.' }, { state: 'checked', note: 'Google took the key.' }] },
  desktops: { missing: [] },
};

// ?demo=unknown puts an order crewd couldn't price on Scout's card instead: no yes, the person finishes it themselves.
const first = "Plan this week's dinners, with a shopping list";
const pages: Record<string, Json> = {
  chief: firstRun ? { messages: [
    { id: 1, author: 'person', text: first },
    { id: 2, author: 'chief', text: 'Delighted, Nadia. To think, the crew uses your own ChatGPT, the same one you already use.' },
    ...(variant === 'plan' ? [{ id: 3, author: 'chief', text: "Your ChatGPT plan doesn't include helpers yet. Everything else in ChatGPT is fine. ChatGPT Plus includes it, or you can ask Umer to cover it." }] : []),
    ...(variant === 'answer' ? [
      { id: 3, author: 'chief', text: "You're signed in. Thank you, Nadia. On it now." },
      { id: 4, author: 'chief', text: 'Dinners this week: Mon dal & rice · Tue chicken wraps · Wed pasta bake · Thu fish tikka · Fri pizza night.\n\nShopping list (18 items): lentils, rice, onions, garlic, ginger, tomatoes, chicken thighs, wraps, lettuce, yoghurt, pasta, cheddar, passata, white fish, tikka paste, pizza bases, mozzarella, peppers.' },
      { id: 5, author: 'chief', text: 'Shall I do this every Sunday evening?', choices: ['Yes, Sundays', 'Not now'] },
    ] : []),
  ] } : variant === 'connect' ? { messages: [] } : { messages: [
    { id: 1, author: 'chief', text: `${variant === 'umer' ? 'Good evening, sir.' : 'Good evening, Nadia.'} Two small things need you. Scribe's note for Aunty Sara is ready to go, and Reel would like to save a copy of Mum's video. Scout expects to have flights within ten minutes.` },
    { id: 2, author: 'person', text: 'great, and can scout find somewhere nice for dinner on saturday too?' },
    { id: 3, author: 'chief', text: "Of course. I've asked Scout to look once the flights are done. Shall I tell him four people, near home?", choices: ['Yes, four, near home', 'Six people', 'Somewhere special'] },
    { id: 4, author: 'person', text: "every weekday morning, have Pip plan the week's dinners" },
    { id: 5, author: 'chief', text: "Gladly. Pip plans, you say yes — here it is; start it and the first one lands tomorrow morning." },
  ] },
  reel: { messages: [
    { id: 1, author: 'person', text: 'can you make a birthday video for mum from the eid photos? something sweet, like 20 secs' },
    { id: 2, author: 'bot', text: "Love this! I found 38 photos from Eid, and I'll pick the 8 happiest. What kind of music?", choices: ['🎹 Soft & sweet', '🎉 Upbeat', 'No music'] },
    { id: 3, author: 'person', text: 'soft and sweet please' },
    { id: 4, author: 'system', text: "Delivered files/happy-birthday-mum.mp4: Here's a first look 💐" },
  ], notes: '- Nadia likes soft piano music for family videos\n- Mum is "Ammi" in titles', tasks: [],
  soul: '# Reel\n\n## How you come across\n- Upbeat and practical: one sentence on what was made, then let the video speak.\n- Loves a tidy thirty seconds: clean cuts, steady pacing, nothing that shouts.\n- Makes a sensible call when something is missing, and says what was assumed.',
  skills: [{ name: 'make-reel', says: 'Turn photos and screenshots into a short video' }, { name: 'birthday-video', says: 'Make a birthday video from family photos', learned: true }] },
};
if (variant === 'connect') pages.pip = { messages: [
  { id: 1, author: 'person', text: "What's on this week?" },
  { id: 2, author: 'bot', text: 'I can do this with your Google Calendar.' },
] };
// A workbook, asked for in one line: one question back, then the finished file. The screens show what crewd read out of it.
pages.scribe = { messages: [
  { id: 1, author: 'person', text: 'create an excel for reception at the hotel' },
  { id: 2, author: 'bot', text: 'One thing before I build it: is this the desk\u2019s own day sheet, or the manager\u2019s log of every booking?' },
  { id: 3, author: 'person', text: "the desk's own day sheet" },
  { id: 4, author: 'bot', text: 'Then one workbook, ready to use: a dashboard for today, the booking and check-in log, the room and housekeeping board, and the payments. Each has an example row and dropdowns where you need them.' },
  { id: 5, author: 'system', text: 'Delivered files/hotel-guest-reception.xlsx: 4 sheets: Daily dashboard, Booking & check-in, Rooms & housekeeping, Payments' },
] };
/** What crewd read out of that workbook (src/workbooks.ts): the demo\u2019s own copy, in crewd\u2019s shape. */
const book = {
  sheets: [
    { name: 'Daily dashboard', total: 6, rows: [
      ['Today', 'Number', 'Notes'], ['Arrivals', '6', 'Two early, one at 4pm'], ['Departures', '4', 'One late checkout agreed'], ['Walk-ins so far', '1', 'Room 204 taken'], ['Rooms ready', '—', 'Worked out when you open it']] },
    { name: 'Booking & check-in', total: 34, rows: [
      ['Guest', 'Room', 'Arrival', 'Departure', 'Nights', 'Status', 'Rate', 'Paid'],
      ['Amina Khan', '204', '11 Oct', '14 Oct', '3', 'Checked in', '285', '285'],
      ['Bilal Sheikh', '108', '12 Oct', '13 Oct', '1', 'Booked', '120', '40'],
      ['Family Nazir', '301', '12 Oct', '16 Oct', '4', 'Waitlist', '520', '0']] },
    { name: 'Rooms & housekeeping', total: 40, rows: [
      ['Room', 'Type', 'Guest', 'State', 'Checked by', 'Notes'],
      ['204', 'Sea view double', 'Amina Khan', 'Checked in', 'Rani', 'Extra pillow asked for'],
      ['108', 'Standard single', '', 'Cleaning', '', 'Start after 11'],
      ['301', 'Family suite', '', 'To do', '', 'Hairdryer missing']] },
    { name: 'Payments', total: 12, rows: [
      ['Guest', 'Room', 'Bill', 'Paid', 'To pay', 'Way paid'],
      ['Amina Khan', '204', '285', '285', '0', 'Card'],
      ['Bilal Sheikh', '108', '120', '40', '80', 'Cash'],
      ['Family Nazir', '301', '520', '0', '520', 'Not paid yet']] },
  ],
};
for (const b of bots) pages[b.id] ??= { messages: [], notes: '', tasks: [] };
for (const [id, p] of Object.entries(pages)) p.trail = events.filter((e) => e.bot === id);

const accounts = [1, 2, 3].map((m) => ({ member: m, account: 'chatgpt', name: 'ChatGPT', signedIn: !(signin && m === me) || (variant === 'work' && m === me),
  restingUntil: variant === 'resting' && m === me ? now + 95 * min : 0, notIncluded: variant === 'plan' && m === me, work: variant === 'work' && m === me ? 'nadia@acme.com' : false,
  signIn: variant === 'signin' && m === me ? { state: 'waiting', via: 'browser', url: 'https://auth.openai.com/oauth/authorize' } : null }));

let calls = 0;
export async function demoCall(method: string, path: string, _body?: Json) {
  // "offline": the home computer never answers; "lost": it answers once, then goes quiet.
  if (variant === 'offline' || (variant === 'lost' && calls++ > 0)) throw new TypeError('Failed to fetch');
  if (method === 'GET' && path === '/api/state') return state;
  const b = /^\/api\/bots\/([a-z0-9-]+)(?:\?.*)?$/.exec(path);
  if (method === 'GET' && b) return { ...pages[b[1]], bot: bots.find((x) => x.id === b[1]) };
  // A word across the threads (the made-up household): what search needs to land on the matching line.
  if (method === 'GET' && path.startsWith('/api/search')) {
    const q = decodeURIComponent(path.split('q=')[1] ?? '').replace(/\+/g, ' ').toLowerCase();
    const messages = Object.entries(pages).flatMap(([bot, p]) => ((p.messages ?? []) as Json[]).filter((m: Json) => String(m.text).toLowerCase().includes(q))
      .map((m: Json, i: number) => ({ id: m.id, bot, author: m.author, text: String(m.text).slice(0, 200), at: now - (i + 1) * min })));
    const things = state.tasks.filter((t: Json) => `${t.title} ${t.result ?? ''}`.toLowerCase().includes(q)).map((t: Json) => ({ id: t.id, bot: t.bot, title: t.title, at: t.updated_at }));
    return { messages: messages.slice(0, 50), things: things.slice(0, 20) };
  }
  if (method === 'GET' && path.startsWith('/api/accounts')) return accounts;
  // The workbook crewd reads for the card and the panel (src/workbooks.ts): the tabs, headings and first rows.
  if (method === 'GET' && path.startsWith('/api/workbook')) return book;
  if (method === 'GET' && path === '/api/about') return { notes: '- Vegetarian at home\n- Two children: Zara (9) and Ali (6)\n- Prefers weekend plans before Thursday' };
  // ?demo=home / ?demo=signin-again: Settings, Phones before Tailscale, and with it signed out.
  if (method === 'GET' && path === '/api/phones/link') return { on: true, lan: false, pinned: false, tailscale: variant !== 'home', relay: '', relayStatus: 'off', asking: [], push: variant === 'home' ? 'missing' : 'ready',
    anywhere: variant === 'home' ? 'home' : variant === 'signin-again' ? 'signin' : 'anywhere' };
  if (method === 'POST' && path === '/api/phones/pair') return { qr: 'crewhouse-demo', expires: Date.now() + 120_000 };
  if (method === 'POST' && path === '/api/house/ask') return { ok: true };
  if (method === 'GET' && path === '/api/phones') return [{ id: 1, name: "Nadia's phone", member: 2, seen: now - 5 * min, reached: { home: now - 5 * min }, push: 'on' },
    { id: 2, name: "Umer's phone", member: 1, seen: now - 2 * 60 * min, reached: { home: now - 26 * 60 * min, tailscale: now - 2 * 60 * min }, push: 'off' }];
  if (method === 'POST' && path.startsWith('/api/connections/')) return { url: 'https://accounts.google.com/' };
  if (method === 'GET' && path.startsWith('/api/connections/')) return { state: 'waiting' };
  if (method === 'GET' && path.startsWith('/api/schedule')) {
    const text = decodeURIComponent(path.split('text=')[1] ?? '').replace(/\+/g, ' ');
    try {
      const when = parseSchedule(text || 'every Monday 9:00');
      const next = nextRun(when, now);
      return { words: describe(when), next, first: new Date(next).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', weekday: 'short' }).replace(/ [AP]M/i, (m) => m.toLowerCase()) };
    } catch { return { bad: true };
    }
  }
  return { ok: true };
}
