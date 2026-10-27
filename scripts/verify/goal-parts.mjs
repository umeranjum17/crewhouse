// Drives the reusable long-goal parts on a live stub-engine crewd (goal-parts.sh): a job search and a flat search side by side. The
// stub has no web, so the finder's day is scripted as its own crew_role calls; everything else (the cards, the shared finder, the
// quiet routine, the stage rules, the reminders) is crewd's own.
//   node scripts/verify/goal-parts.mjs <jobs|flat|search|move|remind|fired|dismiss> <crewd-url> <person-key> <page-url>
import { readFileSync } from 'node:fs';
const [step, B, key, page] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`); return r.json(); };
const until = async (what, fn, tries = 200) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); } throw new Error(`never saw ${what}`); };
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const state = () => api('GET', '/api/state');
const CV = readFileSync(new URL('./jobs-cv.txt', import.meta.url), 'utf8').trim();
const BRIEF = ['A two-bedroom flat to rent in Hackney or Walthamstow', 'Up to £2,200 a month', 'Close to a Victoria line or Overground station', 'A garden or a balcony would be nice'];
const STAGES = ['Found', 'Shortlisted', 'Viewing booked', 'Offer made', 'Signed'];
const flat = (s) => s.goals.find((g) => g.goal.title === 'A flat to rent');
const FOUND = [
  { n: 1, company: 'Foxtons', title: 'Two-bed, Mare Street', place: 'Hackney E8', pay: '£2,100 a month', says: 'Two bedrooms, as you asked', cv: BRIEF[0], missing: 'No garden or balcony is shown' },
  { n: 2, company: 'Hunters', title: 'Garden flat, Wood Street', place: 'Walthamstow E17', pay: '£1,950 a month', says: 'A garden, and under £2,200 a month', cv: BRIEF[1], missing: 'Ground floor, so a little noisy' },
];
const input = (f, goal) => ({ goal, company: f.company, title: f.title, place: f.place, url: `${page}/flat/${f.n}`, pay: f.pay, missing: f.missing, fit: [{ says: f.says, cv: f.cv }] });
if (step === 'jobs') {
  await api('POST', '/api/onboard', { address: 'Umer' });
  await api('POST', '/api/bots/chief/messages', { text: `Find me roles ${tool('crew_goal', { title: 'Frontend engineer', places: 'London or remote', floor: '£50,000', cv: CV })}` });
  const ask = await until('the job card', async () => (await state()).asks.find((a) => a.kind === 'propose'));
  await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow', scope: 'once' });
  const j = (await until('the job goal', async () => (await state()).goals[0])).goal;
  const lines = CV.split('\n');
  await api('POST', `/api/bots/${j.rae}/messages`, { text: `Found one ${tool('crew_role', { company: 'Northwind', title: 'Frontend Engineer', place: 'London', url: `${page}/job/1`, pay: '£55,000 to £65,000 a year', missing: 'GraphQL is not on your CV', fit: [{ says: 'You led a payments dashboard in React', cv: lines[1] }] })}` });
  await until('the role', async () => (await state()).goals[0].roles.length);
  console.log(j.id);
} else if (step === 'flat') {
  await api('POST', '/api/bots/chief/messages', { text: `Look for a flat for me ${tool('crew_goal', { title: 'A flat to rent', places: 'Hackney or Walthamstow, up to £2,200 a month', brief: BRIEF.join('\n'), stages: STAGES })}` });
  const ask = await until('the flat card', async () => (await state()).asks.find((a) => a.kind === 'propose' && /flat/i.test(a.title)));
  console.log(ask.id);
} else if (step === 'search') {
  const ask = (await state()).asks.find((a) => a.kind === 'propose' && /flat/i.test(a.title));
  await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow', scope: 'once' });
  const g = (await until('the flat goal', async () => flat(await state()))).goal;
  const routine = (await state()).routines.find((r) => /flat/i.test(r.name));
  const chief = async () => ((await api('GET', '/api/bots/chief')).messages ?? []).filter((m) => /stub scout/.test(m.text)).length; // helper words relayed into Chief's thread
  // The daily search: the real routine runs ("Do it now"), and the finder's day is scripted on top; running it again adds nothing.
  const day = async () => { for (const f of FOUND) await api('POST', `/api/bots/${g.rae}/messages`, { text: `Search ${tool('crew_role', input(f, g.id))}` }); await api('POST', `/api/routines/${routine.id}/run`).catch(() => {}); };
  await day();
  const once = await until('two options', async () => { const r = flat(await state()).roles; return r.length >= 2 && r; });
  const before = await chief();
  await day();
  await new Promise((r) => setTimeout(r, 3000));
  const s = await state(), twice = flat(s).roles;
  if (twice.length !== once.length) throw new Error(`the second search added ${twice.length - once.length}`);
  if (s.asks.some((a) => a.state === 'open' && a.bot === g.rae)) throw new Error('the search asked the person something');
  console.log(JSON.stringify({ goal: g.id, found: once.map((r) => r.stage), stages: g.stages.map((x) => x.name), chiefLines: (await chief()) - before }));
} else if (step === 'move') {
  const s = await state(), r = flat(s).roles.find((x) => /Mare/.test(x.title));
  await api('POST', `/api/jobs/${r.id}`, { stage: 'shortlisted' });
  const err = await api('POST', `/api/jobs/${r.id}`, { stage: 'sideways' }).then(() => '', (e) => e.message);
  if (!/shortlisted/.test(err)) throw new Error(`a made-up stage was not refused: ${err}`);
  console.log(r.id);
} else if (step === 'remind') {
  const s = await state(), g = flat(s), r = g.roles.find((x) => /Wood/.test(x.title));
  const item = await api('POST', `/api/jobs/${r.id}/remind`, { when: 'in 1 minute', text: 'Ring Hunters about Wood Street' });
  const alone = await api('POST', `/api/goals/${g.goal.id}/remind`, { when: 'Friday 1pm', text: 'Read the brief' });
  console.log(JSON.stringify({ item: item.id, alone: alone.id, role: r.id }));
} else if (step === 'fired') {
  const id = Number(page);
  await until('the reminder to go off', async () => { const r = (await state()).routines.find((x) => x.id === id); return r && !r.next_at && r.last_at; }, 240);
  console.log('fired');
} else if (step === 'dismiss') {
  await api('DELETE', `/api/routines/${Number(page)}`);
  console.log('dismissed');
}
