// The lab's crew for action-card.sh: Umer onboarded, Gmail sending connected on emulate's sign-in page, and three drafts by
// their normal crew_write and crew_draft dispatch (Scribe's two messages, Tracer's one email).
//   node action-card-seed.mjs <crewd url> <person key> <emulate url>
import { CLIENT, ME } from '../../test/emulate-google.ts';
const [B, key, EMU] = process.argv.slice(2);
const api = async (method, path, body) => { const r = await fetch(B + path, { method, headers: { authorization: `Bearer ${key}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r.json(); };
const tool = (name, args) => `[tool ${name} ${JSON.stringify(args)}]`;
await api('POST', '/api/onboard', { address: 'Umer' });
await api('PUT', '/api/house/google', CLIENT);
const { url } = await api('POST', '/api/connections/gmailsend');
const form = (await (await fetch(url.replace('https://accounts.google.com', EMU))).text()).split('<form').find((f) => f.includes(`value="${ME}"`));
const fields = new URLSearchParams([...form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)].map((m) => [m[1], m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')]));
const chosen = await fetch(`${EMU}/o/oauth2/v2/auth/callback`, { method: 'POST', body: fields, redirect: 'manual' });
if (!/is connected\./.test(await (await fetch(chosen.headers.get('location'))).text())) throw new Error('Gmail sending did not connect');
await api('POST', '/api/recruit', { template: 'scribe', name: 'Scribe' });
await api('POST', '/api/recruit', { template: 'tracer', name: 'Tracer' });
const draft = async (bot, path, content, args) => {
  const seen = (await api('GET', '/api/state')).asks.length;
  await api('POST', `/api/bots/${bot}/messages`, { text: tool('crew_write', { path, content }) + tool('crew_draft', { path, ...args }) });
  for (let i = 0; i < 300; i++) { if ((await api('GET', '/api/state')).asks.length > seen) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`no card for ${path}`);
};
await draft('scribe', 'files/sara.md', 'Sara, Friday suits me. Thanks for moving it.\n\nUmer', { channel: 'message', to: 'Sara' });
await draft('scribe', 'files/landlord.md', 'Hello, please look at the boiler this week.\n\nUmer', { channel: 'email', to: 'the landlord', subject: 'The boiler' });
await draft('tracer', 'files/ada.md', 'Hi Ada, I saw the town hall roof. Could we talk about the oak?\n\nUmer', { channel: 'email', to: 'ada@fernwood.example', subject: 'The town hall roof' });
