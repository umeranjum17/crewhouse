#!/usr/bin/env node
// The crew half of the `pi-engine` journey (pi-engine.sh): three helpers on one flag-on crewd, driven through the API the app uses.
// Scout and Scribe are asked at once, four rounds, and each reply is checked against that helper's own Pi session record; Reel is
// never asked. Round 3 kills Scout's Pi mid-turn: its job fails, Scribe's finishes, and Scout then picks its session back up.
//   node scripts/verify/pi-crew.mjs <base-url> <lab> <crewd-pid> <out-dir>
// Writes <out-dir>/crew.txt and prints the last replies as JSON. Exits non-zero the moment a helper's words or processes are wrong.
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
const spoke = (bot) => session(bot).trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.message?.role === 'assistant').flatMap((r) => r.message.content.filter((c) => c.type === 'text').map((c) => c.text)).join('\n');
const answered = (bot, end) => {
  if (end.state !== 'done') fail(`${bot}'s job ended ${end.state}`);
  say(`${bot} replied: ${end.said}`);
  if (!flat(spoke(bot)).includes(flat(end.said).slice(0, 30))) fail(`${bot}'s chat has words its Pi session does not`);
  return end.said;
};
const bothKnow = (bot, said) => {
  const words = said.toLowerCase();
  if (!words.includes(word[bot]) || !words.includes(colour[bot])) fail(`${bot} lost its own word or note: ${said}`);
  if (words.includes(word[other[bot]]) || words.includes(colour[other[bot]])) fail(`${bot} knows what is ${other[bot]}'s: ${said}`);
};
const asked = 'Which word did I ask you to remember, and what is my favourite colour in your notes? Answer in one short sentence.';
writeFileSync(record, `Engine: Pi, flag on. Bots asked: scout, scribe. Bot never asked: reel.\n`);

for (const [bot, template] of [['scout', 'Scout'], ['scribe', 'Scribe'], ['reel', 'Reel']]) await api('/api/recruit', { template: bot, name: template });
for (const bot of ['scout', 'scribe']) appendFileSync(join(lab, 'crew', 'people', '1', 'notes', `${bot}.md`), `- Umer's favourite colour is ${colour[bot]}\n`);
await until('Chief to go idle', () => !Object.keys(pis()).length);
say('Before anyone is asked: no Pi is running, and Chief finished earlier.');

say('\nRound 1, both at once:');
const first = await Promise.all(['scout', 'scribe'].map((bot) => ask(bot, `Remember this word for later: ${word[bot]}. Reply with one short sentence.`)));
const running = await until('two Pis at once', () => { const p = pis(); return p.scout && p.scribe ? p : undefined; }, 30_000);
if (Object.keys(running).length !== 2 || running.scout === running.scribe) fail(`crewd runs ${JSON.stringify(running)}`);
say(`Running at the same moment: ${JSON.stringify(running)} (process ids by bot). Chief and Reel have none.`);
for (const [i, bot] of ['scout', 'scribe'].entries()) answered(bot, await ended(bot, first[i]));

await until('both Pis to stop once idle', () => !Object.keys(pis()).length);
say('\nIdle: no Pi is running now.');

say('\nRound 2, both at once, each on a new Pi over its old session:');
const second = await Promise.all(['scout', 'scribe'].map((bot) => ask(bot, asked)));
for (const [i, bot] of ['scout', 'scribe'].entries()) bothKnow(bot, answered(bot, await ended(bot, second[i])));

say('\nRound 3, both at once, Scout\'s Pi killed mid-turn:');
const third = await Promise.all([ask('scout', 'Write a 300 word story about a lighthouse.'), ask('scribe', 'Write a 150 word story about a harbour, and finish it.')]);
const live = await until('two Pis to kill one of', () => { const p = pis(); return p.scout && p.scribe ? p : undefined; }, 30_000);
const midTurn = (await api('/api/bots/scout')).tasks.find((t) => t.id === third[0])?.state === 'working';
if (!midTurn) fail('Scout finished before its Pi could be killed');
process.kill(live.scout, 'SIGKILL');
say(`Killed Scout's Pi, process ${live.scout}, while Scribe's, process ${live.scribe}, was at work.`);
const lost = await ended('scout', third[0]);
if (lost.state !== 'failed') fail(`Scout's job ended ${lost.state} after its Pi was killed`);
say('Scout\'s job failed.');
answered('scribe', await ended('scribe', third[1]));
say('Scribe finished its story on its own Pi.');

say('\nRound 4, Scout again after the crash:');
const back = answered('scout', await ended('scout', await ask('scout', asked)));
bothKnow('scout', back);

await until('both Pis to stop once idle', () => !Object.keys(pis()).length);
say('\nIdle again: no Pi is running.');
if (existsSync(join(lab, 'state', 'pi', 'reel'))) fail('Reel was never asked, yet has a Pi folder');
say('Reel, never asked, has no Pi folder and never had a process.');
for (const bot of ['scout', 'scribe']) if (new RegExp(`${word[other[bot]]}|${colour[other[bot]]}`, 'i').test(session(bot))) fail(`${bot}'s session holds ${other[bot]}'s words`);
say('Each session file holds its own word and note and never the other helper\'s.');
console.log(JSON.stringify({ scout: back, scribe: (await api('/api/bots/scribe')).messages.filter((m) => m.author === 'bot').at(-1).text }));
