// Drives interview prep on a live stub-engine crewd (jobs-prep.sh), after jobs-loop.mjs has put a role on the board:
// `interview` is the person's own tap, `prep` taps Prep for this interview and lets the writer put the brief and questions on
// the role, `practice` taps Practice and types one answer in the writer's chat. Prints what the next capture needs.
//   node scripts/verify/jobs-prep.mjs <interview|prep|practice> <crewd-url> <person-key> <company-page-url>
const [step, B, key, company] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`); return r.json(); };
const until = async (what, fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } throw new Error(`never saw ${what}`); };
const state = () => api('GET', '/api/state');
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const role = async () => (await state()).jobs.roles.find((x) => x.co === 'Northwind');
if (step === 'interview') {
  const r = await role();
  await api('POST', `/api/jobs/${r.id}`, { stage: 'interview' });
  console.log(r.id);
} else if (step === 'prep') {
  const r = await role(), { goal } = (await state()).jobs;
  await api('POST', `/api/jobs/${r.id}/prep`);
  const brief = [['Northwind serves two million customers across the UK.', 'serves two million customers'], ['Its engineers ship the checkout app every two weeks.', 'ship the checkout app every two weeks'], ['They work in squads of five, each with its own on-call.', 'squads of five']].map(([says, quote], i) => ({ says, quote, url: `${company}/company/${i}` }));
  const questions = [['Tell us about a time you made a slow page fast.', 'The role owns checkout speed, so they want a measured result.'], ['How do you decide what to test in a payments flow?', 'Money moves here, so they probe how you weigh risk.'], ['Describe a disagreement at work and how it ended.', 'They check you can settle things plainly.'], ['What is your expected salary?', 'Asked early; the answer is yours alone.']].map(([ask, why]) => ({ ask, why }));
  await api('POST', `/api/bots/${goal.will}/messages`, { text: `Prepared ${tool('crew_prep', { role: r.id, brief, questions })}` });
  await until('the prep on the role', async () => (await role()).prep);
  console.log(JSON.stringify({ role: r.id, will: goal.will }));
} else if (step === 'practice') {
  const r = await role(), { goal } = (await state()).jobs;
  await api('POST', `/api/jobs/${r.id}/practice`);
  const said = async (re) => until(`a reply matching ${re}`, async () => (await api('GET', `/api/bots/${goal.will}`)).messages?.some((m) => m.author === 'bot' && re.test(m.text)));
  await said(/Question 1 of 3/);
  await api('POST', `/api/bots/${goal.will}/messages`, { text: 'I cut checkout load time by 40 percent by splitting the bundle and lazy loading the payment form.' });
  await said(/What landed/);
  console.log(goal.will);
}
