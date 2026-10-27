// The scripted model for the first-hour journey (first-hour.sh): an OpenAI-compatible loopback provider, so the real
// pinned OpenClaw engine runs Chief and the finder with fixed words and no AI account. Only the words are scripted:
// crewd's reading of the CV, the goal card, the gate, each posting's page and the chat are real. The finder's roles are
// real public postings read from Ashby's public job boards when the lab starts (remote engineering roles).
//   node scripts/verify/first-hour-model.ts <url-file>     prints nothing; writes the provider's address to <url-file>
import { writeFileSync } from 'node:fs';
import { startModelStub } from '../../test/openclaw-stub.ts';

const [urlFile] = process.argv.slice(2);
if (!urlFile) throw Error('usage: first-hour-model.ts <url-file>');
const boards: Record<string, string> = { openai: 'OpenAI', cohere: 'Cohere', elevenlabs: 'ElevenLabs', perplexity: 'Perplexity', notion: 'Notion' };
const roles: { company: string; title: string; place: string; url: string }[] = [];
for (const [b, company] of Object.entries(boards)) {
  const j = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${b}`).then((r) => r.ok ? r.json() : { jobs: [] }, () => ({ jobs: [] }));
  const x = (j.jobs ?? []).find((x: any) => /software engineer|full.?stack|forward deployed|ai engineer|product engineer/i.test(x.title) && /remote/i.test(x.location) && x.jobUrl);
  if (x) roles.push({ company, title: x.title, place: x.location, url: x.jobUrl });
  if (roles.length === 3) break;
}
if (!roles.length) throw Error('no remote engineering posting on the public boards right now');
// Each reason quotes a line of the journey's CV (scripts/verify/jobs-cv.txt); crewd checks every quote against the CV it read.
const fit = [{ says: 'You have shipped production web products in React and TypeScript', cv: 'Led a team of four building a payments dashboard in React and TypeScript' },
  { says: 'You built a production API in Node.js', cv: 'Wrote the Node.js API behind a mobile banking app' }];
const call = (name: string, input: object) => `[tool ${name} ${JSON.stringify(input)}]`;
const stub = await startModelStub(undefined, (body, text) => {
  const system = body.messages.filter((m: any) => m.role === 'system').map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  if (system.includes('Your id in Crewhouse is chief.')) {
    const cv = /, as text\]\n([\s\S]*?)\nHanding this job to a helper\?/.exec(text)?.[1];
    if (cv) return { text: call('crew_goal', { title: 'Software engineering roles in AI', places: 'Remote first', focus: 'companies that hire fast, as a way into AI', cv }),
      reply: 'I read your CV. Here is the search I would run from it: tap Start and Research Rae begins looking right away.' };
    if (/The person says: (hi|hello|hey)\b/i.test(text)) return { reply: 'Hi Umer. What can the crew do for you today?' };
    if (/The person says: any news\b/i.test(text)) return { reply: `Rae found ${roles.length} roles for you, Umer. They are in my chat.` };
    return { reply: 'On it.' };
  }
  if (/Look for new options for the person's goal/.test(text)) return { reply: `Added ${roles.length} roles.`, text: [call('crew_report', { text: 'Searching remote AI engineering roles' }),
    ...roles.map((r) => call('crew_role', { ...r, pay: '', fit, missing: 'No AI or machine learning work on your CV yet' }))].join(' ') };
  return { reply: 'Done.' };
});
writeFileSync(urlFile, stub.url);
await new Promise<void>((resolve) => { process.once('SIGTERM', () => resolve()); process.once('SIGINT', () => resolve()); });
await stub.close();
