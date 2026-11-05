#!/usr/bin/env node
// The crew half of the `pi-engine` journey (pi-engine.sh): three helpers on one flag-on crewd, driven through the API the app uses.
// Scout and Scribe are asked at once and answer once each, two model calls in all, and each reply is checked against that helper's
// own Pi session record; Reel is never asked. The crash, restart and session pickup are test/pi-engine.test.ts's: real Pi, scripted model.
//   node scripts/verify/pi-crew.mjs <base-url> <lab> <crewd-pid> <out-dir>
// Writes <out-dir>/crew.txt and prints the replies as JSON. Exits non-zero the moment a helper's words or processes are wrong.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, lab, crewd, out] = process.argv.slice(2);
const key = readFileSync(join(lab, 'state', 'person.key'), 'utf8').trim(), record = join(out, 'crew.txt');
const word = { scout: 'mango', scribe: 'papaya' }, colour = { scout: 'teal', scribe: 'amber' }, other = { scout: 'scribe', scribe: 'scout' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms)), say = (line) => appendFileSync(record, `${line}\n`);
const fail = (why) => { say(`FAILED: ${why}`); console.error(`pi-crew: ${why}`); process.exit(1); };
const until = async (what, fn, ms = 180_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) { const v = await fn(); if (v) return v; } fail(`timed out: ${what}`); };
const api = async (path, body) => {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-crewhouse': '1' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) fail(`${path} said ${res.status}`);
  return res.json();
};
/** crewd's Pis by bot: Pi renames itself, so the folder it works in says whose it is. */
const pis = () => {
  let kids = '';
  try { kids = execFileSync('ps', ['-o', 'pid=,comm=', '--ppid', crewd], { encoding: 'utf8' }); } catch { /* ps exits 1 when there are none */ }
  return Object.fromEntries(kids.split('\n').filter((l) => /pi-rpc/.test(l)).flatMap((l) => {
    const pid = Number(l.trim().split(/\s+/)[0]);
    try { return [[readlinkSync(`/proc/${pid}/cwd`).split('/').at(-2), pid]]; } catch { return []; }
  }));
};
const ask = async (bot, text) => { say(`You asked ${bot}: ${text}`); return (await api(`/api/bots/${bot}/messages`, { text })).task; };
const ended = (bot, task) => until(`${bot}'s job ${task}`, async () => {
  const page = await api(`/api/bots/${bot}`), t = page.tasks.find((x) => x.id === task);
  const said = (page.messages ?? []).filter((m) => m.author === 'bot' && m.task_id === task && String(m.text ?? '').trim()).at(-1)?.text;
  return t?.state === 'failed' || t?.state === 'unsure' ? { state: t.state } : t?.state === 'done' && said ? { state: 'done', said } : undefined;
});
const session = (bot) => { const dir = join(lab, 'state', 'pi', bot, 'work', 'sessions'), files = readdirSync(dir); if (files.length !== 1) fail(`${bot} has ${files.length} Pi sessions`); return readFileSync(join(dir, files[0]), 'utf8'); };
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const turns = (bot) => session(bot).trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.message?.role === 'assistant').map((r) => r.message.content.filter((c) => c.type === 'text').map((c) => c.text).join(''));
const answered = (bot, end) => {
  if (end.state !== 'done') fail(`${bot}'s job ended ${end.state}`);
  say(`${bot} replied: ${end.said}`);
  if (!flat(turns(bot).join('\n')).includes(flat(end.said).slice(0, 30))) fail(`${bot}'s chat has words its Pi session does not`);
  return end.said;
};
const bothKnow = (bot, said) => {
  const words = said.toLowerCase();
  if (!words.includes(word[bot]) || !words.includes(colour[bot])) fail(`${bot} lost its own word or note: ${said}`);
  if (words.includes(word[other[bot]]) || words.includes(colour[other[bot]])) fail(`${bot} knows what is ${other[bot]}'s: ${said}`);
};
writeFileSync(record, 'Engine: Pi, flag on. Bots asked: scout, scribe. Bots never asked: reel, chief.\n');

for (const [bot, name] of [['scout', 'Scout'], ['scribe', 'Scribe'], ['reel', 'Reel']]) await api('/api/recruit', { template: bot, name });
for (const bot of ['scout', 'scribe']) appendFileSync(join(lab, 'crew', 'people', '1', 'notes', `${bot}.md`), `- Umer's favourite colour is ${colour[bot]}\n`);
if (Object.keys(pis()).length) fail('a Pi runs before anyone is asked');
say('Before anyone is asked: no Pi is running.');

say('\nBoth at once:');
const jobs = await Promise.all(['scout', 'scribe'].map((bot) => ask(bot, `My word for you is ${word[bot]}. Reply in one short sentence with that word and my favourite colour from your notes.`)));
const running = await until('two Pis at once', () => { const p = pis(); return p.scout && p.scribe ? p : undefined; }, 30_000);
if (Object.keys(running).length !== 2 || running.scout === running.scribe) fail(`crewd runs ${JSON.stringify(running)}`);
say(`Running at the same moment: ${JSON.stringify(running)} (process ids by bot). Chief and Reel have none.`);
const replies = {};
for (const [i, bot] of ['scout', 'scribe'].entries()) { replies[bot] = answered(bot, await ended(bot, jobs[i])); bothKnow(bot, replies[bot]); }

await until('both Pis to stop once idle', () => !Object.keys(pis()).length);
say('\nIdle: no Pi is running now.');
for (const bot of ['reel', 'chief']) if (existsSync(join(lab, 'state', 'pi', bot))) fail(`${bot} was never asked, yet has a Pi folder`);
say('Reel and Chief, never asked, have no Pi folder and never had a process.');
for (const bot of ['scout', 'scribe']) {
  if (new RegExp(`${word[other[bot]]}|${colour[other[bot]]}`, 'i').test(session(bot))) fail(`${bot}'s session holds ${other[bot]}'s words`);
  if (turns(bot).length !== 1) fail(`${bot} answered ${turns(bot).length} times`);
}
say('Each session file holds one answer, with its own word and note and never the other helper\'s.');
console.log(JSON.stringify(replies));
