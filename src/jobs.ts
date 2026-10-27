// The jobs goal: one board in crewd. The crew writes a role only into Found and Drafted; the person moves it to Applied,
// Interview and Offer. Everything that leaves their hands (apply, send, agree, buy, publish) stays theirs.
import type { Row, Store } from './db.ts';

export const STAGES = ['found', 'drafted', 'applied', 'interview', 'offer'];
export type Goal = { title: string; places: string; floor: string; focus?: string; cv: string; rae: string; will: string; routine: number; since: number };

/** What the form asks that only the person answers: declarations, right to work, sponsorship, pay, notice, consent. Never guessed. */
export const YOURS = ['Declarations you sign', 'Your right to work', 'Visa sponsorship', 'Expected salary', 'Notice period', 'Consent: your data, background checks, references'];
export const ONLY_YOU = /declar|right to work|work in the|eligib|visa|sponsor|salary|compensation|pay expect|notice|consent|background check|reference|criminal|convict|certify|privacy|gender|\brace\b|ethnic|hispanic|veteran|disab|pronoun|sexual|religio|restriction|\bagreement|\bconfirm|can you start|start date/i;
export const WONT = ['Submit an application', 'Send a message to a recruiter or anyone else', 'Accept an offer, terms or any agreement', 'Buy anything', 'Publish anything', 'Answer for you: pay, visa, right to work, notice, consent'];
export const WEEK = 7 * 86_400_000;

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

export const goal = (db: Store): Goal | null => JSON.parse(db.get("SELECT value FROM settings WHERE key = 'jobs.goal'")?.value ?? 'null');
export const setGoal = (db: Store, g: Goal) => db.run("INSERT INTO settings (key, value) VALUES ('jobs.goal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(g));
export const role = (db: Store, id: number) => db.get('SELECT * FROM roles WHERE id = ?', id);

/** Whether a draft's CV line is one of the person's own lines (as written, bullets and case aside); `part` lets a quote be a piece of one. */
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

/** Add a role to Found. A posting already on the board (by its page, or its company and title), passed on or not, is not added twice. */
export function add(db: Store, r: { co: string; title: string; place: string; pay: string; fit: unknown[]; gap: string; url: string }, now = Date.now()) {
  const u = new URL(r.url), key = `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  if (db.get('SELECT 1 FROM roles WHERE key = ? OR (lower(co) = lower(?) AND lower(title) = lower(?))', key, r.co, r.title)) return { dup: true as const };
  const id = Number(db.run('INSERT INTO roles (key, co, title, place, pay, fit, gap, url, found_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', key, r.co, r.title, r.place, r.pay, JSON.stringify(r.fit), r.gap, r.url, now, now).lastInsertRowid);
  db.event('role.found', null, { role: id, co: r.co, title: r.title });
  return { dup: false as const, id };
}

/** The person moves a role. Applying sets the 7-day follow-up draft for the writer; moving on or passing takes it away. */
export function move(db: Store, id: number, stage: string, now = Date.now()) {
  const r = role(db, id), g = goal(db);
  if (!r || !g) throw fail('there is no such role on your board', 404);
  if (![...STAGES, 'passed'].includes(stage)) throw fail(`a role is ${STAGES.join(', ')} or passed`);
  if (stage === r.stage) return;
  db.tx(() => {
    if (r.follow) db.run('DELETE FROM routines WHERE id = ?', r.follow);
    const at = now + WEEK, follow = stage === 'applied' ? Number(db.run("INSERT INTO routines (bot, name, schedule, body, kind, next_at, created_at) VALUES (?, ?, '', ?, 'once', ?, ?)", g.will, `Follow up with ${r.co}`,
      `Draft a short, polite follow-up to ${r.co}'s hiring team about the ${r.title} role the person applied for on ${new Date(now).toDateString()}. Use only facts in this task. Show it with crew_draft (channel email, to "${r.co} hiring team", with a subject). The person sends it; you never do.`, at, now).lastInsertRowid) : null;
    db.run('UPDATE roles SET stage = ?, applied_at = ?, follow = ? WHERE id = ?', stage, stage === 'applied' ? now : r.applied_at, follow, id);
    if (follow) db.event('routine.created', g.will, { routine: follow, name: `Follow up with ${r.co}`, words: 'Drafts a follow-up in 7 days', by: 'person' });
    db.event('role.moved', null, { role: id, co: r.co, from: r.stage, to: stage });
  });
}

/** The board as the app reads it. `drafting`: the writer is on this role's draft now. */
export function view(db: Store) {
  const g = goal(db);
  if (!g) return null;
  const busy = ['queued', 'working', 'needs_you', 'paused'];
  return { goal: { title: g.title, places: g.places, floor: g.floor, since: g.since, rae: g.rae, will: g.will },
    roles: db.all("SELECT r.*, t.state AS tstate FROM roles r LEFT JOIN tasks t ON t.id = r.task WHERE r.stage != 'passed' ORDER BY r.found_at DESC, r.id DESC")
      .map(({ key: _, task: __, tstate, fit, ...r }): Row => ({ ...r, fit: JSON.parse(fit), drafting: r.stage === 'found' && busy.includes(tstate), prepping: r.stage === 'interview' && busy.includes(tstate), prep: prep(db, r.id) })) };
}

/** The interview prep the writer put on a role: the brief (each claim with its page), the likely questions, and what stays the person's. */
export const prep = (db: Store, id: number) => JSON.parse(db.get('SELECT value FROM settings WHERE key = ?', `jobs.prep.${id}`)?.value ?? 'null');
export function setPrep(db: Store, id: number, bot: string, p: object) {
  db.tx(() => { db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `jobs.prep.${id}`, JSON.stringify(p)); db.event('role.prep', bot, { role: id }); });
}

/** The finder's daily job, with the roles already seen added at each run. */
export const findTask = (g: Pick<Goal, 'title' | 'places' | 'floor' | 'cv' | 'focus'>) => `Look for new roles for the person. They want: ${g.title}. Places: ${g.places}.${g.floor ? ` Pay floor: ${g.floor}.` : ''}${g.focus ? ` Favour: ${g.focus}.` : ''}
Search public job postings and company career pages with your web tools, and read each posting yourself before you add it. Before each search, call crew_report with what you are looking for, in a few words (for example: Searching remote AI engineering roles). For each NEW role that fits, call crew_role once: company, title, place, url (the posting's own page), pay (copied word for word from the posting, or empty when it shows none), fit (each says why it fits and quotes the CV line that shows it in cv) and missing (what the posting asks for that the CV does not show, said plainly).
Never claim a skill, a year or a result the CV does not show. Skip roles below the pay floor. You never apply, sign in, send or fill in a form. If nothing new fits, reply exactly ALL-CLEAR; otherwise reply with one line: how many roles you added.
Their CV, line by line:
${g.cv}`;
export const seen = (db: Store) => `\n\n[Crewhouse] Already on the board or passed on (do not add them again): ${db.all('SELECT co, title FROM roles').map((r) => `${r.co}, ${r.title}`).join('; ') || 'nothing yet'}.`;

/** The writer's job for one role, from the person's tap on Draft my application. */
export const draftTask = (g: Pick<Goal, 'cv'>, r: Row) => `Draft the person's application for this role. You write; they copy, check and apply on the company's own site.
Role: ${r.title} at ${r.co} (${r.place}). Posting: ${r.url}. Pay: ${r.pay || 'not in the posting'}.
Read the posting. Then call crew_application once: role ${r.id}; cv (the person's own CV lines, copied exactly as written, picked and ordered to lead with what this role asks for; never reword, never add a line); answers (the cover questions the posting asks, each answered only from the CV; if it asks none, "Why do you want to work at ${r.co}?"); yours (any form question about what they declare or sign, right to work, visa, pay, notice or consent: leave it out of answers). You never apply, send or submit.
Their CV, line by line:
${g.cv}`;

/** The writer's job on the posting's own form, from the person's tap on Fill it in for me: their words only, nothing sent. */
export const fillTask = (g: Pick<Goal, 'cv'>, r: Row, draft: string) => `Fill in the person's application form for ${r.title} at ${r.co} in your own browser. You fill; only the person submits.
Open ${r.url} with browser goto and find its application form (an Apply link may lead to it). Fill each text line you can with browser fill, using only words from their CV or the approved draft below, as written: their name, contact details, the CV lines and the cover answers. Leave everything else empty for them: what they declare or sign, right to work, visa or sponsorship, pay, notice, consent, who they are, every dropdown, tick box and file, and anything the CV and draft do not say.
Never sign in, make an account, upload a file, or press a button once you have filled a line. Then call crew_form once: role ${r.id}, and \`stop\` only when the form needs a sign-in or an account, wants a CV file, goes on over more pages, or the site asks whether you are human (say which, plainly).
Then make their reading pack: ${pack(r, '3 to 5 questions to test themselves with')} Reply with one line.
The approved draft:
${draft}
Their CV, line by line:
${g.cv}`;

/** The reading pack's one call: what the company sells, the role day to day and the interview loop, each fact from its own page. */
const pack = (r: Row, qs: string) => `read the posting and the company's own public pages, then call crew_prep once: role ${r.id}; brief (5 to 10 facts, each saying one thing in \`says\`, in \`part\` which it is about: \`company\` (who they are and what they sell), \`role\` (the job's real day to day, from the posting) or \`loop\` (their interview stages and topics), the https page that shows it in \`url\`, and in \`quote\` words copied from that page; a fact with no page is left out, and crewd says so where a part has none); questions (${qs}, each with \`why\` they ask it, in a sentence). Questions about pay, notice, visa, right to work or consent are theirs to answer: they are listed for them, never answered.`;

/** The writer's job for a role in Interview, from the person's tap on Prep for this interview. */
export const prepTask = (g: Pick<Goal, 'cv'>, r: Row) => `Prepare the person for their interview. You write; they read it and answer for themselves.
Role: ${r.title} at ${r.co} (${r.place}). Posting: ${r.url}.
${pack(r, '6 to 10 questions they are likely to be asked for this role')}
You never apply, send or contact anyone, and you never write their answers or sign anything. Reply with one line.
Their CV, line by line:
${g.cv}`;

/** The practice interviewer: the writer asks the questions in this chat, one at a time, and answers with feedback. */
export const practiceTask = (g: Pick<Goal, 'cv'>, r: Row, p: { questions: { ask: string }[] }) => `Be the interviewer for the person's ${r.title} interview at ${r.co}, here in this chat, until they say stop. They answer by typing or speaking; you only write.
Ask ONE question at a time, in this order, and wait for the answer:
${p.questions.map((q, i) => `${i + 1}. ${q.ask}`).join('\n')}
After each answer reply in plain words, in three short paragraphs with a blank line between: "What landed:" (what worked, in their own words), "To tighten:" (one or two specific things), then an invitation to try that answer again or say next. Judge it against their CV below; never add a fact about them, and never write the answer for them.
A question about pay, notice, visa, right to work or consent is theirs alone to answer: say so, give no figure or wording, and move on. You never send, apply or contact anyone.
Their CV, line by line:
${g.cv}
Start now with question 1.`;
