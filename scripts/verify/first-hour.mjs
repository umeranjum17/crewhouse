// The first hour by Umer's own taps on the paired phone (first-hour.sh): his CV PDF with "find me good stuff", Start on
// the goal card, the look's live steps and its roles in Chief's chat, then Research Rae's chat. Never a tap that leaves
// the app but the system file picker for his CV; nothing is sent anywhere but his own crewd.
//   SERIAL=<emulator> node scripts/verify/first-hour.mjs <out> <lab>
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, lab] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(join(lab, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const KEY = readFileSync(join(lab, 'state', 'person.key'), 'utf8').trim();
const A = (...a) => execFileSync('adb', ['-s', process.env.SERIAL, ...a], { encoding: 'utf8', maxBuffer: 1 << 27 });
const ui = (...a) => execFileSync(process.execPath, [new URL('./phone-ui.mjs', import.meta.url).pathname, ...a], { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = (path) => fetch(`${env.B}${path}`, { headers: { 'x-crewhouse': '1', authorization: `Bearer ${KEY}` } }).then((r) => r.json());
const texts = () => { try { return ui('texts'); } catch { return ''; } }; // a dump fails while the screen animates: a miss
const on = async (re, ms = 240_000) => { const end = Date.now() + ms; while (!re.test(texts())) { if (Date.now() > end) { writeFileSync(join(out, 'last-texts.txt'), texts()); ui('shot', join(out, 'screens', 'failed.png')); throw new Error(`never on screen: ${re}`); } await sleep(700); } };
const shot = (n) => ui('shot', join(out, 'screens', n));
// Controlled inputs drop fast injected text: three letters at a time (`input text` takes %s for a space).
const type = async (v) => { for (let i = 0; i < v.length; i += 3) { A('shell', 'input', 'text', v.slice(i, i + 3).replaceAll(' ', '%s')); await sleep(250); } };
// Drags the chat until a line shows: down (y1 < y2) to earlier lines, up to later ones; six drags at most.
const drag = async (re, y1, y2) => { for (let i = 0; !re.test(texts()); i++) { if (i === 6) throw new Error(`never dragged to ${re}`); A('shell', 'input', 'swipe', '540', y1, '540', y2, '400'); await sleep(900); } };
const close = () => { if (/mInputShown=true/.test(A('shell', 'dumpsys', 'input_method'))) A('shell', 'input', 'keyevent', '4'); };

await on(/Ask Chief anything/); await sleep(1500); shot('01-home.png');
// Step one: his CV from the phone's own files, then his words with it (the keyboard closes before Send, never after it).
ui('tap', '^Add a photo or a document$'); await on(/A document: PDF/); ui('tap', '^A document: PDF'); await on(/Umer_CV/, 60_000); await sleep(800); shot('02-picker.png');
ui('tap', 'Umer_CV'); await on(/Umer_CV\.pdf/); await sleep(600);
ui('tap', 'Ask Chief anything'); await sleep(800); await type('This is my resume find me good stuff'); close(); await sleep(600); shot('03-cv-attached.png');
ui('tap', '^Send$');
await on(/Yes, start my search/); await sleep(1500); shot('04-goal-card.png'); // the chat lands on the card's yes
// Above it, Chief's reading of the PDF; then back to the card's yes.
await drag(/I read your CV/, '800', '1700'); shot('05-cv-read.png');
await drag(/Yes, start my search/, '1700', '800'); shot('06-goal-card-open.png');
ui('tap', '^(Start|Yes|Hire)'); // the goal card's yes: nothing starts before it
await on(/roles? that fits?:/, 240_000); await on(/Draft my application/); await sleep(1500); shot('07-results.png'); // the cards end the chat
// Above them, the hand-off line and the look's live steps (quick on the scripted model): drag the chat back down to it.
await drag(/is looking now/, '800', '1700'); shot('08-dispatched.png');
await drag(/Draft my application/, '1700', '800'); shot('09-role-cards.png');
const s = await api('/api/state');
writeFileSync(join(out, 'first-hour.json'), JSON.stringify({ goal: s.goals[0]?.goal, roles: s.goals[0]?.roles.map((r) => ({ co: r.co, title: r.title, url: r.url, fit: r.fit })), engine: s.engine }, null, 1));
// Research Rae's own chat: the look's steps, in Rae's words.
ui('tap', '^Crew$'); await sleep(1500); // the tab, never BACK: BACK on a tab leaves the app
await on(/Research Rae/); ui('tap', '^Research Rae'); await on(/Searching remote AI engineering roles|Added \d roles/); await sleep(1500); shot('10-rae.png');
// The same chat on the web and in the installed app: the look's line and its roles as cards. home-gate shoots it at both
// widths, day and night; its 16px rule is Home's, so on a chat its verdict is kept in <slug>-gate.json, not a stop.
const repo = new URL('../..', import.meta.url).pathname, js = "(async () => { location.hash = '#/chief'; await new Promise((r) => setTimeout(r, 2500)); document.querySelector('.role')?.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 600)); })()";
for (const pwa of ['', '1']) spawnSync(process.execPath, [join(repo, 'scripts/verify/home-gate.mjs'), repo, `${env.B}/#person=${KEY}`, out, `${pwa ? 'pwa-' : ''}chief-results`, js], { stdio: 'inherit', env: { ...process.env, ...(pwa ? { GATE_PWA: '1' } : {}) } });
