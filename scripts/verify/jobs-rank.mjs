// Drives the ranking on a live stub-engine crewd (jobs-rank.sh) with a REAL search: the scripted finder reads live AI/ML engineering
// postings from public Greenhouse boards, lifts each signal (remote, gateway company, fast process, sponsorship) as words copied from the
// posting's own page, and hands them to crew_role. crewd opens every page itself, checks every quote, ranks, and words the reason.
// Then this script re-reads every cited page and checks the board's order against the strategy on its own.
//   node scripts/verify/jobs-rank.mjs <goal|search> <crewd-url> <person-key>
import { readFileSync } from 'node:fs';
import { readPage } from '../../src/engine.ts';
const [step, B, key] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`); return r.json(); };
const until = async (what, fn, n = 120) => { for (let i = 0; i < n; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const CV = readFileSync(new URL('./jobs-cv.txt', import.meta.url), 'utf8').trim(), lines = CV.split('\n');
const state = () => api('GET', '/api/state');
if (step === 'goal') {
  await api('POST', '/api/onboard', { address: 'Umer' });
  await api('POST', '/api/bots/chief/messages', { text: `Find me roles ${tool('crew_goal', { title: 'AI engineer', places: 'Remote first', focus: 'remote first, gateway companies, fast hiring', cv: CV })}` });
  console.log((await until('the goal card', async () => (await state()).asks.find((a) => a.kind === 'propose'))).id);
} else if (step === 'search') {
  await api('POST', `/api/asks/${(await state()).asks.find((a) => a.kind === 'propose').id}/answer`, { answer: 'allow', scope: 'once' });
  const { goal } = await until('the board', async () => (await state()).goals[0]);
  // The search: the public boards, the AI and machine-learning engineering postings on them.
  const boards = ['anthropic', 'airbnb', 'gitlab', 'figma', 'scaleai', 'vercel', 'databricks', 'stripe', 'cloudflare', 'datadog', 'coinbase', 'reddit', 'pinterest', 'lyft', 'asana', 'twilio', 'instacart', 'robinhood'];
  const found = [];
  for (const b of boards) {
    const j = await fetch(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`).then((r) => (r.ok ? r.json() : { jobs: [] }), () => ({ jobs: [] }));
    for (const x of (j.jobs ?? []).filter((x) => /(machine learning|ml|ai|applied ai|llm|ai\/ml) engineer|software engineer.*(ai|ml|llm)/i.test(x.title)).slice(0, 2)) found.push({ company: b[0].toUpperCase() + b.slice(1), title: x.title, place: x.location?.name ?? '', url: x.absolute_url });
  }
  const win = (text, re) => { const m = re.exec(text); return m ? m[0].replace(/\s+/g, ' ').trim().slice(0, 190) : null; };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const read = [];
  for (const r of found) { const p = await readPage(r.url).catch(() => null); if (p?.status === 200) read.push({ ...r, text: p.text }); if (read.length === 16) break; }
  const signals = (r) => [['remote', /remote/i.test(r.place) && win(r.text, new RegExp(`(?:\\S+\\s+){0,${r.place.length < 12 ? 2 : 0}}${esc(r.place)}`, 'i'))],
    ['gateway', win(r.text, /(?:headquartered in|offices? in|hubs? in)\s+[^.;]*(?:San Francisco|New York|Seattle|Austin|Boston|Washington|California|United States)[^.;]*/i)],
    ['fast', win(r.text, /(?:hear back|decision|offer)[^.]{0,40}\b(?:within|in)\s+(?:\d+|a few|one|two|three)\s+(?:days?|weeks?)[^.]*/i)],
    ['sponsor', win(r.text, /we (?:do |can |will )?sponsor[^.!]*[.!]?/i)]].filter(([, q]) => q).map(([kind, quote]) => ({ kind, quote }));
  const sent = [];
  for (const r of read) {
    const { text: _, ...role } = r, sig = signals(r), n = (await state()).goals[0].roles.length;
    await api('POST', `/api/bots/${goal.rae}/messages`, { text: `Found one ${tool('crew_role', { ...role, pay: '', missing: 'No AI or machine learning work on your CV yet', fit: [{ says: 'You have shipped production web products in React and TypeScript', cv: lines[1] }], signals: sig })}` });
    const on = await until(`${r.title} on the board`, async () => (await state()).goals[0].roles.length > n);
    sent.push({ title: r.title, company: r.company, claimed: sig.map((s) => s.kind), added: !!on });
  }
  const roles = (await state()).goals[0].roles, weight = { remote: 8, gateway: 4, fast: 2, sponsor: 1 }, score = (x) => x.signals.reduce((s, y) => s + weight[y.kind], 0);
  // The check, on its own: scores never rise down the board, equals run newest first, and every quote is on the page it cites today.
  const ordered = roles.every((x, i) => i === 0 || score(roles[i - 1]) > score(x) || (score(roles[i - 1]) === score(x) && roles[i - 1].id > x.id));
  const quotes = [];
  for (const x of roles) for (const s of x.signals) quotes.push({ role: x.title, kind: s.kind, onPage: (await readPage(s.url).catch(() => ({ text: '' }))).text.replace(/\W+/g, ' ').toLowerCase().includes(s.quote.replace(/\W+/g, ' ').toLowerCase().trim()) });
  const rank = roles.map((x, i) => ({ n: i + 1, co: x.co, title: x.title, score: score(x), kinds: x.signals.map((y) => y.kind), quotes: x.signals.map((y) => y.quote), place: x.place }));
  console.log(JSON.stringify({ searched: boards.length, postings: found.length, read: read.length, sent, rank, ordered, everyQuoteOnItsPage: quotes.every((q) => q.onPage), quotes }, null, 1));
  if (!ordered || !quotes.every((q) => q.onPage) || roles.length < 6 || !roles.some((x) => score(x) >= 8) || !roles.some((x) => score(x) === 0)) process.exit(1);
}
