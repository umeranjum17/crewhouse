// The written rubric for the jobs eval (docs/jobs-eval.md), as code: every check is a number from 0 to 1 that a script
// can reproduce, so two runs differ only by what the model did. Both arms are scored by the same functions on the same
// shape (`goal`, `shortlist`, `prep` below); a check that does not apply to an arm is `null` and left out of its mean.
// The fixed inputs are cases.json; the pages the model reads are served from it (`serve`).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { inCv, norm } from '../../src/jobs.ts';

export const RUBRIC_VERSION = 1;
export const CASES = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
export const CV = CASES.cv.join('\n');

const page = (title, lines) => `<h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}`;
/** Every page the model can read, by path, with this run's address filled in. */
export function pages(base) {
  const all = new Map([['/jobs', page('Open roles', CASES.postings.map((p) => `${p.title} at ${p.co}, ${p.place}: ${base}/job/${p.n}`))]]);
  for (const p of CASES.postings) all.set(`/job/${p.n}`, page(`${p.title} at ${p.co}`, p.body));
  const r = CASES.prep.role;
  all.set(`/job/${r.n}`, page(`${r.title} at ${r.co}`, CASES.prep.posting.map((l) => l.replaceAll('{base}', base))));
  for (const [path, lines] of Object.entries(CASES.prep.pages)) all.set(path, page(path.split('/').pop(), lines));
  return all;
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** The fixed web on loopback; `port` 0 takes a free one. */
export async function serve(port = 0) {
  let base = '', all = new Map();
  const server = createServer((q, r) => {
    const html = all.get(q.url.split('?')[0]);
    r.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }); r.end(html ?? 'No such page.');
  });
  await new Promise((ok, no) => server.once('error', no).listen(port, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`; all = pages(base);
  return { base, text: (path) => text(all.get(path) ?? ''), close: () => server.close() };
}

const check = (id, label, score, detail = '') => ({ id, label, score: score === null ? null : Math.max(0, Math.min(1, score)), detail });
const mean = (xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
const done = (checks) => ({ checks, score: mean(checks.map((c) => c.score)) });
const zeros = (labels, why) => done(labels.map(([id, label]) => check(id, label, 0, why)));

const GOAL = [['offered', 'Offers the goal in the first reply'], ['title', 'Names the right job'], ['places', 'Keeps both places'], ['floor', 'Keeps the pay floor'], ['whole', 'Keeps every line of the CV'], ['own', 'Adds no line the person did not write']];
/** out: { title, places, floor, brief } or null when no goal came back. */
export function goal(out) {
  if (!out?.title) return zeros(GOAL, 'no goal came back');
  const brief = String(out.brief ?? ''), lines = brief.split('\n').filter((l) => l.trim());
  const kept = CASES.cv.filter((l) => inCv(brief, l)), strays = lines.filter((l) => !inCv(CV, l));
  return done([check('offered', GOAL[0][1], 1), check('title', GOAL[1][1], /front.?end/i.test(out.title) ? 1 : 0, out.title),
    check('places', GOAL[2][1], (/london/i.test(out.places) + /remote/i.test(out.places)) / 2, out.places),
    check('floor', GOAL[3][1], /50[,.]?000|\b50k\b/i.test(out.floor ?? '') ? 1 : 0, out.floor ?? ''),
    check('whole', GOAL[4][1], kept.length / CASES.cv.length, `${kept.length} of ${CASES.cv.length} lines`),
    check('own', GOAL[5][1], lines.length ? 1 - strays.length / lines.length : 0, strays.slice(0, 2).join(' | '))]);
}

const SHORT = [['finds', 'Finds the roles that fit'], ['leaves', 'Leaves out the ones that do not'], ['once', 'Lists each role once'], ['real', 'Names only pages it was given'], ['pay', 'Gives the pay as the page shows it'], ['own', 'Quotes the person\'s own CV lines'], ['gap', 'Says what the CV does not show']];
const nums = (s) => (String(s).match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]/g, '')).join(' ');
/** out: { roles: [{ co, title, place, pay, fit: [{ says, cv }], gap, url }] }; `web` is the served fixtures. */
export function shortlist(out, web) {
  const roles = out?.roles ?? [];
  if (!roles.length) return zeros(SHORT, 'no role was delivered');
  const by = new Map(CASES.postings.map((p) => [p.n, p])), seen = roles.map((r) => by.get(Number(new RegExp(`^${web.base}/job/(\\d+)$`).exec(String(r.url).trim())?.[1])));
  const fits = CASES.postings.filter((p) => p.label === 'fit'), traps = CASES.postings.filter((p) => p.label === 'trap');
  const credit = (p) => (p.label === 'dup' ? p.of : p.n), found = new Set(seen.filter(Boolean).map(credit));
  const trapped = traps.filter((p) => seen.includes(p));
  const keys = roles.map((r) => `${norm(r.co)}|${norm(r.title)}`), repeats = keys.length - new Set(keys).size;
  const known = seen.filter(Boolean).length;
  const payOk = roles.map((r, i) => { const p = seen[i]; if (!p) return 0; const pay = String(r.pay ?? '').trim(); if (!p.pay) return pay ? 0 : 1; return pay && norm(web.text(`/job/${p.n}`)).includes(norm(pay)) && nums(pay) === nums(p.pay) ? 1 : 0; });
  const items = roles.flatMap((r) => (r.fit?.length ? r.fit : [{}])), own = items.filter((f) => f.cv && inCv(CV, f.cv, true)).length;
  const planted = roles.map((r, i) => [r, seen[i]]).filter(([, p]) => p?.gap), told = planted.filter(([r, p]) => new RegExp(p.gap, 'i').test(r.gap ?? '')).length;
  return done([check('finds', SHORT[0][1], found.size && [...found].filter((n) => by.get(n).label === 'fit').length / fits.length, `${[...found].filter((n) => by.get(n).label === 'fit').length} of ${fits.length}`),
    check('leaves', SHORT[1][1], 1 - trapped.length / traps.length, trapped.map((p) => p.co).join(', ')),
    check('once', SHORT[2][1], 1 - repeats / roles.length, `${repeats} repeated`),
    check('real', SHORT[3][1], known / roles.length, `${known} of ${roles.length}`),
    check('pay', SHORT[4][1], mean(payOk), `${payOk.filter(Boolean).length} of ${roles.length}`),
    check('own', SHORT[5][1], own / items.length, `${own} of ${items.length}`),
    check('gap', SHORT[6][1], planted.length ? told / planted.length : null, planted.length ? `${told} of ${planted.length}` : 'no planted gap among them')]);
}

const PREP = [['facts', 'Every company fact is on its page'], ['amount', 'Five to ten facts'], ['questions', 'Six to ten questions, each with why'], ['theirs', 'Writes no answer for the person'], ['role', 'Questions fit this role']];
/** out: { brief: [{ says, url, quote }], questions: [{ ask, why }] }. */
export function prep(out, web) {
  const brief = out?.brief ?? [], qs = out?.questions ?? [];
  if (!brief.length || !qs.length) return zeros(PREP, 'no prep was delivered');
  const onPage = brief.filter((f) => { const path = String(f.url).startsWith(web.base) ? String(f.url).slice(web.base.length) : ''; return norm(f.quote).length >= 12 && norm(web.text(path)).includes(norm(f.quote)); });
  const withWhy = qs.filter((q) => String(q.why ?? '').trim()), said = [...brief.map((f) => f.says), ...qs.flatMap((q) => [q.ask, q.why])].join('\n');
  const answered = /[£$€]\s?\d|\b(you should (say|answer)|suggested answer|sample answer|model answer)\b/i.test(said);
  const all = qs.map((q) => `${q.ask} ${q.why}`).join('\n'), hit = CASES.prep.topics.filter((t) => new RegExp(t.re, 'i').test(all));
  const range = (n, lo, hi) => (n >= lo && n <= hi ? 1 : n >= lo - 2 && n <= hi + 3 ? 0.5 : 0);
  return done([check('facts', PREP[0][1], onPage.length / brief.length, `${onPage.length} of ${brief.length}`),
    check('amount', PREP[1][1], range(brief.length, 5, 10), `${brief.length} facts`),
    check('questions', PREP[2][1], withWhy.length === qs.length ? range(qs.length, 6, 10) : 0.5 * (withWhy.length / qs.length), `${qs.length} questions, ${withWhy.length} with why`),
    check('theirs', PREP[3][1], answered ? 0 : 1, answered ? 'a figure or a written answer appears' : ''),
    check('role', PREP[4][1], hit.length / CASES.prep.topics.length, hit.map((t) => t.name).join(', '))]);
}
