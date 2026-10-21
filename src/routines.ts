// Plain-words schedules: "every Monday 9:00", "weekdays at 8am", "every day 7:30pm", "the 1st of every month 9:00", "every 2 hours".
// Times are the computer's local time, so a routine keeps its wall-clock hour across daylight saving.

/** Either a clock time on some weekdays (0 = Sunday), a date each month (`dom`, 1-31), or a fixed interval in minutes. */
export type Schedule = { days: number[]; at: number; guessed?: boolean } | { dom: number; at: number; guessed?: boolean } | { every: number };

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], bad = (text: string) => Object.assign(new Error(`I can't read "${text}" as a schedule; try "every Monday 9:00", "weekdays at 8am", "the 1st of every month 9:00" or "every 2 hours"`), { status: 400 }), whenBad = (text: string) => Object.assign(new Error(`I can't read "${text}" as a time; try "Friday 9:00", "tomorrow 8am" or "in 20 minutes"`), { status: 400 });

const NUMS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'], numOf = (w: string) => NUMS.indexOf(w) + 1, ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
export function parseSchedule(text: string): Schedule {
  let s = String(text).toLowerCase().replace(/[,.]/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(am|pm)\b/g, (_, n, ap) => `${numOf(n)}${ap}`)
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2').trim();
  // A date each month: the month word is the gate, so an ordinal ("the 1st") or a bare "the 15" beside it is a date, not a time.
  const date = /\bmonth/.test(s) ? /\b(?:on\s+the\s+|the\s+)([1-9]|[12]\d|3[01])\b|\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)\b/.exec(s) : null, dom = date ? Number(date[1] ?? date[2]) : 0;
  if (dom) s = s.replace(date![0], ' ').trim();
  const every = /^(?:every|each)\s+(\d+\s*)?(minute|min|hour|hr)s?$/.exec(s) ?? (s === 'hourly' ? [s, '1', 'hour'] : null);
  if (every) {
    const n = Number(every[1] ?? 1) * (every[2].startsWith('h') ? 60 : 1);
    if (!(n >= 1 && n <= 7 * 24 * 60)) throw bad(text);
    return { every: n };
  }
  const days = new Set<number>();
  let at: number | undefined, tod: number | undefined; // at: a clock time the words named; tod: morning/evening/night, a default hour never a day
  for (const w of s.split(/\s+/)) {
    if (['every', 'each', 'at', 'on', 'and', 'in', 'the', 'of', 'month', 'months', 'monthly'].includes(w)) continue;
    const t = /^(\d{1,2})(?::(\d\d))?(am|pm)?$/.exec(w);
    if (t && at === undefined) {
      let h = Number(t[1]), m = Number(t[2] ?? 0);
      if (t[3] && (h < 1 || h > 12)) throw bad(text);
      if (t[3]) h = (h % 12) + (t[3] === 'pm' ? 12 : 0);
      if (h > 23 || m > 59) throw bad(text);
      at = h * 60 + m;
    } else if (w === 'noon') at = 12 * 60;
    else if (w === 'midnight') at = 0;
    else if (/^(day|days|daily|everyday)$/.test(w)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
    else if (w === 'morning' || w === 'evening' || w === 'night') tod ??= (w === 'morning' ? 9 : w === 'evening' ? 18 : 21) * 60;
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
  if (dom) return { dom, at: at ?? tod ?? 9 * 60, guessed: at === undefined && tod === undefined };
  if (!days.size) { if (tod === undefined) throw bad(text); [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d)); } // "every evening"
  // "every Monday" means the start of the working day; `guessed` says the words never named a time, so a card asks about it.
  return { days: [...days].sort(), at: at ?? tod ?? 9 * 60, guessed: at === undefined && tod === undefined };
}

export const hhmm = (at: number) => new Date(2000, 0, 1, Math.floor(at / 60), at % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();

/** The schedule back in plain words: "Every Monday at 9:00 am". */
export function describe(s: Schedule) {
  if ('every' in s) return s.every % 60 ? `Every ${s.every === 1 ? 'minute' : `${s.every} minutes`}` : `Every ${s.every === 60 ? 'hour' : `${s.every / 60} hours`}`;
  if ('dom' in s) return `On the ${ord(s.dom)} of every month at ${hhmm(s.at)}`;
  const d = s.days.join(), days = d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends'
    : `Every ${s.days.map((x) => NAMES[x]).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `${days} at ${hhmm(s.at)}`;
}
/** What a watch or quiet check-in waits for, from a task phrased the way crew_routine asks ("tell me if the price drops
 *  below $900"): "Tells you if the price drops below $900". '' when the task names no condition. */
export const looksFor = (task = '') => (/^(?:please\s+)?(?:tell|let|alert|notify|warn)\s+(?:me|the person)(?:\s+know)?\s+((?:if|when|once|as soon as)\s.+?)[.!]?$/i.exec(String(task).trim().split(/\n|(?<=[.!?])\s/)[0])?.[1] ?? '').replace(/^./, (c) => `Tells you ${c}`);

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
  // A date each month: a month with no such date (the 31st in February) is skipped, not pulled back to its last day.
  for (let i = 0; i <= ('dom' in s ? 62 : 7); i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, Math.floor(s.at / 60), s.at % 60);
    if (c.getTime() > after && ('dom' in s ? c.getDate() === s.dom : s.days.includes(c.getDay()))) return c.getTime();
  }
  throw new Error('unreachable: a schedule always has a day');
}

/** The moment a one-off reminder is due, in the person's own words: "in 20 minutes" counts from now, and "today",
 *  "tomorrow" and a weekday name ("friday 9:00") are the same clock the routines keep. */
export function reminderAt(text: string, now = Date.now()) {
  const day = (n: number) => DAYS[(new Date(now).getDay() + n) % 7], s = String(text).toLowerCase().trim().replace(/\btomorrow\b/, () => day(1)).replace(/\btoday\b/, () => day(0)), rel = /^in\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?)$/.exec(s);
  if (rel) return now + Number(rel[1]) * (rel[2][0] === 'h' ? 60 : 1) * 60_000;
  try { return nextRun(parseSchedule(s.replace(/^(at|on)\s+/, '')), now); } catch { throw whenBad(text); }
}

/** What starts a routine instead of (or as well as) a time: a file arriving in the helper's inbox, the computer
 *  waking, a new email (literal sender and subject words) or a timed meeting N minutes ahead, on the person's own
 *  Gmail and Calendar connections. The inbox is fixed per helper, so the words never carry a path. */
export type Trigger = { file: true } | { wake: true } | { mail: true; from: string; subject: string } | { calendar: number };

const triggerBad = (text: string) => Object.assign(new Error(`I can't start anything on "${text}"; try "when an email from the bank arrives", "10 minutes before each meeting", "when a file arrives in the inbox" or "when this computer wakes up"`), { status: 400 });

export function parseTrigger(text: string): Trigger {
  const words = String(text).replace(/\s+/g, ' ').trim(), s = words.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim(), meeting = /^(?:when (?:a |each |every )?(?:calendar event|meeting) starts|(\d{1,4}) minutes? before (?:each|every|a) (?:meeting|calendar event))$/i.exec(words);
  if (meeting && Number(meeting[1] ?? 0) <= 1440) return { calendar: Number(meeting[1] ?? 0) };
  const mail = /^when (?:a new |an? |new )?(?:email|mail)(?: from (.+?))?(?: (?:with (?:the )?subject|about) (.+?))? arrives?$/i.exec(words);
  if (mail) return { mail: true, from: (mail[1] ?? '').replace(/^the /i, ''), subject: mail[2] ?? '' };
  if (!s.startsWith('when ')) throw triggerBad(text);
  if (/\b(wake|wakes|woke|waking)\b/.test(s) && /\b(computer|machine|laptop|mac|pc)\b/.test(s)) return { wake: true };
  if (/\b(file|files|photo|photos|picture|pictures|receipt|receipts|attachment|document)\b/.test(s) &&
    /\b(arrive|arrives|arriving|land|lands|landing|drop|dropped|added|appear|appears|show|shows)\b/.test(s)) return { file: true };
  throw triggerBad(text);
}

/** The trigger back in plain words; `who` is the helper's display name, whose inbox the file trigger watches. */
export const describeTrigger = (t: Trigger, who: string) => 'mail' in t ? `When an email${t.from ? ` from ${t.from}` : ''}${t.subject ? ` with subject ${t.subject}` : ''} arrives`
  : 'calendar' in t ? (t.calendar ? `${t.calendar} minutes before each meeting` : 'When a meeting starts') : 'file' in t ? `When a file arrives in ${who}'s inbox` : 'When this computer wakes up';
