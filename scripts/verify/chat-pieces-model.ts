// For chat-pieces.sh: the scripted model (test/openclaw-stub.ts) on loopback. What the person says picks the piece; the words Chief
// then says are built from the tool result the engine handed back in that same turn, so a wrong result shows in the thread.
// Writes `MODEL=<url>` to argv[2]; each result read goes to argv[3], one JSON line each.
import { appendFileSync, writeFileSync } from 'node:fs';
import { startModelStub } from '../../test/openclaw-stub.ts';

const [, , env, seen] = process.argv;
const call = (p: object) => `[tool crew_piece ${JSON.stringify(p)}]`;
const PIECES: Record<string, object> = {
  'Can the dentist wait?': { kind: 'card', title: 'Keep Tuesday free for the dentist?', text: 'They can see you at 3. Saying no leaves the day open.', yes: 'Keep it' },
  'Send my mum her parcel.': { kind: 'form', title: 'Where should the parcel go?', text: 'I need these to book the courier.', yes: 'Book it', fields: [{ id: 'city', label: 'City' }, { id: 'size', label: 'Size', options: ['Small', 'Large'] }, { id: 'gift', label: 'Wrap it as a gift', tick: true }, { id: 'note', label: 'A note for the driver', optional: true }] },
  'Book the team lunch.': { kind: 'picker', title: 'Which day suits the team?', text: 'All three places are free then.', yes: 'Book that day', choices: [{ id: 'tue', label: 'Tuesday', note: '6 can come' }, { id: 'wed', label: 'Wednesday', note: '8 can come' }, { id: 'fri', label: 'Friday', note: '5 can come' }] },
  'Any news on the parcel?': { kind: 'line', title: 'The parcel left the depot this morning.' },
  'Show me a slider.': { kind: 'slider', title: 'How warm should the office be?', text: 'A kind this Crewhouse does not know is said as plain words.' },
};
const said = (r: any) => r.picked ? `${r.picked.label} it is: that was your pick (${r.picked.id}).` : r.values ? `Booked for ${r.values.city}, ${String(r.values.size).toLowerCase()} box${r.values.gift ? ', gift wrapped' : ''}.` : r.answered ? 'Tuesday stays free.' : r.shown ? '' : 'Left as it is.';
const text = (m: any) => typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((c: any) => c.text ?? '').join('');
const model = await startModelStub(undefined, (body, words) => {
  const asked = Object.keys(PIECES).find((k) => words.endsWith(k));
  if (!asked) return {};
  const m = body.messages ?? [], back = m.slice(m.findLastIndex((x: any) => x.role === 'user' && text(x).includes(asked))).find((x: any) => x.role === 'tool');
  if (!back) return { text: call(PIECES[asked]) }; // the engine adds its own context after the result, so look for the result, not the last message
  const raw = text(back), r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  appendFileSync(seen, `${JSON.stringify({ asked, result: r })}\n`);
  return { text: call(PIECES[asked]), reply: said(r) || 'That is all from me.' };
});
writeFileSync(env, `MODEL=${model.url}\n`);
