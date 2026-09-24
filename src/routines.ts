// Plain-words schedules: "every Monday 9:00", "weekdays at 8am", "every day 7:30pm", "every 2 hours".
// Times are the computer's local time, so a routine keeps its wall-clock hour across daylight saving.

/** Either a clock time on some weekdays (0 = Sunday), or a fixed interval in minutes. */
export type Schedule = { days: number[]; at: number } | { every: number };

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const bad = (text: string) => Object.assign(new Error(`I can't read "${text}" as a schedule; try "every Monday 9:00", "weekdays at 8am" or "every 2 hours"`), { status: 400 });

export function parseSchedule(text: string): Schedule {
  const s = String(text).toLowerCase().replace(/[,.]/g, ' ').replace(/(\d)\s+(am|pm)\b/g, '$1$2').trim();
  const every = /^(?:every|each)\s+(\d+\s*)?(minute|min|hour|hr)s?$/.exec(s) ?? (s === 'hourly' ? [s, '1', 'hour'] : null);
  if (every) {
    const n = Number(every[1] ?? 1) * (every[2].startsWith('h') ? 60 : 1);
    if (!(n >= 1 && n <= 7 * 24 * 60)) throw bad(text);
    return { every: n };
  }
  const days = new Set<number>();
  let at: number | undefined;
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
    else if (/^(day|days|daily|everyday|night|morning|evening)$/.test(w)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
    else if (/^weekdays?$/.test(w)) [1, 2, 3, 4, 5].forEach((d) => days.add(d));
    else if (/^weekends?$/.test(w)) [0, 6].forEach((d) => days.add(d));
    else {
      const d = DAYS.findIndex((x, i) => w.startsWith(x) && NAMES[i].toLowerCase().startsWith(w.replace(/s$/, '')));
      if (d < 0) throw bad(text);
      days.add(d);
    }
  }
  if (!days.size) throw bad(text);
  return { days: [...days].sort(), at: at ?? 9 * 60 }; // "every Monday" means the start of the working day
}

const hhmm = (at: number) => new Date(2000, 0, 1, Math.floor(at / 60), at % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** The schedule back in plain words: "Every Monday at 9:00 am". */
export function describe(s: Schedule) {
  if ('every' in s) return s.every % 60 ? `Every ${s.every === 1 ? 'minute' : `${s.every} minutes`}` : `Every ${s.every === 60 ? 'hour' : `${s.every / 60} hours`}`;
  const d = s.days.join();
  const days = d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends'
    : `Every ${s.days.map((x) => NAMES[x]).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `${days} at ${hhmm(s.at)}`;
}

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
