// Drives the resume on a live stub-engine crewd (resume.sh): Umer pastes his CV to Chief, a resume with a line he never
// wrote is refused, then Chief's resume from his own lines is delivered. Prints the refusal check as JSON.
//   node scripts/verify/resume.mjs <crewd-url> <person-key>
const [B, key] = process.argv.slice(2);
const H = { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` };
const api = async (m, p, body) => { const r = await fetch(B + p, { method: m, headers: H, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const until = async (what, fn) => { for (let i = 0; i < 200; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } throw new Error(`never saw ${what}`); };
const tool = (n, i) => `[tool ${n} ${JSON.stringify(i)}]`;
const idle = () => until('Chief to finish', async () => !(await api('GET', '/api/state')).body.tasks.some((t) => t.bot === 'chief' && ['queued', 'working'].includes(t.state)));
const CV = `Umer Anjum
London · umer@example.com · github.com/umer
Frontend engineer at Northwind, 2019 to 2023
Led a team of four building a payments dashboard in React and TypeScript
Cut page load time by 40 percent on the checkout flow
Wrote the Node.js API behind a mobile banking app
BSc Computer Science, University of Leeds, 2016
Skills: React, TypeScript, Node.js, accessibility
Private: current salary £70,000`;
const sections = [
  { lines: ['Umer Anjum', 'London · umer@example.com · github.com/umer'] },
  { heading: 'Experience', lines: ['Frontend engineer at Northwind, 2019 to 2023', 'Led a team of four building a payments dashboard in React and TypeScript', 'Cut page load time by 40 percent on the checkout flow', 'Wrote the Node.js API behind a mobile banking app'] },
  { heading: 'Education', lines: ['BSc Computer Science, University of Leeds, 2016'] },
  { heading: 'Skills', lines: ['React, TypeScript, Node.js, accessibility'] },
];
await api('POST', '/api/onboard', { address: 'Umer' });
await api('POST', '/api/bots/chief/messages', { text: `Can you make me a resume? Here is my CV:\n${CV}` });
await idle();
await api('POST', '/api/bots/chief/messages', { text: `Add that I am AWS certified. ${tool('crew_resume', { sections: [...sections, { heading: 'Certifications', lines: ['AWS Certified Solutions Architect'] }] })}` });
await idle();
const refused = (await api('GET', '/api/document?bot=chief&path=files/resume.docx')).status;
await api('POST', '/api/bots/chief/messages', { text: `Make my resume from that. ${tool('crew_resume', { sections })}` });
await until('the resume', async () => (await api('GET', '/api/document?bot=chief&path=files/resume.docx')).status === 200);
console.log(JSON.stringify({ inventedLine: 'AWS Certified Solutions Architect', resumeAfterInventedLine: refused, resumeAfterOwnLines: 200 }));
