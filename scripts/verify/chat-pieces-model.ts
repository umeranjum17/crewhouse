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
  'Remind me about the invoice.': { kind: 'buttons', title: 'When should the reminder go out?', text: 'Alder & Finch owe £1,240. The note goes out under your name.', choices: [{ id: 'tom', label: 'Tomorrow at 9 am' }, { id: 'fri', label: 'Friday at 9 am' }, { id: 'mon', label: 'Next Monday at 9 am' }, { id: 'none', label: 'Do not send one' }] },
  'Book the engineer.': { kind: 'date', title: 'Which day should the engineer come?', text: 'The visit takes about an hour. Pick a time too, so I can hold the slot.', yes: 'Send', times: ['9:00', '10:30', '13:00', '15:30'] },
  'What does the refund policy say?': { kind: 'sheet', title: 'Read the refund policy first?', text: 'It takes about 2 minutes. I will draft the reply once you have read it.', yes: 'Got it', body: '## Returns within 30 days\n\nYou can return most items within 30 days of delivery for a full refund to your original payment method. Items must be unused, in their original packaging, and sent with the order number. We pay return postage on faulty items.\n\n## Returns after 30 days\n\nAfter day 30 we can no longer refund, but we can offer store credit for unused items for up to 60 days.\n\n## Gifts\n\nA gift can be returned by the person who received it, with the gift receipt, for store credit.' },
  'Find me flights.': { kind: 'list', title: 'Heathrow to New York, Fri 14 Nov', text: 'There are 12 direct flights on Friday. These five leave first.', rows: [{ title: 'BA117', sub: 'Gate B32, departs 08:15, arrives 11:05', link: 'https://www.ba.com/' }, { title: 'VS3', sub: 'Gate A7, departs 09:40, arrives 12:35', link: 'https://www.virginatlantic.com/' }, { title: 'AA101', sub: 'Gate B44, departs 10:20, arrives 13:10', link: 'https://www.aa.com/' }, { title: 'DL1', sub: 'Gate C12, departs 10:55, arrives 13:50', link: 'https://www.delta.com/' }, { title: 'UA901', sub: 'Gate B36, departs 11:30, arrives 14:25' }, { title: 'EK202', sub: 'Gate C3, departs 12:05, arrives 14:55' }, { title: 'QR3', sub: 'Gate A2, departs 12:40, arrives 15:35' }] },
  'Any news on the parcel?': { kind: 'line', title: 'The parcel left the depot this morning.' },
  'Show me a slider.': { kind: 'slider', title: 'How warm should the office be?', text: 'A kind this Crewhouse does not know is said as plain words.' },
};
const said = (r: any, k: string) => r.day ? `Booked for ${r.day} at ${r.time}.` : k === 'sheet' ? 'Thanks for reading it.' : r.picked ? `${r.picked.label} it is: that was your pick (${r.picked.id}).` : r.values ? `Booked for ${r.values.city}, ${String(r.values.size).toLowerCase()} box${r.values.gift ? ', gift wrapped' : ''}.` : r.answered ? 'Tuesday stays free.' : r.shown ? '' : 'Left as it is.';
const text = (m: any) => typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((c: any) => c.text ?? '').join('');
const model = await startModelStub(undefined, (body, words) => {
  const asked = Object.keys(PIECES).find((k) => words.endsWith(k));
  if (!asked) return {};
  const m = body.messages ?? [], back = m.slice(m.findLastIndex((x: any) => x.role === 'user' && text(x).includes(asked))).find((x: any) => x.role === 'tool');
  if (!back) return { text: call(PIECES[asked]) }; // the engine adds its own context after the result, so look for the result, not the last message
  const raw = text(back), r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  appendFileSync(seen, `${JSON.stringify({ asked, result: r })}\n`);
  return { text: call(PIECES[asked]), reply: said(r, (PIECES[asked] as any).kind) || 'That is all from me.' };
});
writeFileSync(env, `MODEL=${model.url}\n`);
