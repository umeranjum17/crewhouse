// Plain-words schedules: "every Monday 9:00", "weekdays at 8am", "every day 7:30pm", "every 2 hours".
// Times are the computer's local time, so a routine keeps its wall-clock hour across daylight saving.

/** Either a clock time on some weekdays (0 = Sunday), or a fixed interval in minutes. */
export type Schedule = { days: number[]; at: number; guessed?: boolean } | { every: number };

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const bad = (text: string) => Object.assign(new Error(`I can't read "${text}" as a schedule; try "every Monday 9:00", "weekdays at 8am" or "every 2 hours"`), { status: 400 });
const whenBad = (text: string) => Object.assign(new Error(`I can't read "${text}" as a time; try "Friday 9:00", "tomorrow 8am" or "in 20 minutes"`), { status: 400 });

const NUMS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numOf = (w: string) => NUMS.indexOf(w) + 1;

export function parseSchedule(text: string): Schedule {
  const s = String(text).toLowerCase().replace(/[,.]/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(am|pm)\b/g, (_, n, ap) => `${numOf(n)}${ap}`)
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2').trim();
  const every = /^(?:every|each)\s+(\d+\s*)?(minute|min|hour|hr)s?$/.exec(s) ?? (s === 'hourly' ? [s, '1', 'hour'] : null);
  if (every) {
    const n = Number(every[1] ?? 1) * (every[2].startsWith('h') ? 60 : 1);
    if (!(n >= 1 && n <= 7 * 24 * 60)) throw bad(text);
    return { every: n };
  }
  const days = new Set<number>();
  let at: number | undefined;
  let tod: number | undefined; // morning/evening/night: a default hour, never a day
  for (const w of s.split(/\s+/)) {
    if (['every', 'each', 'at', 'on', 'and', 'in', 'the'].includes(w)) continue;
    const t = /^(\d{1,2})(?::(\d\d))?(am|pm)?$/.exec(w);
    if (t && at === undefined) {
      let h = Number(t[1]);
      const m = Number(t[2] ?? 0);
      if (t[3] && (h < 1 || h > 12)) throw bad(text);
      if (t[3]) h = (h % 12) + (t[3] === 'pm' ? 12 : 0);
      if (h > 23 || m > 59) throw bad(text);
      at = h * 60 + m;
    } else if (w === 'noon') at = 12 * 60;
    else if (w === 'midnight') at = 0;
    else if (/^(day|days|daily|everyday)$/.test(w)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
    else if (w === 'morning') tod ??= 9 * 60;
    else if (w === 'evening') tod ??= 18 * 60;
    else if (w === 'night') tod ??= 21 * 60;
    else if (/^weekdays?$/.test(w)) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
    else if (/^weekends?$/.test(w)) [0, 6].forEach((d) => days.add(d));
    else {
      // "Friday at five" is the working day's end, not the small hours; seven to eleven keep the morning.
      const n = numOf(w);
      if (n > 0 && at === undefined) at = (n <= 6 ? n + 12 : n) * 60;
      else {
        const d = DAYS.findIndex((x, i) => w.startsWith(x) && NAMES[i].toLowerCase().startsWith(w.replace(/s$/, '')));
        if (d < 0) throw bad(text);
        days.add(d);
      }
    }
  }
  if (!days.size && tod !== undefined) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d)); // "every evening"
  if (!days.size) throw bad(text);
  // "every Monday" means the start of the working day; `guessed` says the words never named a time, so a card asks about it.
  return { days: [...days].sort(), at: at ?? tod ?? 9 * 60, guessed: at === undefined && tod === undefined };
}

export const hhmm = (at: number) => new Date(2000, 0, 1, Math.floor(at / 60), at % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** The schedule back in plain words: "Every Monday at 9:00 am". */
export function describe(s: Schedule) {
  if ('every' in s) return s.every % 60 ? `Every ${s.every === 1 ? 'minute' : `${s.every} minutes`}` : `Every ${s.every === 60 ? 'hour' : `${s.every / 60} hours`}`;
  const d = s.days.join();
  const days = d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends'
    : `Every ${s.days.map((x) => NAMES[x]).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `${days} at ${hhmm(s.at)}`;
}


/** The first run in words, naming its day unless it is today: "Thu 8:00 am", so it never reads as some other day. */
export function firstRun(at: number, now = Date.now()) {
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return hhmmOf(d);
  const day = Math.abs(at - now) < 6 * 86_400_000 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day} ${hhmmOf(d)}`;
}
const hhmmOf = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s([AP])M$/, (m) => m.toLowerCase());

/** The first run strictly after `after` (epoch ms). */
export function nextRun(s: Schedule, after: number) {
  if ('every' in s) return after + s.every * 60_000;
  const d = new Date(after);
  for (let i = 0; i <= 7; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, Math.floor(s.at / 60), s.at % 60);
    if (c.getTime() > after && s.days.includes(c.getDay())) return c.getTime();
  }
  throw new Error('unreachable: a schedule always has a day');
}

/** The moment a one-off reminder is due, in the person's own words: "in 20 minutes" counts from now, and "today",
 *  "tomorrow" and a weekday name ("friday 9:00") are the same clock the routines keep. */
export function reminderAt(text: string, now = Date.now()) {
  const day = (n: number) => DAYS[(new Date(now).getDay() + n) % 7];
  const s = String(text).toLowerCase().trim().replace(/\btomorrow\b/, () => day(1)).replace(/\btoday\b/, () => day(0));
  const rel = /^in\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?)$/.exec(s);
  if (rel) return now + Number(rel[1]) * (rel[2][0] === 'h' ? 60 : 1) * 60_000;
  try { return nextRun(parseSchedule(s.replace(/^(at|on)\s+/, '')), now); } catch { throw whenBad(text); }
}

/** A local event that starts a routine instead of (or as well as) a time: a file arriving in the helper's
 *  inbox, or the computer waking. The inbox is fixed per helper, so the words never carry a path. */
export type Trigger = { file: true } | { wake: true };

const triggerBad = (text: string) => Object.assign(new Error(`I can't start anything on "${text}"; try "when a file arrives in the inbox" or "when this computer wakes up"`), { status: 400 });

export function parseTrigger(text: string): Trigger {
  const s = String(text).toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s.startsWith('when ')) throw triggerBad(text);
  if (/\b(wake|wakes|woke|waking)\b/.test(s) && /\b(computer|machine|laptop|mac|pc)\b/.test(s)) return { wake: true };
  if (/\b(file|files|photo|photos|picture|pictures|receipt|receipts|attachment|document)\b/.test(s) &&
    /\b(arrive|arrives|arriving|land|lands|landing|drop|dropped|added|appear|appears|show|shows)\b/.test(s)) return { file: true };
  throw triggerBad(text);
}

/** The trigger back in plain words; `who` is the helper's display name, whose inbox the file trigger watches. */
export function describeTrigger(t: Trigger, who: string) {
  return 'file' in t ? `When a file arrives in ${who}'s inbox` : 'When this computer wakes up';
}
