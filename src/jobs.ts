// Long goals: a board in crewd per goal. A goal names its own stages; the crew writes only into its first `crew` stages (a finder
// adds to the first, a writer may draft into the second) and the person moves everything after. Everything that leaves their hands
// (apply, send, sign, agree, buy, publish) stays theirs. The job search is the first goal; a flat or a university place is the same parts.
import type { Row, Store } from './db.ts';
import type { BlockSpec } from './documents.ts';

export const JOB_STAGES = ['Found', 'Drafted', 'Applied', 'Interview', 'Offer'];
export type Goal = { id: number; title: string; places: string; floor: string; focus?: string; brief: string; rae: string; will: string; routine: number; since: number;
  stages: string[]; crew: number; follow: string; sources: string; wont: string[]; asks: string[] };

/** What the form asks that only the person answers: declarations, right to work, sponsorship, pay, notice, consent. Never guessed. */
export const YOURS = ['Declarations you sign', 'Your right to work', 'Visa sponsorship', 'Expected salary', 'Notice period', 'Consent: your data, background checks, references'];
export const ONLY_YOU = /declar|right to work|work in the|eligib|visa|sponsor|salary|compensation|pay expect|notice|consent|background check|reference|criminal|convict|certify|privacy|gender|\brace\b|ethnic|hispanic|veteran|disab|pronoun|sexual|religio|restriction|\bagreement|\bconfirm|can you start|start date/i;
export const WONT = ['Submit an application', 'Send a message to a recruiter or anyone else', 'Accept an offer, terms or any agreement', 'Buy anything', 'Publish anything', 'Answer for you: pay, visa, right to work, notice, consent'];
/** The same promise for a goal that is not a job search. */
export const GENERAL_WONT = ['Submit, sign or send anything for you', 'Contact anyone on your behalf', 'Accept an offer, terms or any agreement', 'Pay or buy anything', 'Publish anything', 'Answer for you what only you can: declarations, consent, money'];
export const JOB_SOURCES = 'public job postings and company career pages';
export const WEEK = 7 * 86_400_000;
/** What the person's strategy ranks a role on, weightiest first. A signal is the page's own words (`quote`), checked against that page, and
 *  must read as its kind and not as a "no", so a quote about something else, or a refusal, never ranks a role. */
export const SIGNALS: Record<string, [label: string, says?: RegExp]> = { remote: ['Remote', /remote|work from (home|anywhere)|distributed/i], gateway: ['Gateway company'], fast: ['Fast process'], sponsor: ['Sponsorship history', /sponsor|visa|h-?1b|work permit/i] };
export const NEGATED = /\b(no|not|never|unable|cannot|without)\b[^.]{0,40}\b(sponsor|visa|remote)/i;
export type Signal = { kind: string; quote: string; url: string };
const score = (signals: string | null) => (JSON.parse(signals ?? '[]') as Signal[]).reduce((n, s) => n + 2 ** (3 - Object.keys(SIGNALS).indexOf(s.kind)), 0);
/** Rows in the person's order: the more of the strategy a page shows the earlier (remote beats all the rest together); equals keep the order they came in. */
export const ranked = <T extends Row>(rows: T[]) => rows.sort((a, b) => score(b.signals) - score(a.signals));

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A stage's key: its name, lower case ("Viewing booked" is viewing-booked). */
export const key = (name: string) => norm(name).replace(/ /g, '-');
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

const read = (db: Store, k: string) => JSON.parse(db.get('SELECT value FROM settings WHERE key = ?', k)?.value ?? 'null');
/** Every goal, oldest first. The first job search, kept before goals had stages of their own, reads as the job-search stages. */
export const goals = (db: Store): Goal[] => read(db, 'goals') ?? [read(db, 'jobs.goal')].filter(Boolean)
  .map((g) => ({ id: 1, stages: JOB_STAGES, crew: 2, follow: 'applied', sources: JOB_SOURCES, wont: WONT, asks: YOURS, ...g, brief: g.brief ?? g.cv }));
export const goal = (db: Store, id?: number): Goal | null => goals(db).find((g) => !id || g.id === id) ?? null;
export const nextId = (db: Store) => Math.max(0, ...goals(db).map((g) => g.id)) + 1;
export const addGoal = (db: Store, g: Goal) => db.run("INSERT INTO settings (key, value) VALUES ('goals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify([...goals(db), g]));
export const role = (db: Store, id: number) => db.get('SELECT * FROM roles WHERE id = ?', id);

/** The stage names the person gave, or null when they are not 2 to 8 distinct names. */
export const namesOf = (v: unknown) => { const n = (Array.isArray(v) ? v : []).map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 24)).filter(Boolean); return n.length >= 2 && n.length <= 8 && new Set(n.map(key)).size === n.length && !n.some((s) => key(s) === 'passed') ? n : null; };

/** Whether a draft's brief line is one of the person's own lines (as written, bullets and case aside); `part` lets a quote be a piece of one. */
export const inCv = (cv: string, line: string, part = false) => { const n = norm(line); return n.length >= 8 && (part ? norm(cv).includes(n) : cv.split('\n').some((l) => norm(l) === n)); };

/** Whether a line typed on a form comes from the person's own words (whole words, as written); a bare yes or no never does. */
export const sourced = (src: string, v: string) => { const n = norm(v); return !!n && !/^(yes|no|y|n|true|false)$/.test(n) && ` ${norm(src)} `.includes(` ${n} `); };

export type Field = { label: string; kind: 'text' | 'pick' | 'tick' | 'file'; options?: string[]; yours: boolean };
/** An application form as its own page shows it (crewd's snapshot, never the model's): the fields nobody has filled, the
 *  button that sends it (or the Next of a form that goes on), and each field's ref by label (a radio by `group\nlabel`). */
export function formOf(snapshot: string, filled: string[]) {
  const fields: Field[] = [], refs: Record<string, string> = {}, at = (label: string) => fields.find((f) => f.label === label);
  let submit = '', next = '', group = { label: '', depth: -1 }, said = '';
  for (const line of snapshot.split('\n')) {
    // A question written above its control (Ashby): it names a box called only by its placeholder, and its Yes/No buttons.
    const q = /^\s*- generic(?: \[ref=[\w-]+\])?: (.+)$/.exec(line); if (q) said = q[1].trim();
    const m = /^(\s*)- (textbox|combobox|checkbox|radio|option|button|group|radiogroup) "((?:[^"\\]|\\.)*)"(?:.*\[ref=([\w-]+)\])?/.exec(line);
    if (!m) continue;
    const [, pad, role, raw, ref] = m, label = raw.replace(/\\"/g, '"').trim(), last = fields.at(-1);
    if (pad.length <= group.depth) group = { label: '', depth: -1 };
    if (role === 'group' || role === 'radiogroup') { group = { label, depth: pad.length }; continue; }
    if (role === 'option') { if (ref) refs[`option\n${label}`] ??= ref; if (last?.kind === 'pick') (last.options ??= []).push(label); continue; }
    const yes = role === 'button' && !!said && /^(yes|no)$/i.test(label), up = group.label || said;
    if (role === 'button' && !yes) {
      if (/submit|send (my |your )?application/i.test(label)) { submit = label; refs[label] = ref; } else if (/^(next|continue)\b/i.test(label)) next ||= label;
      else if (/^(attach|upload|choose file)/i.test(label) && up && !at(up)) fields.push({ label: up, kind: 'file', yours: true });
      continue;
    }
    const pick = role === 'radio' || yes, of = role === 'radio' ? group.label : said, name = !pick && said && /\.\.\.$/.test(label) ? said : label;
    const key = pick ? `${of}\n${label}` : name;
    if (filled.includes(name) || refs[key]) continue;
    refs[key] = ref;
    if (pick) { const f = at(of); if (f) (f.options ??= []).push(label); else fields.push({ label: of || label, kind: 'pick', options: [label], yours: ONLY_YOU.test(of || label) }); continue; }
    fields.push({ label: name, kind: role === 'checkbox' ? 'tick' : role === 'combobox' ? 'pick' : 'text', yours: ONLY_YOU.test(name) });
  }
  return { fields, submit, next, refs };
}

/** Add an item to a goal's first stage. A page already on that board (by its page, or its company and title), passed on or not, is not added twice. */
export function add(db: Store, gid: number, r: { co: string; title: string; place: string; pay: string; fit: unknown[]; gap: string; url: string; signals?: Signal[] }, now = Date.now()) {
  const u = new URL(r.url), k = `${gid === 1 ? '' : `${gid}:`}${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  if (db.get('SELECT 1 FROM roles WHERE goal = ? AND (key = ? OR (lower(co) = lower(?) AND lower(title) = lower(?)))', gid, k, r.co, r.title)) return { dup: true as const };
  const id = Number(db.run('INSERT INTO roles (goal, key, co, title, place, pay, fit, gap, url, found_at, checked_at, stage, signals) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', gid, k, r.co, r.title, r.place, r.pay, JSON.stringify(r.fit), r.gap, r.url, now, now, key(goal(db, gid)!.stages[0]), JSON.stringify(r.signals ?? [])).lastInsertRowid);
  db.event('role.found', null, { role: id, goal: gid, co: r.co, title: r.title });
  return { dup: false as const, id };
}

/** The person moves an item. A goal's follow-up stage sets the 7-day follow-up draft for its writer; moving on or passing takes it away, and a pass drops its reminders. */
export function move(db: Store, id: number, stage: string, now = Date.now()) {
  const r = role(db, id), g = r && goal(db, r.goal);
  if (!r || !g) throw fail('there is no such item on your board', 404);
  const keys = g.stages.map(key);
  if (![...keys, 'passed'].includes(stage)) throw fail(`a stage is ${keys.join(', ')} or passed`);
  if (stage === r.stage) return;
  db.tx(() => {
    if (r.follow) db.run('DELETE FROM routines WHERE id = ?', r.follow);
    if (stage === 'passed') db.run("DELETE FROM routines WHERE item = ? AND kind = 'remind'", id);
    const at = now + WEEK, follow = g.will && stage === g.follow ? Number(db.run("INSERT INTO routines (bot, name, schedule, body, kind, next_at, created_at) VALUES (?, ?, '', ?, 'once', ?, ?)", g.will, `Follow up with ${r.co}`,
      `Draft a short, polite follow-up to ${r.co}'s hiring team about the ${r.title} role the person applied for on ${new Date(now).toDateString()}. Use only facts in this task. Show it with crew_draft (channel email, to "${r.co} hiring team", with a subject). The person sends it; you never do.`, at, now).lastInsertRowid) : null;
    db.run('UPDATE roles SET stage = ?, applied_at = ?, follow = ? WHERE id = ?', stage, stage === g.follow ? now : r.applied_at, follow, id);
    if (follow) db.event('routine.created', g.will, { routine: follow, name: `Follow up with ${r.co}`, words: 'Drafts a follow-up in 7 days', by: 'person' });
    db.event('role.moved', null, { role: id, co: r.co, from: r.stage, to: stage });
  });
}

/** One goal's board as the app reads it. `drafting`: the writer is on this item's draft now. */
export function view(db: Store, g = goal(db)) {
  if (!g) return null;
  const busy = ['queued', 'working', 'needs_you', 'paused'];
  return { goal: { id: g.id, title: g.title, places: g.places, floor: g.floor, since: g.since, rae: g.rae, will: g.will, stages: g.stages.map((name) => ({ key: key(name), name })), crew: g.crew, wont: g.wont, asks: g.asks },
    roles: ranked(db.all("SELECT r.*, t.state AS tstate FROM roles r LEFT JOIN tasks t ON t.id = r.task WHERE r.goal = ? AND r.stage != 'passed' ORDER BY r.found_at DESC, r.id DESC", g.id))
      .map(({ key: _, task: __, tstate, fit, signals, ...r }): Row => ({ ...r, fit: JSON.parse(fit), signals: JSON.parse(signals ?? '[]').map((x: Signal) => ({ ...x, label: SIGNALS[x.kind][0] })), drafting: r.stage === key(g.stages[0]) && busy.includes(tstate), prepping: r.stage === 'interview' && busy.includes(tstate), prep: prep(db, r.id) })) };
}


/** The interview prep the writer put on a role: the brief (each claim with its page), the likely questions, and what stays the person's. */
export const prep = (db: Store, id: number) => JSON.parse(db.get('SELECT value FROM settings WHERE key = ?', `jobs.prep.${id}`)?.value ?? 'null');
export function setPrep(db: Store, id: number, bot: string, p: object) {
  db.tx(() => { db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `jobs.prep.${id}`, JSON.stringify(p)); db.event('role.prep', bot, { role: id }); });
}
export const views = (db: Store) => goals(db).map((g) => view(db, g)!);

/** The finder's daily job. The board is its report: crewd keeps the run out of Chief's thread, so it never pages the person. */
export const findTask = (g: Pick<Goal, 'id' | 'title' | 'places' | 'floor' | 'focus' | 'brief' | 'sources'>) => `Look for new options for the person's goal: ${g.title}. Where: ${g.places}.${g.floor ? ` Their limit: ${g.floor}.` : ''}${g.focus ? ` Favour: ${g.focus}.` : ''}
Search ${g.sources} with your web tools, and read each page yourself before you add it. Before each search, call crew_report with what you are looking for, in a few words (for example: Searching remote AI engineering roles). For each NEW one that fits, call crew_role once with goal ${g.id}: company (who it is from), title, place, url (its own page), pay (the figure copied word for word from the page, or empty when it shows none), fit (each says why it fits and quotes the line of their brief that shows it in cv) and missing (what it asks for that their brief does not show, said plainly).${g.sources === JOB_SOURCES ? ` Rank them for the person: add signals, only those a page shows, each a kind and quote (words copied from that page) and url when the page is not the posting: remote (the posting says the role is remote), gateway (a well-known brand with US ties, a record of sponsoring visas, or internal transfers), fast (a short hiring process), sponsor (it sponsors visas). Leave out a signal you cannot quote; never guess a fact about a company.` : ''}
Never claim anything their brief does not show. Skip anything past their limit. You never apply, sign in, send, book, pay or fill in a form. The board is the report: when you are done, reply with one short line saying how many you added, or exactly ALL-CLEAR when none.
Their brief, line by line:
${g.brief}`;
/** What the daily run is told is already on this goal's board, passed on or not. */
export const seen = (db: Store, routine: number) => { const g = goals(db).find((x) => x.routine === routine); return g ? `\n\n[Crewhouse] Already on the board or passed on (do not add them again): ${db.all('SELECT co, title FROM roles WHERE goal = ?', g.id).map((r) => `${r.co}, ${r.title}`).join('; ') || 'nothing yet'}.` : ''; };

/** The writer's job for one role, from the person's tap on Draft my application. */
export const draftTask = (g: Pick<Goal, 'brief'>, r: Row) => `Draft the person's application for this role. You write; they copy, check and apply on the company's own site.
Role: ${r.title} at ${r.co} (${r.place}). Posting: ${r.url}. Pay: ${r.pay || 'not in the posting'}.
Read the posting. Then call crew_application once: role ${r.id}; cv (the person's own CV lines, copied exactly as written, picked and ordered to lead with what this role asks for; never reword, never add a line); answers (the cover questions the posting asks, each answered only from the CV; if it asks none, "Why do you want to work at ${r.co}?"); yours (any form question about what they declare or sign, right to work, visa, pay, notice or consent: leave it out of answers). You never apply, send or submit.
Their CV, line by line:
${g.brief}`;

/** The writer's job on the posting's own form, from the person's tap on Fill it in for me: their words only, nothing sent. */
export const fillTask = (g: Pick<Goal, 'brief'>, r: Row, draft: string) => `Fill in the person's application form for ${r.title} at ${r.co} in your own browser. You fill; only the person submits.
Open ${r.url} with browser goto and find its application form (an Apply link may lead to it). Fill each text line you can with browser fill, using only words from their CV or the approved draft below, as written: their name, contact details, the CV lines and the cover answers. Leave everything else empty for them: what they declare or sign, right to work, visa or sponsorship, pay, notice, consent, who they are, every dropdown, tick box and file, and anything the CV and draft do not say.
Never sign in, make an account, upload a file, or press a button once you have filled a line. Then call crew_form once: role ${r.id}, and \`stop\` only when the form needs a sign-in or an account, wants a CV file, goes on over more pages, or the site asks whether you are human (say which, plainly).
Reply with one line.
The approved draft:
${draft}
Their CV, line by line:
${g.brief}`;

/** The writer's job for a role in Interview, from the person's tap on Prep for this interview. */
export const prepTask = (g: Pick<Goal, 'brief'>, r: Row) => `Prepare the person for their interview. You write; they read it and answer for themselves.
Role: ${r.title} at ${r.co} (${r.place}). Posting: ${r.url}.
Read the posting and the company's own public pages, then call crew_prep once: role ${r.id}; brief (the one-page company brief: 5 to 10 facts, each saying one thing in \`says\`, the https page that shows it in \`url\`, and in \`quote\` words copied from that page; a fact with no page is left out); questions (6 to 10 questions they are likely to be asked for this role, each with \`why\` they ask it, in a sentence). Questions about pay, notice, visa, right to work or consent are theirs to answer: they are listed for them, never answered.
You never apply, send or contact anyone, and you never write their answers or sign anything. Reply with one line.
Their CV, line by line:
${g.brief}`;

/** The practice interviewer: the writer asks the questions in this chat, one at a time, and answers with feedback. */
export const practiceTask = (g: Pick<Goal, 'brief'>, r: Row, p: { questions: { ask: string }[] }) => `Be the interviewer for the person's ${r.title} interview at ${r.co}, here in this chat, until they say stop. They answer by typing or speaking; you only write.
Ask ONE question at a time, in this order, and wait for the answer:
${p.questions.map((q, i) => `${i + 1}. ${q.ask}`).join('\n')}
After each answer reply in plain words, in three short paragraphs with a blank line between: "What landed:" (what worked, in their own words), "To tighten:" (one or two specific things), then an invitation to try that answer again or say next. Judge it against their CV below; never add a fact about them, and never write the answer for them.
A question about pay, notice, visa, right to work or consent is theirs alone to answer: say so, give no figure or wording, and move on. You never send, apply or contact anyone.
Their CV, line by line:
${g.brief}
Start now with question 1.`;

/** The resume: Chief's sections of the person's own lines, with crewd's record of when they wrote each part (`from`). */
export const RESUME = 'files/resume.docx';
export type Section = { heading: string; lines: string[]; from: number[]; edited?: boolean };
const PRIVATE = /^\s*private\s*:|\(\s*private\s*\)/i, HEADS = /^(summary|profile|about me|experience|work experience|work history|employment|education|skills|projects|certifications?|licen[cs]es|languages|links|contact|awards|publications|volunteering|interests)$/i;
export const resume = (db: Store): { sections: Section[] } | null => JSON.parse(db.get("SELECT value FROM settings WHERE key = 'jobs.resume'")?.value ?? 'null');
export const setResume = (db: Store, sections: Section[]) => db.run("INSERT INTO settings (key, value) VALUES ('jobs.resume', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ sections }));
const sections = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 20).map((s: Row) => ({ heading: String(s?.heading ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
  lines: (Array.isArray(s?.lines) ? s.lines : []).map((l: unknown) => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)).filter(Boolean).slice(0, 40) }));

/** Chief's resume, checked against what the person wrote in his chat: every line is a piece of one of their lines (case and
 *  punctuation aside) and never one they marked private ("private:" or "(private)"); a heading is a plain section name or their words. */
export function traced(said: { at: number; text: string }[], v: unknown): Section[] {
  const own = said.flatMap((m) => String(m.text).split('[tool ')[0].split('\n').map((l) => ({ at: m.at, l: ` ${norm(l)} `, hidden: PRIVATE.test(l) }))), out = sections(v).filter((s) => s.lines.length);
  if (!out.length) throw fail('give the sections of their resume, each with their own lines');
  return out.map((s) => {
    const from = new Set<number>(), find = (line: string) => {
      const hits = own.filter((o) => norm(line) && o.l.includes(` ${norm(line)} `)), open = hits.filter((o) => !o.hidden);
      if (!open.length) throw fail(hits.length ? `“${line.slice(0, 60)}” is something they marked private, so it stays out.` : `“${line.slice(0, 60)}” is not in what they told you. Use their own words, or ask them for it.`);
      open.forEach((o) => from.add(o.at));
    };
    if (s.heading && !HEADS.test(s.heading)) find(s.heading);
    s.lines.forEach(find);
    return { ...s, from: [...from].sort((a, b) => a - b) };
  });
}
/** The person's own edit, as typed: nothing is checked against the chat, and a section whose words changed says they edited it. */
export const edited = (was: Section[], v: unknown): Section[] => sections(v).map((s, i) => ({ ...s, from: was[i]?.from ?? [],
  edited: !!was[i]?.edited || was[i]?.heading !== s.heading || was[i]?.lines.join('\n') !== s.lines.join('\n') })).filter((s) => s.lines.length);
/** The document's blocks: their name as its title, the other top lines under it, then each section's heading over its lines. */
export const blocks = (all: Section[]) => all.flatMap((s, i): BlockSpec[] => s.heading ? [{ heading: s.heading, level: 2 }, { bullets: s.lines }] : s.lines.map((text, j) => i || j ? { text } : { heading: text, level: 1 }));
