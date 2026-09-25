// calendar-axi: the person's own Google Calendar as one small command-shaped tool, in place of Google's hosted MCP server
// (nine tool schemas, about 5,000 tokens on every turn). crewd runs it itself, on the member's Calendar connection: the
// token never leaves crewd. Answers are short TOON (`name[N]{fields}:` then rows). The gate reads the command
// (src/policy.ts): looking is free, adding and moving ask, cancelling asks as a delete.
import { createHash } from 'node:crypto';
import { axiTool } from './engine.ts';

/** Google Calendar's REST API; its events scope is the one a Calendar connection already has. */
export const CALENDAR = 'https://www.googleapis.com/calendar/v3';

const HELP = [
  'calendar                      today, and what is next',
  'calendar week [--from <day>]  seven days of events',
  'calendar free <day>           free slots between 08:00 and 20:00',
  'calendar add "<title>" <when> [--end <when>] [--where <place>] [--note <text>] [--key <k>]   (adding twice is safe)',
  'calendar move <id> <when>     keeps its length',
  'calendar cancel <id>',
  '<day> is YYYY-MM-DD, today or tomorrow; <when> is a <day> alone (all day) or "<day> HH:MM", local time',
];

type Event = { id: string; start: Date; end: Date; allDay: boolean; title: string; where: string };
type Token = () => Promise<string | null>;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const plain = (s: unknown, n = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** "2026-10-03", "today", "tomorrow", optionally followed by " HH:MM" or "THH:MM", in this computer's time zone. */
export function parseWhen(s: string): { at: Date; allDay: boolean } | null {
  const m = /^(\d{4}-\d{2}-\d{2}|today|tomorrow)(?:[ T](\d{1,2}):(\d{2}))?$/i.exec(s.trim());
  if (!m) return null;
  const now = new Date();
  const [y, mo, d] = /^\d/.test(m[1]) ? m[1].split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate() + (/tomorrow/i.test(m[1]) ? 1 : 0)];
  const at = new Date(y, mo - 1, d, m[2] ? Number(m[2]) : 0, m[3] ? Number(m[3]) : 0);
  if (Number.isNaN(at.getTime()) || (m[2] && (Number(m[2]) > 23 || Number(m[3]) > 59))) return null;
  return { at, allDay: !m[2] };
}

export function whenOf(e: Pick<Event, 'start' | 'end' | 'allDay'>) {
  const day = `${e.start.toLocaleDateString('en-GB', { weekday: 'short' })} ${ymd(e.start)}`;
  return e.allDay ? `${day} (all day)` : `${day} ${hm(e.start)}-${hm(e.end)}`;
}

/** A TOON table; a value with a comma, quote or leading space is quoted. */
function table(name: string, fields: string[], rows: Record<string, string>[]) {
  const cell = (v: string) => (/[,"\\]|^\s|\s$|^$/.test(v) ? JSON.stringify(v) : v);
  return [`${name}[${rows.length}]{${fields.join(',')}}:`, ...rows.map((r) => '  ' + fields.map((f) => cell(r[f] ?? '')).join(','))].join('\n');
}

const toEvent = (e: any): Event => {
  const allDay = !e.start?.dateTime;
  const start = allDay ? parseWhen(e.start?.date ?? '')?.at ?? new Date(NaN) : new Date(e.start.dateTime);
  const end = allDay ? parseWhen(e.end?.date ?? '')?.at ?? addDays(start, 1) : new Date(e.end?.dateTime ?? start);
  return { id: String(e.id), start, end, allDay, title: plain(e.summary) || 'Busy', where: plain(e.location, 60) };
};

async function call(token: Token, method: string, path: string, body?: object) {
  const t = await token();
  if (!t) throw new Error('Google Calendar is not connected any more. Ask the person to connect it again (crew_connect).');
  const res = await fetch(`${CALENDAR}/calendars/primary/events${path}`, {
    method, signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body),
  });
  if (res.status === 404 || res.status === 410) throw new Error('No such event. List them again (calendar week) for its id.');
  if (!res.ok) throw new Error(`Google Calendar said ${res.status}. Try again in a moment.`);
  return res.status === 204 ? {} : res.json() as Promise<any>;
}

/** Events between two times, soonest first, cancelled ones left out. */
export async function events(token: Token, from: Date, to: Date, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50', ...extra });
  const { items = [] } = await call(token, 'GET', `?${q}`);
  return (items as any[]).filter((e) => e.status !== 'cancelled').map(toEvent);
}

const span = (at: Date, allDay: boolean, end: Date) => (allDay ? { start: { date: ymd(at) }, end: { date: ymd(end) } } : { start: { dateTime: at.toISOString() }, end: { dateTime: end.toISOString() } });

/** `--name value` options, and the words left over. */
function options(args: string[]) {
  const o: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) o[args[i].slice(2)] = args[++i];
    else rest.push(args[i]);
  }
  return { o, rest };
}

export async function runCalendar(token: Token, args: string[]): Promise<string> {
  const [cmd = 'today', ...more] = args;
  const { o, rest } = options(more);
  const bad = (why: string) => `error: ${why}\nhelp[${HELP.length}]:\n${HELP.map((h) => '  ' + h).join('\n')}`;
  const today = parseWhen('today')!.at;
  if (cmd === 'today') {
    const list = await events(token, today, addDays(today, 1));
    const next = list.find((e) => !e.allDay && e.start.getTime() > Date.now());
    return [table('today', ['id', 'when', 'title'], list.map((e) => ({ id: e.id, when: whenOf(e), title: e.title }))),
      `next: ${next ? `${hm(next.start)} ${next.title}` : 'nothing more today'}`, `help[${HELP.length}]:`, ...HELP.map((h) => '  ' + h)].join('\n');
  }
  if (cmd === 'week') {
    const from = o.from ? parseWhen(o.from) : { at: today };
    if (!from) return bad(`"${o.from}" is not a day`);
    const start = new Date(from.at.getFullYear(), from.at.getMonth(), from.at.getDate());
    const list = await events(token, start, addDays(start, 7));
    const timed = list.filter((e) => !e.allDay);
    const clashes = timed.filter((e, i) => timed.slice(0, i).some((p) => p.end > e.start)).length;
    return [table('events', ['id', 'when', 'title', 'where'], list.map((e) => ({ id: e.id, when: whenOf(e), title: e.title, where: e.where }))),
      `total: ${list.length}`, `clashes: ${clashes}`].join('\n');
  }
  if (cmd === 'free') {
    const day = parseWhen(rest[0] ?? '');
    if (!day) return bad('say which day: calendar free <day>');
    let at = new Date(day.at.getFullYear(), day.at.getMonth(), day.at.getDate(), 8);
    const close = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 20);
    const slots: Record<string, string>[] = [];
    for (const e of (await events(token, at, close)).filter((x) => !x.allDay)) {
      if (e.start > at) slots.push({ from: hm(at), to: hm(e.start < close ? e.start : close) });
      if (e.end > at) at = e.end;
    }
    if (close > at) slots.push({ from: hm(at), to: hm(close) });
    return table('slots', ['from', 'to'], slots);
  }
  if (cmd === 'add') {
    const [title, when] = rest;
    const start = parseWhen(when ?? '');
    if (!plain(title) || !start) return bad('calendar add "<title>" <when>');
    const end = o.end ? parseWhen(o.end) : { at: start.allDay ? addDays(start.at, 1) : new Date(start.at.getTime() + 3_600_000), allDay: start.allDay };
    if (!end || end.allDay !== start.allDay || end.at <= start.at) return bad('--end must be after the start, in the same form');
    // Adding the same thing twice (a retry, a restart) finds the first one: a private key on the event.
    const key = plain(o.key, 64) || createHash('sha256').update(`${plain(title)}|${start.at.toISOString()}`).digest('hex').slice(0, 16);
    const [had] = await events(token, addDays(start.at, -400), addDays(start.at, 400), { privateExtendedProperty: `crewhouse=${key}` });
    if (had) return `exists: {id: ${had.id}, when: ${whenOf(had)}}`;
    const made = toEvent(await call(token, 'POST', '', {
      summary: plain(title, 200), ...span(start.at, start.allDay, end.at), ...(o.where ? { location: plain(o.where, 200) } : {}),
      ...(o.note ? { description: String(o.note).slice(0, 2000) } : {}), extendedProperties: { private: { crewhouse: key } },
    }));
    return `added: {id: ${made.id}, when: ${whenOf(made)}}`;
  }
  if (cmd === 'move' || cmd === 'cancel') {
    const id = rest[0] ?? '';
    // An event id is Google's own (letters and digits); anything else would change the address asked for.
    if (!/^[a-z0-9_]{5,1024}$/i.test(id)) return bad(`calendar ${cmd} <id>, with the id from calendar week`);
    if (cmd === 'cancel') { await call(token, 'DELETE', `/${id}`); return `cancelled: {id: ${id}}`; }
    const to = parseWhen(rest[1] ?? '');
    if (!to) return bad('calendar move <id> <when>');
    const e = toEvent(await call(token, 'GET', `/${id}`));
    const days = Math.max(1, Math.round((e.end.getTime() - e.start.getTime()) / 86_400_000));
    const end = to.allDay ? addDays(to.at, e.allDay ? days : 1) : new Date(to.at.getTime() + (e.allDay ? 3_600_000 : e.end.getTime() - e.start.getTime()));
    const moved = toEvent(await call(token, 'PATCH', `/${id}`, span(to.at, to.allDay, end)));
    return `moved: {id: ${moved.id}, when: ${whenOf(moved)}}`;
  }
  return bad(`no command "${cmd}"`);
}

export const calendarTool = (token: Token) =>
  axiTool('calendar', "The person's own Google Calendar (calendar-axi): see the day or week, find free time, add, move or cancel events",
    (args) => runCalendar(token, args).catch((e) => `error: ${e.message}`));
