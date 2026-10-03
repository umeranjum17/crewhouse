// A personal assistant demo in crewd's own shape, plus the fields the engine rework will add (docs/ui-contract.md).
// Open the app with ?demo (Umer's crew), ?demo=hello (first run), ?demo=first (his first
// request, waiting for his sign-in), ?demo=answer (Chief's first answer), ?demo=plan (a plan without helpers),
// ?demo=resting, ?demo=connect (a helper asks for Google Calendar in chat), ?demo=nogoogle (Google not set up yet), ?demo=share (the crew's share used up today, $4 spent), ?demo=claim (Scout asks to fill a line of an unclaimed-money claim),
// ?demo=return (Scout asks to press a shop's Start return), ?demo=chase (Scout's chase email as a draft to send), ?demo=renewal (Scout's renewal warning and the cancellation email as a draft to send), ?demo=day (Scout's plan of the day, three things in order),
// ?demo=b1 (the B1 mocks' household), ?demo=paper (Scout's reply to the school as a draft to approve — the paper, sorted), ?demo=meals (this week's dinners shopped into a cart, waiting on its checkout card),
// ?demo=watch (the name watch heard: one source-linked line), ?demo=neighbour (the weekly brief as a document), ?demo=brief (the month in brief as a document),
// ?demo=office (Home's office with first looks on the desks), ?demo=calm (nothing on the go),
// ?demo=fresh (the Chief-only Home a new person gets: no helpers hired yet, nothing to hand over),
// ?demo=crew1, crew5, crew12, crew30 (the office at that many helpers).
// ?demo=building (Scribe mid-build: the question answered, the workbook not yet delivered).
// &sheet=signin or &sheet=connect opens that sheet, and &phase=… pins it to one state.
import type { Json } from './api.ts';
import { AIS } from './adapter.ts';
import { describe, nextRun, parseSchedule } from '../../src/routines.ts';

const variant = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('demo') || 'umer';
const now = Date.now();
// The local day's start, as the app counts "done today": jobs meant to be done today never slip into yesterday after midnight.
const today = new Date(now).setHours(0, 0, 0, 0);
const min = 60_000;
const signin = ['signin', 'hello', 'first', 'work'].includes(variant);
const firstRun = ['first', 'answer', 'plan', 'work'].includes(variant);
const fresh = variant === 'fresh';
// Google setup: what crewd's ideas[] says a job waits on (docs/ui-contract.md).
const houseGoogle = variant !== 'nogoogle' && !new URLSearchParams(location.search).has('nohouse');
// The day, planned waits on the person's own calendar and mail (?demo=day has both on, ?demo=nogoogle neither).
const connected = variant === 'connect' ? [] : ['drive', 'gmail', ...(variant === 'day' ? ['calendar'] : [])];
const dayNeeds = !houseGoogle ? ['Google'] : connected.includes('calendar') ? [] : ['Google Calendar'];
// The family desk reads the mail and writes the calendar, so it waits on both of the person's own Google apps.
const paperNeeds = !houseGoogle ? ['Google'] : connected.includes('gmail') ? (connected.includes('calendar') ? [] : ['Google Calendar']) : ['Gmail', 'Google Calendar'];

const svg = (a: string, b: string, label: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="320" y="215" font-family="Nunito,sans-serif" font-weight="900" font-size="46" fill="#fff" text-anchor="middle">${label}</text></svg>`)}`;

const bot = (id: string, display: string, role: string, extra: Json = {}) => ({
  id, display, role, template: id, state: 'on', member: 1, computer: id !== 'chief', controls: 'bot', task: null, queued: 0, pausedUntil: null, ...extra,
});
const task = (id: number, b: string, title: string, state: string, extra: Json = {}) => ({ id, bot: b, title, state, member: 1, updated_at: now - 20 * min, files: [], ...extra });

const bots = [
  bot('chief', 'Chief', 'Manages the crew for you', { last: { author: 'bot', text: 'Scout found three flights to Lahore. Do you want Chief to book the Friday one?', at: now - 4 * min }, unread: 1 }),
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
  { id: 7, bot: 'scribe', task_id: 43, kind: 'propose', at: now - 3 * min, member: 1, title: 'Scribe wrote your text', detail: {
    words: 'Scribe wrote your text.',
    draft: { channel: 'text', to: 'Aunty Sara' }, yes: 'Approve',
    preview: { head: 'Draft for Aunty Sara', body: "Dear Aunty Sara, thank you so much for the lovely dinner on Sunday. Mum hasn't stopped talking about your biryani, and neither have I. Next time, it's at ours! With love, Umer" },
  } },
  { id: 10, bot: 'scout', task_id: null, kind: 'propose', at: now - 4 * min, member: 1, title: 'Scout would like to remember how to do this: Plan the week’s dinners, with a shopping list', detail: {
    words: 'Scout would like to remember how to do this: Plan the week’s dinners, with a shopping list',
    preview: { head: 'How Scout would do it', body: '1. Five dinners, vegetarian, nothing over forty minutes.\n2. One shopping list, grouped by aisle.\n3. Keep Friday for pizza night.' } } },
  { id: 11, bot: 'scout', task_id: 42, kind: 'permission', at: now - 30_000, member: 1, title: '', detail: {
    effect: 'spend', spends: true, ...(variant === 'unknown' ? {
      words: "Scout wants to act on a checkout page at flights.example. I couldn't read the total on this page.",
      preview: { head: 'The order at flights.example', body: "PIA to Lahore, Fri 19 Dec 23:55, direct, return\nTotal: couldn’t read it on this page" },
      order: { shown: '', known: false, dollars: false },
    } : {
      words: 'Scout wants to place this order at flights.example: PIA to Lahore, Fri 19 Dec 23:55, direct, return. Total $968.00.',
      preview: { head: 'The order at flights.example', body: 'PIA to Lahore, Fri 19 Dec 23:55, direct, return — $968.00\nTotal $968.00' },
      order: { shown: '$968.00', known: true, dollars: true },
    }) } },
  { id: 8, bot: 'reel', task_id: 41, kind: 'connect', at: now - min, member: 1, title: '', detail: { app: 'drive', words: 'Want a copy in your Drive too?' } },
  { id: 12, bot: 'reel', task_id: 41, kind: 'question', at: now - 2 * min, member: 1, title: '', detail: { question: 'Include the baby photos Mum sent, or just the recent ones?' } },
  { id: 13, bot: 'pip', task_id: null, kind: 'question', at: now - 6 * min, member: 1, title: '', detail: { question: 'Sports day and the dentist trip are both on Friday morning. Keep both?' } },
  { id: 14, bot: 'chief', task_id: null, kind: 'propose', at: now - 30_000, member: 1, title: "Every weekday at 8:00 am, Pip will plan the week's dinners.", detail: {
    words: "Every weekday at 8:00 am, Pip will plan the week's dinners.",
    routine: { bot: 'pip', schedule: 'weekdays 8am', task: "Plan the week's dinners and make the shopping list", quiet: true },
    preview: { head: 'A new routine', body: "Every weekday at 8:00 am\nPip will plan the week's dinners\nTells you only when something changed\nFirst time: Mon 8:00 am" } } },
  { id: 9, bot: 'tracer', task_id: 44, kind: 'permission', at: now - 2 * min, member: 1, title: '', detail: {
    effect: 'spend', spends: true, words: "Tracer wants to spend about $0.50 to find Sara Malik's work email. OK?" } },
  ...(variant === 'nogoogle' ? [{ id: 45, bot: 'pip', task_id: null, kind: 'connect', at: now, member: 1, title: 'Connect Google Calendar', detail: { app: 'calendar', words: 'Let Pip use your Google Calendar' } }] : []),
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
// ?demo=office: first looks on Reel's and Scout's desks. ?demo=calm: nothing on the go, so the room is idle.
if (variant === 'office') {
  events.push(ev(14, 1, 'file.delivered', 'reel', { task: 41, path: 'files/happy-birthday-first-cut.mp4' }),
    ev(15, 1, 'file.delivered', 'scout', { task: 42, path: 'files/flights-to-lahore.xlsx' }));
}
if (variant === 'calm') for (const b of bots) Object.assign(b, { task: null, step: undefined });
// ?demo=crew1, crew5, crew12, crew30: the office at that many helpers. Scribe waits on Chief at crew1;
// larger crews add working helpers, questions and free desks.
const many = /^crew(\d+)$/.exec(variant);
if (many) {
  const n = Number(many[1]), kinds = ['reel', 'scout', 'scribe', 'pip'];
  const names = ['Bea', 'Kit', 'Ollie', 'Juno', 'Milo', 'Tess', 'Remy', 'Ivy', 'Otto', 'Nell', 'Finn', 'Luna', 'Hugo', 'Wren', 'Ada', 'Zed', 'Mae', 'Rex', 'Isla', 'Theo', 'Cleo', 'Ned', 'Pia', 'Sol', 'Yara', 'Bo', 'Gus', 'Lia', 'Max', 'Noor'];
  const jobs = ['Holiday photo book', 'Compare phone plans', 'Tidy the budget sheet', 'Find a piano teacher', 'Plan the garden', 'Sort the insurance letters'];
  const own = ['scribe', 'reel', 'scout', 'pip'].map((id) => bots.find((b) => b.id === id)!);
  bots.splice(1, bots.length - 1, ...own.slice(0, Math.min(n, 4)));
  for (let i = 4; i < n; i++) {
    const id = `h${i}`, name = names[(i - 4) % names.length], job = jobs[i % jobs.length], k = i % 8;
    const t = k === 0 || k <= 3 ? task(100 + i, id, job, k === 0 ? 'needs_you' : 'working') : null;
    bots.push(bot(id, name, 'Helps with your jobs', { template: kinds[i % 4], task: t,
      step: k && t ? { kind: 'task.progress', at: now - min, data: { text: `Working on ${job.toLowerCase()}` } } : undefined }));
    if (k === 0) asks.push({ id: 300 + i, bot: id, task_id: 100 + i, kind: 'question', at: now - min, member: 1, title: '', detail: { question: `A quick question about ${job.toLowerCase()}` } });
  }
}

const state = {
  person: { id: 1, name: 'Umer', address: 'Umer', quiet: '23:00-07:00', onboarded: variant === 'hello' || variant === 'signin' ? 0 : 1 },
  members: [{ id: 1, name: 'Umer', address: 'Umer', quiet: '23:00-07:00' }],
  bots,
  room: { last: { text: 'Scout has passed the story list to Scribe.', at: now - min }, busy: ['scout', 'scribe'] },
  templates: [
    { id: 'chief', display: 'Chief' },
    { id: 'reel', display: 'Reel', role: 'Makes videos and posters from your photos' },
    { id: 'scout', display: 'Scout', role: 'Finds things out and compares them for you' },
    { id: 'scribe', display: 'Scribe', role: 'Writes notes, emails and letters with you' },
    { id: 'pip', display: 'Pip', role: 'Keeps your week and the school stuff in order' },
    { id: 'tracer', display: 'Tracer', role: "Finds a person's work email or number" },
  ],
  tasks: [
    task(40, 'scout', "This week's dinners", 'done', { updated_at: Math.max(today, now - 50 * min), result: 'Seven dinners the kids will actually eat, and one shopping list sorted by aisle.', files: ['files/dinners-and-shopping-list.pdf'] }),
    task(38, 'reel', 'Eid photo collage', 'done', { updated_at: now - 26 * 60 * min, result: 'A collage of the twelve best Eid photos, sized for WhatsApp.', files: [svg('#ffc27a', '#ff7aa2', 'Eid Mubarak ♡')] }),
    task(36, 'scribe', 'Letter to the school about the trip', 'done', { updated_at: now - 50 * 60 * min, result: 'A short, polite letter asking to move Ayaan to the Friday group.', files: ['files/letter-to-school.pdf'] }),
    task(35, 'pip', 'Sports day in the calendar', 'done', { updated_at: now - 3 * 24 * 60 * min, result: 'Added sports day, Friday 9 am, with a reminder the night before.' }),
    task(46, 'scribe', 'Hotel guest reception', 'done', { updated_at: Math.max(today, now - 22 * min), result: 'A workbook the front desk can run the day on: the dashboard, the booking log, the room board and the payments.', files: ['files/hotel-guest-reception.xlsx'] }),
  ],
  ideas: [
    { bot: 'scout', promise: "I'll keep an eye on what you just bought, and tell you the day you can claim the money back. I'll do it end to end — you just tap approve.", ask: 'Watch something I bought and tell me when I can claim the difference back', group: 'money', needs: ['Gmail'] },
    { bot: 'scout', promise: "I'll search the government's unclaimed-money registers for your name and get the claims ready to file. I'll file it end to end — you just tap approve.", ask: 'Search for money owed to me that nobody has claimed', group: 'money', title: 'Find money owed to you', line: 'checks the unclaimed-money lists', needs: [] },
    { bot: 'scout', promise: "I'll set up the return, keep the label, and keep checking until the shop says the refund is on its way. Every step asks you first, on its own card.", ask: 'Help me return this and get the refund', group: 'money', needs: [] },
    { bot: 'scout', promise: "I'll turn your mail, your calendar and what's still open into what today actually is.", ask: "Give me my day: what's on, what's waiting on me, what to do first", needs: dayNeeds },
    { bot: 'scout', promise: "I'll read the letters and forms coming into your mail, put what's due on your calendar, and draft every reply — you read, tap approve, and send.", ask: "Sort the paperwork: what's due, and draft the replies", needs: paperNeeds },
    { bot: 'scout', promise: "Once a week I'll plan seven dinners you will enjoy, write the shopping list sorted by aisle, and put the shop day on your calendar. If you want, I'll fill the cart too — you approve it like any purchase.", ask: "Plan my dinners for the week and write the shopping list", needs: [] },
    { bot: 'scout', promise: "I'll keep an ear out for your name and anything you told me to listen for — across Reddit, Hacker News, news sites and X — and send you one line saying where it came from when something shows up. Quiet otherwise.", ask: 'Watch for my name online and tell me when something shows up', needs: [] },
    { bot: 'scout', promise: "Give me the names of the others doing what you do. I'll watch their pages and newsletters, and once a week you get one short brief: what changed, what it means, what you could do about it. I never contact anyone.", ask: 'Watch my competitors and give me a weekly brief', needs: [] },
    { bot: 'scout', promise: "Once a month I'll write the short story of what happened in our world — the topics, names and places you care about — with a note on where every claim came from, as a document you keep.", ask: 'Write me the month in brief', needs: [] },
    { bot: 'scout', promise: "I'll catch a renewal or a price rise before it's charged, and have the cancellation email ready. Every step asks you first, on its own card.", ask: 'Watch my subscriptions so nothing gets renewed without me hearing about it first', group: 'money', needs: houseGoogle ? [] : ['Google'] },
    { bot: 'pip', promise: 'Plan a birthday party', ask: 'Plan a birthday party for ' },
    { bot: 'chief', promise: "What's on this week?", ask: "What's on this week?" },
    { bot: 'reel', promise: 'Make a poster from photos', ask: 'Make a poster from these photos: ' },
  ],
  asks: variant.startsWith('phone') ? [] : variant === 'room' ? [{ id: 90, bot: 'scout', task_id: null, kind: 'propose', at: now - min, title: 'Scout wants to hand this to Scribe: draft the story', detail: { words: 'Scout wants to hand this to Scribe: draft the story, with stories.md', pass: { root: 70, files: ['stories.md'] }, preview: { head: 'Scout → Scribe', body: 'Draft the story for your newsletter.' } } }]
    : variant === 'job-card' ? [{ id: 21, bot: 'chief', task_id: null, kind: 'propose', at: now, member: 1, title: "Chief wrote Pip's job", detail: { job: { bot: 'pip', does: 'Keep Umer’s calendar in order.', aim: 'Help Umer know what is coming.', gets: 'Events and reminders from the person.', how: 'Check dates, add reminders only when asked, and explain changes.', great: 'A clear, accurate week; for example, sports day with a reminder the evening before.' }, preview: { head: "Pip's job", body: 'What it does: Keep Umer’s calendar in order.\n\nWhat it’s aiming for: Help Umer know what is coming.\n\nWhat it gets from others: Events and reminders from the person.\n\nHow it goes about it: Check dates, add reminders only when asked, and explain changes.\n\nWhat great looks like: A clear, accurate week; for example, sports day with a reminder the evening before.' } } }]
    : variant === 'job-plan' ? [{ id: 22, bot: 'chief', task_id: null, kind: 'propose', at: now, member: 1, title: 'Here’s the plan for “Find the best five strollers under $400”. Scout starts when you say Go.', detail: {
        words: 'Here’s the plan for “Find the best five strollers under $400”. Scout starts when you say Go.',
        plan: { bot: 'scout', steps: ['Look through reviews and parents’ forums for strollers under $400', 'Pick the five that come up best, with any recalls checked', 'Compare them on weight, fold, storage and price in one sheet', 'Tell you the one to buy and why'] } } }]
    : variant === 'connect' ? [{ id: 11, bot: 'pip', task_id: 45, kind: 'connect', at: now, member: 1, title: 'Connect Google Calendar', detail: { app: 'calendar', words: 'Let Pip use your Google Calendar' } }]
    : variant === 'claim' ? [{ id: 13, bot: 'scout', task_id: 42, kind: 'permission', at: now - 30_000, member: 1, title: '', detail: {
        effect: 'send', press: true, fill: true, spends: false,
        words: 'Scout wants to fill in 3 lines on the claim form at unclaimed.example.',
        preview: { head: 'What Scout will fill in on unclaimed.example', body: 'Owner’s full name: Umer Ali\nAddress the money was owed at: 14 Carter Road, Lahore\nEmail for this claim: umer@example.net' } } }]
    : variant === 'return' ? [{ id: 16, bot: 'scout', task_id: 47, kind: 'permission', at: now - 30_000, member: 1, title: '', detail: {
        effect: 'send', press: true, spends: false,
        words: 'Scout wants to press “Start return” on shop.example, a site you signed it in to.',
        preview: { head: 'What Scout will press on shop.example', body: 'Espresso machine — delivered 12 May\nReturns are free within 30 days. Starting a return books a collection and tells the shop to expect the item.\nStart return' } } }]
    : variant === 'chase' ? [{ id: 17, bot: 'scout', task_id: 48, kind: 'propose', at: now - 30_000, member: 1, title: 'Scout wrote your email.', detail: {
        words: 'Scout wrote your email.',
        draft: { channel: 'email', subject: 'Order 98765 — returned 16 May, no refund yet', to: 'the shop’s support inbox', path: 'files/chase-order-98765.md', sha: 'demo' }, yes: 'Approve',
        preview: { head: 'Draft for the shop’s support inbox', body: 'Hello, my return reached you on 16 May, inside your own 30-day window. The order page still shows no refund.\n\nPlease confirm when the refund goes back to my card. Regards,\nUmer' } } }]
    : variant === 'renewal' ? [{ id: 18, bot: 'scout', task_id: 49, kind: 'propose', at: now - 30_000, member: 1, title: 'Scout wrote your email.', detail: {
        words: 'Scout wrote your email.',
        draft: { channel: 'email', subject: 'Streaming plan — please cancel before 14 June', to: 'the streaming service’s support inbox', path: 'files/cancel-family-plan.md', sha: 'demo' }, yes: 'Approve',
        preview: { head: 'Draft for the streaming service’s support inbox', body: 'Hello, my Streaming plan renews on 14 June at $18.99. Please cancel it from that date and confirm in writing that nothing further will be charged to my card.\n\nRegards,\nUmer' } } }]
    : variant === 'paper' ? [{ id: 19, bot: 'scout', task_id: 50, kind: 'propose', at: now - 30_000, member: 1, title: 'Scout wrote your email.', detail: {
        words: 'Scout wrote your email.',
        draft: { channel: 'email', subject: 'Ayaan’s trip form — Friday', to: 'the school office', path: 'files/reply-trip-form.md', sha: 'demo' }, yes: 'Approve',
        preview: { head: 'Draft for the school office', body: 'Hello, the signed trip form is in Ayaan’s bag this morning. He takes the packed-lunch option, and I can walk with the group if you are still short of adults.\n\nThank you,\nUmer' } } }]
    : variant === 'meals' ? [{ id: 20, bot: 'scout', task_id: 51, kind: 'permission', at: now - 30_000, member: 1, title: '', detail: {
        effect: 'spend', spends: true,
        words: 'Scout wants to place this order at grocer.example: Basmati rice 10 lb, Whole milk (1 gal) x2, Garlic, 2 kg. Total $43.10.',
        preview: { head: 'The order at grocer.example', body: 'Basmati rice 10 lb — $24.00\nWhole milk (1 gal) x2 — $7.90\nGarlic, 2 kg — $6.20\nTotal $43.10' },
        order: { shown: '$43.10', known: true, dollars: true } } }]
    : firstRun || variant === 'calm' || variant.startsWith('voice-') ? []
    : variant === 'building' ? asks.filter((a) => a.bot !== 'scribe') : asks,
  events,
  resting: variant === 'resting' ? { chatgpt: now + 95 * min } : {},
  routines: [
    routine(1, 'chief', 'Your week, every morning', 'every day 8:00', 'on', 'digest'),
    routine(2, 'scout', 'Plan the week’s dinners', 'every Saturday 10:00', 'on'),
    { ...routine(3, 'pip', 'Check the school newsletter', 'every Friday 16:00', 'paused'), quiet: 1 },
    { id: 4, bot: 'scout', kind: 'task', name: 'File the new receipts', words: '', on: "When a file arrives in Scout's inbox", state: 'on', next_at: null, history: [] },
  ],
  connections: connected,
  share: { choice: 'light', used: variant === 'share' },
  money: { cap: 20, spent: variant === 'share' ? 4 : 0 },
  house: { google: houseGoogle, steps: [
    { state: 'checked', note: 'Google knows the project.' }, { state: 'missing', note: 'Gmail API is still off. Enable it.' },
    { state: 'said', note: 'Checked the first time you connect.' }, { state: 'checked', note: 'Google took the key.' }] },
  desktops: { missing: [] },
};

// ?demo=fresh: the Chief-only Home a new person gets — no helpers hired yet, so the standing list offers
// three goal rows that bring their helper on with a tap, and nothing else waits or went before.
const freshHire = [
  { bot: 'scout', promise: "Tell me what you're good at and the hours you have, and I'll price five things like yours and say what sells.", ask: 'Help me earn a little on the side', group: 'goal', needs: [], hire: 'scout' },
  { bot: 'scribe', promise: 'Your first listing and three posts, written in your voice — you post them.', ask: 'Write my first listing and three posts', group: 'goal', needs: [], hire: 'scribe' },
  { bot: 'reel', promise: 'A 20-second video from three photos.', ask: 'Make a 20-second video from my three photos', group: 'goal', needs: [], hire: 'reel' },
];
if (fresh) {
  Object.assign(bots[0], { last: null, unread: 0 });
  Object.assign(state, { bots: bots.slice(0, 1), room: {}, tasks: [], ideas: freshHire, asks: [], events: [], routines: state.routines.slice(0, 1) });
}

// ?demo=unknown puts an order crewd couldn't price on Scout's card instead: no yes, the person finishes it themselves.
const first = "Plan this week's dinners, with a shopping list";
const pages: Record<string, Json> = {
  chief: variant === 'voice-before' || variant === 'voice-after' ? { messages: variant === 'voice-before' ? [
    { id: 1, author: 'person', text: 'hi' },
    { id: 2, author: 'bot', text: 'Delighted, Sir. To think, the crew uses your own ChatGPT, the same one you already use.' },
    { id: 3, author: 'person', text: 'how do i pair my computer with you?' },
    { id: 4, author: 'bot', text: "You're already connected to me here in Crewhouse, sir. Do you mean giving me access to files on this computer, or pairing a different computer?" },
    { id: 5, author: 'person', text: 'i want to market my app' },
    { id: 6, author: 'bot', text: "I can help with that, sir. What's the app called, and what does it do?" },
    { id: 7, author: 'person', text: 'https://trymuxr.com/' },
    { id: 8, author: 'bot', text: 'Scout has finished “https://trymuxr.com/”, Sir. It’s in Scout’s chat: “Sir, [muxr](https://trymuxr.com/) lets you monitor and control coding agents on your computer from a phone…”' },
  ] : [
    { id: 1, author: 'person', text: 'hi' },
    { id: 2, author: 'bot', text: 'Hi. What would you like to work on?' },
    { id: 3, author: 'person', text: 'how do i pair my computer with you?' },
    { id: 4, author: 'bot', text: 'Open Settings › Phones › Add a phone on your computer, then scan the code with your phone.' },
    { id: 5, author: 'person', text: 'i want to market my app' },
    { id: 6, author: 'bot', text: 'I can help market it. Send the site so I can see the product and audience before drafting a plan.' },
    { id: 7, author: 'person', text: 'https://trymuxr.com/' },
    { id: 8, author: 'bot', text: 'muxr lets developers manage coding agents from their phone. I’ll map the audience, focus on developer communities and founder posts, then ask Scout and Scribe for first drafts. Nothing will be posted.' },
    { id: 9, author: 'bot', text: 'The muxr launch plan is ready: audience, three channels, first week of posts.', files: [{ bot: 'scout', path: 'files/muxr-launch-plan.docx' }] },
  ] } : firstRun ? { messages: [
    { id: 1, author: 'person', text: first },
    { id: 2, author: 'chief', text: 'Thank you, Umer. The crew uses your own ChatGPT. It is the same one that you already use.' },
    ...(variant === 'plan' ? [{ id: 3, author: 'chief', text: "Your ChatGPT plan doesn't include helpers yet. Everything else in ChatGPT is fine. ChatGPT Plus includes it, or you can ask Umer to cover it." }] : []),
    ...(variant === 'answer' ? [
      { id: 3, author: 'chief', text: 'You are signed in. Thank you, Umer. Chief starts the task now.' },
      { id: 4, author: 'chief', text: 'Dinners this week: Mon dal & rice · Tue chicken wraps · Wed pasta bake · Thu fish tikka · Fri pizza night.\n\nShopping list (18 items): lentils, rice, onions, garlic, ginger, tomatoes, chicken thighs, wraps, lettuce, yoghurt, pasta, cheddar, passata, white fish, tikka paste, pizza bases, mozzarella, peppers.' },
      { id: 5, author: 'chief', text: 'Do you want Chief to do this every Sunday evening?', choices: ['Yes, Sundays', 'Not now'] },
    ] : []),
  ] } : variant === 'connect' ? { messages: [] } : { messages: [
    { id: 1, author: 'chief', text: `${variant === 'umer' ? 'Good evening, sir.' : 'Good evening, Umer.'} Two requests need your answer. Scribe's note for Aunty Sara is ready to send. Reel wants to save a copy of Mum's video. Scout expects to find flights in ten minutes.` },
    { id: 2, author: 'person', text: 'great, and can scout find somewhere nice for dinner on saturday too?' },
    { id: 3, author: 'chief', text: 'OK. Chief asked Scout to look after the flights are done. Does Chief tell Scout four people, near home?', choices: ['Yes, four, near home', 'Six people', 'Somewhere special'] },
    { id: 4, author: 'person', text: "every weekday morning, have Pip plan the week's dinners" },
    { id: 5, author: 'chief', text: 'OK. Pip makes the plan, and you approve it. Here it is. Start it. The first plan comes tomorrow morning.' },
  ] },
  reel: { messages: [
    { id: 1, author: 'person', text: 'can you make a birthday video for mum from the eid photos? something sweet, like 20 secs' },
    { id: 2, author: 'bot', text: "Love this! I found 38 photos from Eid, and I'll pick the 8 happiest. What kind of music?", choices: ['🎹 Soft & sweet', '🎉 Upbeat', 'No music'] },
    { id: 3, author: 'person', text: 'soft and sweet please' },
    { id: 4, author: 'system', text: "Delivered files/happy-birthday-mum.mp4: Here's a first look 💐" },
  ], notes: '- Umer likes soft piano music for his videos\n- Mum is "Ammi" in titles', tasks: [],
  soul: '# Reel\n\n## How you come across\n- Upbeat and practical: one sentence on what was made, then let the video speak.\n- Loves a tidy thirty seconds: clean cuts, steady pacing, nothing that shouts.\n- Makes a sensible call when something is missing, and says what was assumed.',
  skills: [{ name: 'make-reel', says: 'Turn photos and screenshots into a short video' }, { name: 'birthday-video', says: 'Make a birthday video from your photos', learned: true }] },
};
if (variant === 'job-plan') pages.chief.messages.push({ id: 71, author: 'person', text: 'find me a good stroller under $400, compare the best five' },
  { id: 72, author: 'chief', text: 'OK, Umer. Scout will do this task. Here is the plan. Nothing starts before you say Go.' });
if (variant === 'room') pages.chief.messages.push({ id: 70, author: 'bot', text: 'The tasks are done, Umer. Scout: three stories. Scribe: a newsletter draft that needs your yes.' });
if (fresh) pages.chief = { messages: [] };
if (variant === 'connect') pages.pip = { messages: [
  { id: 1, author: 'person', text: "What's on this week?" },
  { id: 2, author: 'bot', text: 'I can do this with your Google Calendar.' },
] };
// A workbook, asked for in one line: one question back, then the finished file. The screens show what crewd read out of it.
const ask = ['One thing before I build it: is this the desk’s own day sheet, or the manager’s log of every booking?', 'One thing: just for the front-desk team, or one the manager signs off on too?'];
const made = ['Then one workbook, ready to use: a dashboard for today, the booking and check-in log, the room and housekeeping board, and the payments. Each has an example row and dropdowns where you need them.',
  'Here’s the front-desk handbook: how the day opens, check-ins, payments, and what to do when the power goes. Say the word and I’ll change anything in it.'];
// As crewd writes it: a question back ends its own turn, and the answer is a new job that delivers, then says so.
pages.scribe = { messages: [
  { id: 1, author: 'person', text: 'create an excel for reception at the hotel', task_id: 61 },
  { id: 2, author: 'bot', text: ask[0], task_id: 61 },
  { id: 3, author: 'person', text: "the desk's own day sheet", task_id: 62 },
  { id: 4, author: 'system', text: 'Delivered files/hotel-guest-reception.xlsx: 4 sheets: Daily dashboard, Booking & check-in, Rooms & housekeeping, Payments', task_id: 62 },
  { id: 5, author: 'bot', text: made[0], task_id: 62 },
  { id: 6, author: 'person', text: 'now put the desk rules together as a word document for the drawer', task_id: 63 },
  { id: 7, author: 'bot', text: ask[1], task_id: 63 },
  { id: 8, author: 'person', text: 'just the front-desk team', task_id: 64 },
  { id: 9, author: 'system', text: 'Delivered files/front-desk-handbook.docx: A document in 3 sections: Front-desk handbook', task_id: 64 },
  { id: 10, author: 'bot', text: made[1], task_id: 64 },
// Each finished job is marked Done on its last reply; each question back is not.
], tasks: [{ id: 61, state: 'done', title: 'create an excel for reception at the hotel', result: ask[0] }, { id: 62, state: 'done', title: "the desk's own day sheet", result: made[0] },
  { id: 63, state: 'done', title: 'now put the desk rules together as a word document for the drawer', result: ask[1] },
  { id: 64, state: 'done', title: 'just the front-desk team', result: made[1] }] };
// ?demo=building: Scribe mid-build — the question answered, the workbook not yet delivered, so the chat holds its place.
if (variant === 'building') {
  Object.assign(bots.find((b) => b.id === 'scribe')!, { task: task(43, 'scribe', 'Excel for reception', 'working'), step: undefined });
  pages.scribe = { messages: [
    { id: 1, author: 'person', text: 'create an excel for reception at the hotel' },
    { id: 2, author: 'bot', text: 'One thing before I build it: is this the desk\u2019s own day sheet, or the manager\u2019s log of every booking?' },
    { id: 3, author: 'person', text: 'the desk\u2019s own day sheet' },
  ] };
}
// A renewal caught ahead of the bill: the warning in Scout's chat, and the cancellation sitting below it as a draft.
if (variant === 'renewal') pages.scout = { messages: [
  { id: 1, author: 'person', text: 'watch my subscriptions so nothing gets renewed without me hearing about it first' },
  { id: 2, author: 'bot', text: 'Your streaming plan renews on 14 June at $18.99 — read off your own account page, not the page new customers see. Ten days ahead of the bill, so you hear it now.' },
  { id: 3, author: 'bot', text: 'The cancellation email is on a card below, in your name. Nothing is sent and nothing is cancelled yet: you read it and post it yourself. If you would rather I pressed Cancel on your account page, say so — I’ll ask you again on a card naming the button and what it changes.' },
], notes: '', tasks: [] };
// The paper, sorted (?demo=paper): the week's letters in one line, and the reply sitting below as a draft to approve.
if (variant === 'paper') pages.scout = { messages: [
  { id: 1, author: 'person', text: "Sort the paperwork: what's due, and draft the replies" },
  { id: 2, author: 'bot', text: 'Four letters came in. Two are done: the dentist letter needs nothing, and the trip form is filled in on the school\'s page — its card asked you first.\nDue this week: the club payment by Thursday (I\'ve put it on your calendar), and the doctor\'s form to sign at the desk.\nThe reply to the school office is on a card below, in your name. Nothing is sent: you read it and post it yourself.' },
], notes: '', tasks: [] };
// The meals, planned (?demo=meals): the week's dinners and the list, and the cart waiting on its checkout card.
if (variant === 'meals') pages.scout = { messages: [
  { id: 1, author: 'person', text: 'Plan my dinners for the week and write the shopping list' },
  { id: 2, author: 'bot', text: 'Seven dinners, one line each, nothing over forty minutes on a school night — Friday stays pizza night, and Sunday\'s roast covers Monday\'s leftovers.\nThe list is below, sorted the way you walk the shop: produce first, then chilled, pantry, freezer. The shop day is on your calendar for Saturday morning.\nYou asked me to fill the cart too: it\'s at the checkout on a card, every item and the total. Placing the order is yours.' },
  { id: 3, author: 'system', text: 'Delivered files/dinners-and-shopping-list.md: Seven dinners and the list, sorted by aisle' },
], notes: '', tasks: [] };
// The name watch, heard (?demo=watch): one source-linked line on the morning something showed up — and nothing on the quiet days.
if (variant === 'watch') pages.scout = { messages: [
  { id: 1, author: 'person', text: 'Watch for my name online and tell me when something shows up' },
  { id: 2, author: 'bot', text: 'Set up: Ada Ali, @adaali, and the name of the market stall — across Reddit, Hacker News, news sites and X. I\'ll say one line, with where it came from, when something shows up, and nothing on the quiet days.' },
  { id: 3, author: 'bot', text: 'This morning, a Reddit thread in r/lahore mentions the stall by name: "Has anyone been to the Ali family stall at Liberty market lately? Went back after two years." — reddit.com/r/lahore/comments/ada_stall. Nothing else this week; the day the thread turns sour, that line comes too.' },
], notes: '', tasks: [] };
// The neighbours, watched (?demo=neighbour): the week's brief as a finished document — what changed, what it means, what to do.
if (variant === 'neighbour') pages.scout = { messages: [
  { id: 1, author: 'person', text: 'Watch my competitors and give me a weekly brief' },
  { id: 2, author: 'bot', text: 'Watching three stalls on Liberty market: their pages and their price lists, every Monday morning. I never contact anyone — I only read.\nThis week\'s brief is below: one price moved, one stall closed Mondays. Prices are read off their own pages, two sources each.' },
  { id: 3, author: 'system', text: 'Delivered files/neighbour-brief.docx: A document in 3 sections: The neighbours, this week' },
], notes: '', tasks: [] };
// The month in brief (?demo=brief): the month's short story as a document, with a link for every claim.
if (variant === 'brief') pages.scout = { messages: [
  { id: 1, author: 'person', text: 'Write me the month in brief' },
  { id: 2, author: 'bot', text: 'Three paragraphs: what happened in the market this month, why it matters to the stall, and the one thing to watch next month. Every claim says where it came from, and the two numbers that matter were each checked against a second source.\nIt\'s below as a document, so it keeps — next month\'s sits beside it. Say the word and I\'ll bring it every month.' },
  { id: 3, author: 'system', text: 'Delivered files/month-in-brief.docx: A document in 3 sections: The month in brief' },
], notes: '', tasks: [] };
// The day, planned, answered where the job was handed over (?demo=day): one message, three things, in order, at times.
if (variant === 'day') pages.scout = { messages: [
  { id: 1, author: 'person', text: "Give me my day: what's on, what's waiting on me, what to do first" },
  { id: 2, author: 'bot', text: 'Two fixed things today, and one form to sign.\n1. 8:40 am \u2014 Sign Ayaan\u2019s trip form, the school office wants it before the run.\n2. 1:15 pm \u2014 Call the shop back about the espresso machine, the refund waits on what you tell them.\n3. 6:30 pm \u2014 Pack the kit bag for tomorrow\u2019s sports day, it goes in the car.\nThe rest of the mail can wait until tomorrow. Want me to bring you a list like this every weekday morning?' },
] };
/** What crewd read out of that workbook (src/workbooks.ts): the demo\u2019s own copy, in crewd\u2019s shape. */
// Scout's first look at the flights (?demo=office): three airlines side by side.
const flights = { sheets: [{ name: 'Flights', total: 4, rows: [['Airline', 'Leaves', 'Direct', 'Return fare'],
  ['Emirates', 'Fri 19 Dec, 21:40', 'No, via Dubai', '$1,184'], ['Qatar Airways', 'Sat 20 Dec, 08:15', 'No, via Doha', '$1,092'],
  ['PIA', 'Fri 19 Dec, 23:55', 'Yes', '$968']],
  nums: [1, 2, 3, 4], roles: [['head', 'head', 'head', 'head'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']] }] };
const book = {
  sheets: [
    { name: 'Daily dashboard', total: 6, rows: [
      ['Today', 'Number', 'Notes'], ['Arrivals', '6', 'Two early, one at 4pm'], ['Departures', '4', 'One late checkout agreed'], ['Walk-ins so far', '1', 'Room 204 taken'], ['Rooms ready', 'auto', 'Worked out when you open it']],
      nums: [1, 2, 3, 4, 5], roles: [['head', 'head', 'head'], ['', '', ''], ['', '', ''], ['', '', ''], ['', 'calc', '']] },
    { name: 'Booking & check-in', total: 34, rows: [
      ['Guest', 'Room', 'Arrival', 'Departure', 'Nights', 'Status', 'Rate', 'Paid'],
      ['Amina Khan', '204', '11 Oct', '14 Oct', '3', 'Checked in', '285', '285'],
      ['Bilal Sheikh', '108', '12 Oct', '13 Oct', '1', 'Booked', '120', '40'],
      ['Family Nazir', '301', '12 Oct', '16 Oct', '4', 'Waitlist', '520', '0']],
      nums: [1, 2, 3, 4], roles: [['head', 'head', 'head', 'head', 'head', 'head', 'head', 'head'],
        ['', '', '', '', '', 'in', '', ''], ['', '', '', '', '', 'in', '', ''], ['', '', '', '', '', 'in', '', '']] },
    { name: 'Rooms & housekeeping', total: 40, rows: [
      ['Room', 'Type', 'Guest', 'State', 'Checked by', 'Notes'],
      ['204', 'Sea view double', 'Amina Khan', 'Checked in', 'Rani', 'Extra pillow asked for'],
      ['108', 'Standard single', '', 'Cleaning', '', 'Start after 11'],
      ['301', 'Family suite', '', 'To do', '', 'Hairdryer missing']],
      nums: [1, 2, 3, 4], roles: [['head', 'head', 'head', 'head', 'head', 'head'],
        ['', '', '', 'in', '', ''], ['', '', '', 'in', '', ''], ['', '', '', 'in', '', '']] },
    { name: 'Payments', total: 12, rows: [
      ['Guest', 'Room', 'Bill', 'Paid', 'To pay', 'Way paid'],
      ['Amina Khan', '204', '285', '285', '0', 'Card'],
      ['Bilal Sheikh', '108', '120', '40', '80', 'Cash'],
      ['Family Nazir', '301', '520', '0', '520', 'Not paid yet']],
      nums: [1, 2, 3, 4], roles: [['head', 'head', 'head', 'head', 'head', 'head'],
        ['', '', '', '', 'calc', 'in'], ['', '', '', '', 'calc', 'in'], ['', '', '', '', 'calc', 'in']] },
  ],
};
/** What crewd read out of a watch brief (?demo=neighbour, ?demo=brief, src/documents.ts): plain parts, never the file. */
const briefDoc = (title: string, parts: Json[]) => ({ parts: [{ kind: 'heading', text: title }, ...parts] });
const doc = variant === 'voice-after' ? briefDoc('muxr launch plan', [
  { kind: 'p', text: 'Run your coding agents from your phone. For developers who keep multiple agents working while they step away.' },
  { kind: 'heading', text: 'Audience' },
  { kind: 'p', text: 'Developers who keep coding agents working while they step away.' },
  { kind: 'heading', text: 'Three channels' },
  { kind: 'li', text: 'X: share a short product clip showing the phone view.' },
  { kind: 'li', text: 'Developer communities: lead with a useful workflow, not a pitch.' },
  { kind: 'heading', text: 'First week of posts' },
  { kind: 'p', text: 'Draft two founder posts and one workflow story; nothing posts without your approval.' },
]) : variant === 'neighbour' ? briefDoc('The neighbours, this week', [
  { kind: 'p', text: 'What changed on the three stalls we watch, read off their own pages this Monday, and what it means for yours.' },
  { kind: 'heading', text: 'What changed' },
  { kind: 'li', text: 'Karak Chai House put its doodh patti up from 120 to 150 rupees — their prices page and their Instagram both say 150 now.' },
  { kind: 'li', text: 'The Liberty juice counter now closes Mondays; its own notice says so, dated last week.' },
  { kind: 'li', text: 'Nothing moved on the kebab grill\'s page — same menu, same prices as last Monday.' },
  { kind: 'heading', text: 'What it means' },
  { kind: 'p', text: 'You are now the cheaper doodh patti on the strip by 30 rupees, and the Monday crowd has nowhere else inside the market.' },
  { kind: 'heading', text: 'What you could do' },
  { kind: 'p', text: 'Hold your price through the month and put a Monday-only tea deal on the board; the juice counter\'s closure is the opening.' },
]) : variant === 'brief' ? briefDoc('The month in brief', [
  { kind: 'p', text: 'September around Liberty market, in three paragraphs — every claim carries where it was read, and the two numbers were each checked against a second source.' },
  { kind: 'heading', text: 'The month' },
  { kind: 'p', text: 'Footfall came back after the rains: the market association\'s own notice counts twelve new stalls since June, four of them tea carts. The juice counter lost its Monday licence fight and closed Mondays; two neighbouring shops followed.' },
  { kind: 'heading', text: 'Why it matters here' },
  { kind: 'p', text: 'Tea is becoming the street\'s drink, and yours is still the cheapest doodh patti on the strip — the price boards say 120 against their 150.' },
  { kind: 'heading', text: 'Watch next month' },
  { kind: 'p', text: 'The association meets on the 9th to set winter hours; whatever it decides, the Monday gap is yours until it does.' },
]) : {
  parts: [
    { kind: 'heading', text: 'Front-desk handbook' },
    { kind: 'p', text: 'How the desk runs on an ordinary day, and what to do on a day that is not ordinary.' },
    { kind: 'heading', text: 'Opening the day' },
    { kind: 'li', text: 'Count the till against yesterday’s sheet before the first check-in.' },
    { kind: 'li', text: 'Walk the free rooms; anything not ready goes on the board as Cleaning.' },
    { kind: 'li', text: 'Print the arrivals list and mark early check-ins the guest asked for.' },
    { kind: 'heading', text: 'Check-ins and departures' },
    { kind: 'p', text: 'Check-in is from 2 pm; the night team leaves the welcome envelopes ready. At departure, walk the room before returning the key deposit.' },
    { kind: 'heading', text: 'Today' },
    { kind: 'table', head: ['Shift', 'On the desk', 'Notes'], rows: [['Morning', 'Rani', 'Two early arrivals'], ['Evening', 'Yusuf', 'Late checkout, room 204']] },
  ],
};
if (variant.startsWith('phone')) pages.chief = {
  messages: [
    { id: 400, author: 'person', text: 'how do i pair my computer with you?', at: now - 10_000 },
    { id: 401, author: 'bot', text: 'Open Crewhouse on your phone and scan this, or type the code.', at: now },
  ],
  // A demonstration ticket; no device accepts it. The real card is issued by src/link.ts.
  phoneOffer: { message: 401, token: 'demo-phone', qr: 'crewhouse-demo-phone-pairing', typed: '23456-789AB-CDEFG-HJKMN-PQRST', expires: now + 120_000,
    ...(variant === 'phone-waiting' ? { waiting: { id: 1, name: 'Pixel', words: 'maple lantern' } } : variant === 'phone-paired' ? { joined: 'Pixel' } : {}) },
};
for (const b of bots) pages[b.id] ??= { messages: [], notes: '', tasks: [] };
if (variant.startsWith('job')) pages.pip.job = { does: 'Keep Umer’s calendar in order.', aim: 'Help Umer know what is coming.', gets: 'Events and reminders from the person.', how: 'Check dates, add reminders only when asked, and explain changes.', great: 'A clear, accurate week; for example, sports day with a reminder the evening before.' };
// "Wheeled": the person is holding Scout's controls at its screen, signed it in to a shop, and is about to hand
// the wheel back — the give-back sheet lists the tabs crewd read itself, and Details lists what it is signed in to.
// ?demo=b1: the household the B1 mocks draw — Scout waits on Chief for your yes on a $412 flight, Reel and Scribe working, Tracer's
// dinner list landed today, Pip resting until 3 pm. The M5 side-by-sides compare against it.
if (variant === 'b1' || variant === 'b1handoff' || variant === 'b1after') {
  const b = (id: string) => bots.find((x) => x.id === id)!;
  Object.assign(b('scout'), { task: task(42, 'scout', 'Book Friday’s flight to Lahore?', 'needs_you'), step: { kind: 'task.progress', at: now - min, data: { text: 'Found three flights' } } });
  Object.assign(b('reel'), { task: task(41, 'reel', "Mum's birthday video", 'working'), step: { kind: 'task.progress', at: now - 2 * min, data: { text: 'Picking the music' } } });
  Object.assign(b('scribe'), { task: task(43, 'scribe', 'Thank-you note for Aunty Sara', 'working'), step: { kind: 'task.progress', at: now - 3 * min, data: { text: 'Writing your note' } } });
  Object.assign(b('tracer'), { task: null, step: undefined });
  Object.assign(b('pip'), { pausedUntil: new Date(now).setHours(15, 0, 0, 0) + (new Date(now).getHours() >= 15 ? 86_400_000 : 0) });
  Object.assign(b('chief'), { last: { author: 'bot', text: 'Scout found your Friday flight. It needs your yes.', at: now - min }, unread: 1 });
  (state as Json).asks = [{ id: 11, bot: 'scout', task_id: 42, kind: 'permission', at: now - 30_000, member: 1, title: '', detail: {
    effect: 'spend', spends: true,
    words: 'Scout wants to place this order at flights.example: Fri 3 Oct 08:40 → 11:10, one stop, seat 14A, bag included. Total $412.00.',
    preview: { head: 'The order at flights.example', body: 'Fri 3 Oct · 08:40 → 11:10\nOne stop · seat 14A · bag included — $412.00\nTotal $412.00' },
    order: { shown: '$412.00', known: true, dollars: true }, yes: 'Book for $412.00' } }];
  // Only Tracer's list is done today, as the mocks' "Tray · 1": the base household's other jobs done today are dropped here.
  (state as Json).tasks = [task(52, 'tracer', 'your dinner list', 'done', { updated_at: Math.max(today, now - 12 * min), result: 'Seven dinners and one shopping list, sorted by aisle.', files: ['files/dinner-list.pdf'] }),
    ...state.tasks.filter((t: Json) => !(t.state === 'done' && t.updated_at >= today))];
  events.push(ev(20, 13, 'file.delivered', 'tracer', { task: 52, path: 'files/dinner-list.pdf' }), ev(21, 12, 'task.done', 'tracer', { task: 52, title: 'your dinner list' }));
  // Hand-written fixture lines in Chief's coordinator voice (delegation, a recommendation, meaningful-only reports):
  // they show the screens, not that Chief decides, restarts or monitors on his own.
  pages.chief = { messages: [
    { id: 1, author: 'person', text: 'Can you get me to Lahore on Friday? Morning if possible.', at: now - 20 * min },
    { id: 2, author: 'chief', text: 'Chief gave this task to Scout. Scout looks only at morning flights, because you asked for the morning. You do not have to do anything at this time.', at: now - 19 * min },
    { id: 3, author: 'chief', text: "Scout found three flights. Chief recommends Friday's 08:40 flight. It is the cheapest: $412, one stop, bag included. Nothing is booked before you say yes on the card above.", at: now - 14 * min },
    { id: 4, author: 'chief', text: 'Reel picks the music. Scribe writes your note. Chief tells you only when a task is done or waits for your answer.', at: now - min },
  ] };
}
// ?demo=rule | rule-saved | rule-cancelled: a standing rule from Chief's chat (hand-written fixture, as crewd's records
// would carry it): the confirm card, then the final state crewd writes on Chief's message, and the settings list.
const ruleSaid = 'Never act without my approval. Drafts only.';
const rule = { title: 'Drafts only', text: 'Only prepare drafts for me to read. Do not send messages, submit forms or buy anything. I do those myself.' };
const rulesKept: Json[] = variant === 'rule-saved' ? [{ id: 1, ...rule, at: now - min }] : [];
if (variant.startsWith('rule')) {
  (state as Json).asks = variant === 'rule' ? [{ id: 30, bot: 'chief', task_id: null, kind: 'propose', at: now - min, member: 1, title: rule.title, detail: { rule: { ...rule, said: ruleSaid } } }] : [];
  pages.chief = { messages: [
    { id: 1, author: 'person', text: `${ruleSaid} And leave the reply to the school as it was.`, at: now - 3 * min },
    { id: 2, author: 'chief', text: "Chief wrote your words as one rule. Read it on the card. Nothing is saved before you tap Create rule.\n\nChief cancelled the change to Scribe's reply to the school. The original draft did not change.", at: now - 2 * min },
    ...(variant === 'rule-saved' ? [{ id: 3, author: 'chief', text: 'Saved. Find the rule in Settings › Rules. Chief and the crew use it from now on.', at: now - min, rule: { state: 'saved', ...rule } }] : []),
    ...(variant === 'rule-cancelled' ? [{ id: 3, author: 'chief', text: 'Cancelled. Chief did not save the rule. Nothing changed.', at: now - min, rule: { state: 'cancelled', ...rule } }] : []),
  ] };
}
if (variant === 'wheeled') { Object.assign(bots.find((b) => b.id === 'scout')!, { controls: 'person' }); pages.scout = { ...pages.scout, signedIn: ['shop.example'] }; }
for (const [id, p] of Object.entries(pages)) p.trail = events.filter((e) => e.bot === id);

// Every subscription route the app really offers, so the demo's Settings shows the honest matrix: ChatGPT carries
// the sign-in states, the rest stand there untested until you sign in to one.
const accounts = AIS.map((ai) => ({ account: ai.key, name: ai.name,
  signedIn: ai.key === 'chatgpt' && (!signin || variant === 'work'),
  restingUntil: ai.key === 'chatgpt' && variant === 'resting' ? now + 95 * min : 0,
  notIncluded: ai.key === 'chatgpt' && variant === 'plan',
  work: ai.key === 'chatgpt' && variant === 'work' ? 'umer@acme.com' : false,
  signIn: ai.key === 'chatgpt' && variant === 'signin' ? { state: 'waiting', via: 'browser', url: 'https://auth.openai.com/oauth/authorize' } : null }));

// ?demo=handoff: Reel finishes while you watch. 4 s after the page opens the snapshot changes and the two events
// crewd would send land through the live path, so the room's hand-off, the tray and the feed all move as they would.
// ?demo=b1handoff is the same finish in the B1 household (Reel working on the same job, Tracer's list already in);
// ?demo=after and ?demo=b1after open on the room just after it, for the still checks.
const finish = () => {
  const done = task(41, 'reel', "Mum's birthday video", 'done', { updated_at: Date.now(), result: 'A one-minute video for Mum, with the piano song and her title.', files: ['files/happy-birthday-first-cut.mp4'] });
  Object.assign(bots.find((b) => b.id === 'reel')!, { task: null, step: undefined });
  state.tasks.unshift(done);
  (state as Json).asks = state.asks.filter((a: Json) => a.bot !== 'reel');
  const heard = [ev(14, 0, 'file.delivered', 'reel', { task: 41, path: done.files[0] }), ev(15, 0, 'task.done', 'reel', { task: 41, title: done.title, result: done.result, files: done.files })];
  events.push(...heard);
  return heard;
};
if (variant === 'after' || variant === 'b1after') finish();
function context(a: Json): Json {
  const why = (state.tasks.find((t: Json) => t.id === a.task_id) ?? state.bots.find((b: Json) => b.task?.id === a.task_id)?.task)?.title ?? null;
  const what = a.title || a.detail?.words || a.detail?.question;
  const who = a.bot === 'chief' ? '' : ` for ${state.bots.find((b: Json) => b.id === a.bot)?.display ?? a.bot}`;
  return { app: null, why, ...(what ? { chief: `Chief has a request${who}: ${what}. Use its card to answer.${why ? ` Task: ${why}.` : ''}` } : {}), ...a };
}
export function demoLive(hear: (e: Json) => void) {
  if (variant !== 'handoff' && variant !== 'b1handoff') return () => {};
  const t = setTimeout(() => finish().forEach(hear), 4000);
  return () => clearTimeout(t);
}

let calls = 0;
export async function demoCall(method: string, path: string, body?: Json) {
  // "offline": the home computer never answers; "lost": it answers once, then goes quiet.
  if (variant === 'offline' || (variant === 'lost' && calls++ > 0)) throw new TypeError('Failed to fetch');
  // A new snapshot each read, as crewd's would be; each ask carries crewd's top-level context as its askView writes it.
  if (method === 'GET' && path === '/api/state') return { ...state, asks: state.asks.map(context) };
  // The give-back sheet's ticks: the hosts on its tabs, only while the person holds the wheel.
  const scr = /^\/api\/bots\/([a-z0-9-]+)\/screen$/.exec(path);
  if (method === 'GET' && scr) return { pages: variant === 'wheeled' && scr[1] === 'scout' ? ['shop.example', 'mail.example'] : [] };
  if (method === 'POST' && /^\/api\/bots\/([a-z0-9-]+)\/forget$/.test(path)) return { ok: true };
  if (method === 'GET' && path.startsWith('/api/room')) return { lines: [
    { id: 81, bot: 'scout', author: 'person', text: 'Find three stories about the neighbourhood.', at: now - 5 * min },
    { id: 82, bot: 'scout', author: 'bot', text: 'Three stories worth telling: a new park, a school garden, and a night market.', at: now - 4 * min },
    { id: 83, bot: 'scribe', author: 'scout', from: 'scout', to: 'scribe', text: 'Draft the story for your newsletter.', at: now - 2 * min, files: [{ bot: 'scribe', path: 'files/from-scout/stories.md' }] },
    { id: 84, bot: 'chief', author: 'bot', text: 'The tasks are done, Umer. Scout: three stories. Scribe: a newsletter draft that needs your yes.', at: now - min },
  ], busy: ['scout', 'scribe'], asks: state.asks.filter((a: Json) => a.detail?.pass) };
  if (method === 'GET' && path.startsWith('/api/bots/scout')) return { ...pages.scout, handoff: 'ask', bot: bots.find((x) => x.id === 'scout') };
  const b = /^\/api\/bots\/([a-z0-9-]+)(?:\?.*)?$/.exec(path);
  if (method === 'GET' && b) return { ...pages[b[1]], bot: bots.find((x) => x.id === b[1]) };
  // A word across the threads (the demo crew): what search needs to land on the matching line.
  if (method === 'GET' && path.startsWith('/api/search')) {
    const q = decodeURIComponent(path.split('q=')[1] ?? '').replace(/\+/g, ' ').toLowerCase();
    const messages = Object.entries(pages).flatMap(([bot, p]) => ((p.messages ?? []) as Json[]).filter((m: Json) => String(m.text).toLowerCase().includes(q))
      .map((m: Json, i: number) => ({ id: m.id, bot, author: m.author, text: String(m.text).slice(0, 200), at: now - (i + 1) * min })));
    const things = state.tasks.filter((t: Json) => `${t.title} ${t.result ?? ''}`.toLowerCase().includes(q)).map((t: Json) => ({ id: t.id, bot: t.bot, title: t.title, at: t.updated_at }));
    return { messages: messages.slice(0, 50), things: things.slice(0, 20) };
  }
  if (method === 'GET' && path === '/api/rules') return { rules: rulesKept };
  const rr = /^\/api\/rules\/(\d+)$/.exec(path);
  if (rr && method === 'PUT') { const r = rulesKept.find((x) => x.id === Number(rr[1])); if (r) r.text = String(body?.text ?? r.text); return { ok: true }; }
  if (rr && method === 'DELETE') { rulesKept.splice(rulesKept.findIndex((x) => x.id === Number(rr[1])), 1); return { ok: true }; }
  if (method === 'GET' && path.startsWith('/api/accounts')) return accounts;
  // The workbook crewd reads for the card and the panel (src/workbooks.ts): the tabs, headings and first rows.
  if (method === 'GET' && path.startsWith('/api/workbook')) return path.includes('flights') ? flights : book;
  // The document crewd reads for its card and panel (src/documents.ts): the headings, paragraphs, lists and tables —
  // a delivered .md is read the same way (the meals demo's plan and list), never opened as the raw file.
  if (method === 'GET' && path.startsWith('/api/document')) return path.includes('dinners-and-shopping-list.md') ? { text: [
    "# This week's dinners",
    '',
    'Seven dinners, nothing over forty minutes on a school night. Friday stays pizza night.',
    '',
    '## The week',
    '',
    '| Day | Dinner | From the list |',
    '|-----|--------|---------------|',
    '| Monday | Chicken pilaf | Basmati rice, yoghurt |',
    '| Tuesday | Aloo keema and roti | Minced beef, potatoes |',
    '| Wednesday | Pasta with the green chutney twist | Fusilli, coriander, mint |',
    '| Thursday | Chana chaat bowls | Chickpeas, tamarind, onion |',
    '| Friday | Pizza night | Ready dough, mozzarella |',
    '| Saturday | Grilled fish and salad | River fish, cucumber, lemon |',
    '| Sunday | Roast chicken — Monday\u2019s leftovers too | Whole chicken, garlic |',
    '',
    '## Shopping list, sorted by aisle',
    '',
    '- [x] Basmati rice (2 kg)',
    '- [x] Yoghurt (1 kg)',
    '- [ ] Minced beef (750 g)',
    '- [ ] Potatoes, onions, tomatoes',
    '- [ ] Mozzarella and ready pizza dough',
    '',
    'The shop day is on your calendar for Saturday morning. Anything ticked was already in the cupboard.',
  ].join('\n') } : doc;
  if (method === 'GET' && path === '/api/about') return { notes: '- Vegetarian at home\n- Two children: Zara (9) and Ali (6)\n- Prefers weekend plans before Thursday' };
  // ?demo=home / ?demo=signin-again: Settings, Phones before Tailscale, and with it signed out.
  if (method === 'GET' && path === '/api/phones/link') return { on: true, lan: false, pinned: false, tailscale: variant !== 'home', relay: '', relayStatus: 'off', asking: [], push: variant === 'home' ? 'missing' : 'ready',
    anywhere: variant === 'home' ? 'home' : variant === 'signin-again' ? 'signin' : 'anywhere' };
  if (method === 'POST' && path === '/api/phones/pair') return { qr: 'crewhouse-demo', typed: '7KQ4-M2XP-9RTH-6N5B-8V3C', expires: Date.now() + 120_000 };
  if (method === 'POST' && path === '/api/phones/refresh') {
    pages.chief.phoneOffer = { ...pages.chief.phoneOffer, token: `demo-${Date.now()}`, expires: Date.now() + 120_000 };
    return pages.chief.phoneOffer;
  }
  if (method === 'POST' && path === '/api/phones/answer') { pages.chief.phoneOffer = { ...pages.chief.phoneOffer, waiting: null, joined: 'Pixel' }; return { ok: true }; }
  if (method === 'GET' && path === '/api/phones') return [{ id: 1, name: "Umer's phone", seen: now - 5 * min, reached: { home: now - 5 * min }, push: 'on' },
    { id: 2, name: "Umer's other phone", seen: now - 2 * 60 * min, reached: { home: now - 26 * 60 * min, tailscale: now - 2 * 60 * min }, push: 'off' }];
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
