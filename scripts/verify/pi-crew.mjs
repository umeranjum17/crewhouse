#!/usr/bin/env node
// The crew half of the `pi-engine` journey (pi-engine.sh): two helpers on one flag-on crewd, driven through the API the app uses. Scout
// has no list in its folder, so the default; Scribe's lists hello and notes. Both are asked at once to save a code in their notes. With
// `recall`, on a crewd restarted over the same folders, their Pi sessions are removed, so only notes.md can carry a code: Scout is asked
// for its own code and Scribe's; Scribe, its notes filled, is asked for its own and to save one more. Nine model calls if each helper
// takes one call per step; pi-tap.mjs stops the journey at PI_CALL_LIMIT. Each reply is checked against that helper's own Pi session
// record and the tools each request offered against the tap's record. Chief is never asked. An empty list, a tool used from a bot's own
// list, the crash and session pickup are test/pi-engine.test.ts's: real Pi, scripted model.
//   node scripts/verify/pi-crew.mjs <base-url> <lab> <crewd-pid> <out-dir> [recall]
// Appends to <out-dir>/crew.txt and prints the replies as JSON. Exits non-zero the moment a helper's words or processes are wrong.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, lab, crewd, out, recall] = process.argv.slice(2);
const key = readFileSync(join(lab, 'state', 'person.key'), 'utf8').trim(), record = join(out, 'crew.txt');
const word = { scout: 'mango', scribe: 'papaya' }, colour = { scout: 'teal', scribe: 'amber' }, code = { scout: 'K7-heron', scribe: 'M4-otter' }, other = { scout: 'scribe', scribe: 'scout' }, own = { scout: 'todo', scribe: 'hello' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), say = (line) => appendFileSync(record, `${line}\n`);
const fail = (why) => { say(`FAILED: ${why}`); console.error(`pi-crew: ${why}`); process.exit(1); };
const until = async (what, fn, ms = 180_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { const v = await fn(); if (v) return v; } fail(`timed out: ${what}`); };
const api = async (path, body) => {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) fail(`${path} said ${res.status}`);
  return res.json();
};
/** crewd's Pis by bot: Pi renames itself, so the folder it works in says whose it is, and it sits behind bubblewrap, so it is a descendant of crewd and not a child. */
const pis = () => {
  const all = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)), parent = new Map(all.map(([pid, ppid]) => [pid, ppid]));
  const under = (pid) => { for (let at = parent.get(pid); at; at = parent.get(at)) if (at === String(crewd)) return true; return false; };
  return Object.fromEntries(all.filter(([pid, , comm]) => comm === 'pi-rpc' && under(pid)).flatMap(([pid]) => {
    try { return [[readlinkSync(`/proc/${pid}/cwd`).split('/').at(-2), Number(pid)]]; } catch { return []; }
  }));
};
const ask = async (bot, text) => { say(`You asked ${bot}: ${text}`); return (await api(`/api/bots/${bot}/messages`, { text })).task; };
const ended = (bot, task) => until(`${bot}'s job ${task}`, async () => {
  const page = await api(`/api/bots/${bot}`), t = page.tasks.find((x) => x.id === task);
  const said = (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text;
  return t?.state === 'failed' || t?.state === 'unsure' ? { state: t.state, why: t.result } : t?.state === 'done' && said ? { state: 'done', said } : undefined;
});
const work = (bot) => join(lab, 'state', 'pi', bot, 'work'), notes = (bot) => readFileSync(join(work(bot), 'notes.md'), 'utf8');
const session = (bot) => { const dir = join(work(bot), 'sessions'), files = readdirSync(dir); if (files.length !== 1) fail(`${bot} has ${files.length} Pi sessions`); return readFileSync(join(dir, files[0]), 'utf8'); };
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const records = (bot) => session(bot).trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.message).map((r) => r.message);
const turns = (bot) => records(bot).filter((m) => m.role === 'assistant').map((m) => m.content.filter((c) => c.type === 'text').map((c) => c.text).join(''));
const used = (bot) => records(bot).filter((m) => m.role === 'assistant').flatMap((m) => m.content.filter((c) => c.type === 'toolCall').map((c) => c.name));
const results = (bot) => records(bot).filter((m) => m.role === 'toolResult');
const answered = (bot, end) => {
  if (end.state !== 'done') fail(`${bot}'s job ended ${end.state}: ${end.why} ${calls().length} model calls, ${calls().filter((o) => o.status === 'stopped by the tap').length} of them stopped by the tap; each is in offered.jsonl`);
  say(`${bot} replied: ${end.said}`);
  if (!flat(turns(bot).join('\n')).includes(flat(end.said).slice(0, 30))) fail(`${bot}'s chat has words its Pi session does not`);
  return end.said;
};
const bothKnow = (bot, said) => {
  const words = said.toLowerCase();
  if (!words.includes(word[bot]) || !words.includes(colour[bot])) fail(`${bot} lost its own word or note: ${said}`);
  if (words.includes(word[other[bot]]) || words.includes(colour[other[bot]])) fail(`${bot} knows what is ${other[bot]}'s: ${said}`);
};
const idle = async () => { await until('every Pi to stop once idle', () => !Object.keys(pis()).length); say('\nIdle: no Pi is running now.'); };
const calls = () => readFileSync(join(out, 'offered.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const offers = () => {
  const offered = calls();
  for (const [bot, want] of [['scout', 'notes,todo'], ['scribe', 'hello,notes']]) {
    const seen = offered.filter((o) => o.bot === bot), names = [...new Set(seen.map((o) => o.tools.join(',')))];
    if (!seen.length || names.length !== 1 || names[0] !== want) fail(`${bot} was offered ${JSON.stringify(names)} over ${seen.length} model calls, not ${want}`);
    say(`${bot}: offered ${want} on each of its ${seen.length} model calls.`);
  }
  if (offered.some((o) => !['scout', 'scribe'].includes(o.bot))) fail(`a model call came from someone else: ${JSON.stringify(offered)}`);
};
const noted = (bot) => results(bot).filter((m) => m.toolName === 'notes').map((m) => m.content.map((c) => c.text).join(''));

if (recall) {
  say(`\nAfter the restart: a new crewd (${crewd}), no Pi running, and both Pi sessions removed, so notes.md is all that is left of the first turn.`);
  if (Object.keys(pis()).length) fail('a Pi runs before anyone is asked');
  for (const bot of ['scout', 'scribe']) { rmSync(join(work(bot), 'sessions'), { recursive: true }); say(`${bot}'s notes.md: ${JSON.stringify(notes(bot))}`); }
  const full = `${notes('scribe')}- ${'x'.repeat(8192 - Buffer.byteLength(notes('scribe')) - 6)}\n`;
  writeFileSync(join(work('scribe'), 'notes.md'), full);
  say(`Scribe's notes filled to ${Buffer.byteLength(full)} of 8192 bytes.`);
  const jobs = await Promise.all([ask('scout', 'What is my locker code? Read Scribe\'s notes too and tell me Scribe\'s locker code.'), ask('scribe', 'What is my locker code? Then add this to your notes: my bike lock is 4471. Tell me in one short sentence whether it was saved.')]);
  const replies = {};
  for (const [i, bot] of ['scout', 'scribe'].entries()) {
    const said = replies[bot] = answered(bot, await ended(bot, jobs[i]));
    if (!said.includes(code[bot])) fail(`${bot} did not recall its own code: ${said}`);
    if (said.includes(code[other[bot]]) || session(bot).includes(code[other[bot]])) fail(`${bot} reached ${other[bot]}'s code: ${said}`);
    if (!noted(bot).some((text) => text.includes(code[bot]))) fail(`${bot}'s code did not come from its notes tool`);
    say(`${bot} read its notes and its code was there. ${other[bot]}'s code is not in its reply or its Pi session.`);
  }

  say('\nFull notes:');
  const line = noted('scribe').find((text) => /^Your notes are full/.test(text));
  if (!line) fail('the notes tool never said it was full');
  if (notes('scribe') !== full) fail('a note was saved past the bound');
  if (!/full|not saved|no room|out of (room|space)/i.test(replies.scribe)) fail(`scribe did not say so: ${replies.scribe}`);
  say(`The tool said: ${line}\nnotes.md is unchanged, byte for byte.`);

  await idle();
  say('\nTools:');
  offers();
  say(`${calls().length} model calls in all.`);
  console.log(JSON.stringify(replies));
  process.exit(0);
}

writeFileSync(record, 'Engine: Pi, flag on. Bots asked: scout, scribe. Bot never asked: chief.\n');

for (const [bot, name] of [['scout', 'Scout'], ['scribe', 'Scribe']]) await api('/api/recruit', { template: bot, name });
for (const bot of ['scout', 'scribe']) appendFileSync(join(lab, 'crew', 'people', '1', 'notes', `${bot}.md`), `- Umer's favourite colour is ${colour[bot]}\n`);
writeFileSync(join(lab, 'crew', 'bots', 'scribe', 'extensions.json'), '["hello", "notes"]\n');
say('Extension lists: scout has no list in its folder, so the default (todo, notes); scribe\'s folder lists hello and notes.');
if (Object.keys(pis()).length) fail('a Pi runs before anyone is asked');
say('Before anyone is asked: no Pi is running.');

say('\nBoth at once:');
const jobs = await Promise.all(['scout', 'scribe'].map((bot) => ask(bot, `My word for you is ${word[bot]}. Add to your notes that my locker code is ${code[bot]}. Then reply in one short sentence with that word and my favourite colour from what you know about me.`)));
const running = await until('two Pis at once', () => { const p = pis(); return p.scout && p.scribe ? p : undefined; }, 30_000);
if (Object.keys(running).length !== 2 || running.scout === running.scribe) fail(`crewd runs ${JSON.stringify(running)}`);
say(`Running at the same moment: ${JSON.stringify(running)} (process ids by bot). Chief has none.`);
const replies = {};
for (const [i, bot] of ['scout', 'scribe'].entries()) { replies[bot] = answered(bot, await ended(bot, jobs[i])); bothKnow(bot, replies[bot]); }

await idle();
if (existsSync(join(lab, 'state', 'pi', 'chief'))) fail('chief was never asked, yet has a Pi folder');
say('Chief, never asked, has no Pi folder and never had a process.');

say('\nTools:');
offers();
for (const bot of ['scout', 'scribe']) {
  if (!used(bot).includes('notes') || used(bot).some((name) => name !== 'notes' && name !== own[bot])) fail(`${bot} called ${JSON.stringify(used(bot))}, not its notes and only tools of its own`);
  say(`${bot} called ${used(bot).join(', ')} and they said: ${results(bot).map((m) => m.content.map((c) => c.text).join('')).join(' | ')}`);
  if (!notes(bot).includes(code[bot]) || notes(bot).includes(code[other[bot]])) fail(`${bot}'s notes.md holds ${JSON.stringify(notes(bot))}`);
}
for (const bot of ['scout', 'scribe']) {
  if (new RegExp(`${word[other[bot]]}|${colour[other[bot]]}`, 'i').test(session(bot))) fail(`${bot}'s session holds ${other[bot]}'s words`);
}
say('Each session file holds its own word and note and never the other helper\'s.');
console.log(JSON.stringify(replies));
