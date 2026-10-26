// Drives the jobs loop on a live stub-engine crewd (jobs-loop.sh): `goal` posts Chief's goal card and prints its ask id;
// `board` says yes, lets the finder add two roles from the local posting and the writer draft one; `apply` is the person's tap.
//   node scripts/verify/jobs-loop.mjs <goal|board|apply> <crewd-url> <person-key> <posting-url>
import { readFileSync } from 'node:fs';
const [step, B, key, posting] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`); return r.json(); };
const until = async (what, fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } throw new Error(`never saw ${what}`); };
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const CV = readFileSync(new URL('./jobs-cv.txt', import.meta.url), 'utf8').trim();
const state = () => api('GET', '/api/state');
if (step === 'goal') {
  await api('POST', '/api/onboard', { address: 'Umer' });
  await api('POST', '/api/bots/chief/messages', { text: `Find me roles ${tool('crew_goal', { title: 'Frontend engineer', places: 'London or remote', floor: '£50,000', cv: CV })}` });
  const ask = await until('the goal card', async () => (await state()).asks.find((a) => a.kind === 'propose'));
  console.log(ask.id);
} else if (step === 'board') {
  const ask = (await state()).asks.find((a) => a.kind === 'propose');
  await api('POST', `/api/asks/${ask.id}/answer`, { answer: 'allow', scope: 'once' });
  const { goal } = (await until('the board', async () => (await state()).jobs)), rae = goal.rae, will = goal.will;
  const role = (n, co, title, place, pay, says, cv, missing) => ({ company: co, title, place, url: `${posting}/job/${n}`, pay, missing, fit: [{ says, cv }] });
  const lines = CV.split('\n');
  for (const r of [role(1, 'Northwind', 'Frontend Engineer', 'London', '£55,000 to £65,000 a year', 'You led a payments dashboard in React and TypeScript', lines[1], 'GraphQL is not on your CV'),
    role(2, 'Fernhill', 'UI Engineer', 'Remote (UK)', '', 'You wrote the Node.js API behind a banking app', lines[3], 'Design-system experience is not on your CV')]) {
    await api('POST', `/api/bots/${rae}/messages`, { text: `Found one ${tool('crew_role', r)}` });
    await until(`${r.company} on the board`, async () => (await state()).jobs.roles.some((x) => x.co === r.company));
  }
  const first = (await state()).jobs.roles.find((x) => x.co === 'Northwind');
  await api('POST', `/api/jobs/${first.id}/draft`);
  await api('POST', `/api/bots/${will}/messages`, { text: `Drafted ${tool('crew_application', { role: first.id, cv: [lines[1], lines[2]], answers: [{ ask: 'Why Northwind?', answer: 'I build payments dashboards, and I would like to do it for a team that ships every week.' }] })}` });
  const draft = await until('the draft card', async () => (await state()).asks.find((a) => a.detail?.draft));
  console.log(JSON.stringify({ role: first.id, ask: draft.id }));
} else if (step === 'apply') {
  const roles = (await state()).jobs.roles, r = roles.find((x) => x.stage === 'drafted') ?? roles[0];
  await api('POST', `/api/jobs/${r.id}`, { stage: 'applied' });
  console.log(r.id);
}
