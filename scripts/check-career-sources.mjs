// Opens every source of the career plan (web/src/career.ts) and fails on any claim whose words are not on its page, or
// whose page does not carry the date the plan shows. Live network, so it is a release check, not part of `node --test`.
//   node scripts/check-career-sources.mjs [--json <file>]
import { writeFileSync } from 'node:fs';
import { PLAN, SOURCES } from '../web/src/career.ts';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const flat = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;|&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const text = (html) => flat(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pages = new Map();
async function page(key) {
  if (!pages.has(key)) pages.set(key, (async () => {
    const r = await fetch(SOURCES[key].url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const body = await r.text();
    return { raw: flat(body), text: /csv/.test(r.headers.get('content-type') ?? '') || SOURCES[key].url.endsWith('.csv') ? flat(body) : text(body) };
  })().catch((e) => ({ err: String(e.message ?? e) })));
  return pages.get(key);
}

// The date a source shows: USCIS's "Last Reviewed/Updated", the policy manual's "Current as of", or (a file) its listing page's.
async function dateOk(key) {
  const s = SOURCES[key], [y, m, d] = s.on.split('-').map(Number), p = await page(key);
  if (p.err) return p.err;
  if (s.how === 'checked') return '';
  const want = s.how === 'current' ? `Current as of ${MONTHS[m - 1]} ${d}, ${y}` : `Last Reviewed/Updated: ${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  if (key === 'hub23') return (await dateOk('hubfiles')) || '';
  return p.text.includes(want) ? '' : `page does not show “${want}”`;
}

const bad = [], rows = [];
for (const key of Object.keys(SOURCES)) { const e = await dateOk(key); rows.push({ source: key, url: SOURCES[key].url, date: SOURCES[key].on, how: SOURCES[key].how, ok: !e, error: e }); if (e) bad.push(`${key}: ${e}`); }
for (const st of PLAN) for (const it of st.items) for (const c of it.claims) {
  const p = await page(c.src), ok = !p.err && p[c.quote.startsWith('"') ? 'raw' : 'text'].includes(flat(c.quote));
  rows.push({ claim: c.says, source: c.src, quote: c.quote, ok });
  if (!ok) bad.push(`${c.src}: ${p.err ?? 'words not on the page'}: ${c.quote.slice(0, 90)}`);
}
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ rows, failed: bad }, null, 1));
console.log(`${rows.filter((r) => r.claim).length} claims, ${Object.keys(SOURCES).length} sources, ${bad.length} failed`);
for (const b of bad) console.log(`FAIL ${b}`);
process.exit(bad.length ? 1 : 0);
