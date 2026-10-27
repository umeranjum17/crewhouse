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

// Home is a chat list (Chief first); his CV goes in Chief's own chat, opened by the bar's Chief.
await on(/Keeping an eye on things/); await sleep(1500); shot('01-home.png');
ui('tap', '^Chief$', 1); await on(/Tell Chief anything/);
// Step one: his CV from the phone's own files, then his words with it (the keyboard closes before Send, never after it).
ui('tap', '^Add a photo or a document$'); await on(/A document: PDF/); ui('tap', '^A document: PDF'); await on(/Umer_CV/, 60_000); await sleep(800); shot('02-picker.png');
ui('tap', 'Umer_CV'); await on(/Umer_CV\.pdf/); await sleep(600);
ui('tap', '^Tell Chief anything'); await sleep(800); await type('This is my resume find me good stuff'); close(); await sleep(600); shot('03-cv-attached.png');
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
// He says hi in Chief's chat: the whole box and its send sit above the keyboard while he types (read as
// phone-keyboard.mjs reads it), the Home | Chief | Crew bar steps aside, and the message gets one reply.
const nodes = () => { A('shell', 'uiautomator', 'dump', '/sdcard/ui.xml'); return [...A('shell', 'cat', '/sdcard/ui.xml').matchAll(/<node [^>]*>/g)].map(([n]) => ({
  text: (n.match(/ text="([^"]*)"/) || [])[1] || '', desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '', pkg: (n.match(/package="([^"]*)"/) || [])[1],
  b: (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number) })).filter((n) => n.pkg === 'dev.crewhouse.app'); };
ui('tap', '^Tell Chief anything'); for (let i = 0; i < 25 && !/mInputShown=true/.test(A('shell', 'dumpsys', 'input_method')); i++) await sleep(400);
await type('hi Chief are you still there'); await sleep(800);
const win = A('shell', 'dumpsys', 'window', 'InputMethod'), top = Number(win.match(/ frame=\[\d+,(\d+)\]/)[1]) + Number(win.match(/mGivenContentInsets=\[\d+,(\d+)\]/)[1]);
const app = nodes(), send = app.find((n) => n.text === 'Send' || n.desc === 'Send'), field = app.find((n) => /are you still there/.test(n.text));
const keyboard = { top, send: send?.b, field: field?.b, bar: app.filter((n) => /^(Home|Crew)$/.test(n.text)).map((n) => n.b) };
shot('10-typing.png');
if (!send || !field || send.b[3] > top || field.b[3] > top || keyboard.bar.length) throw new Error(`the box is not whole above the keyboard: ${JSON.stringify(keyboard)}`);
close(); await sleep(600); ui('tap', '^Send$');
await on(/What can the crew do for you today/); await sleep(8000); // a second copy (a streamed one left standing) shows by now
shot('11-one-reply.png');
const said = (await api('/api/bots/chief')).messages.filter((m) => m.author !== 'person').map((m) => m.text);
const replies = { hiOnScreen: nodes().filter((n) => n.text.includes('What can the crew do for you today')).length,
  hi: said.filter((t) => t.includes('What can the crew do for you today')).length, cv: said.filter((t) => t.includes('I read your CV')).length };
if (Object.values(replies).some((n) => n !== 1)) throw new Error(`not one reply per message: ${JSON.stringify(replies)}`);
const s = await api('/api/state');
writeFileSync(join(out, 'first-hour.json'), JSON.stringify({ goal: s.goals[0]?.goal, roles: s.goals[0]?.roles.map((r) => ({ co: r.co, title: r.title, url: r.url, fit: r.fit })), engine: s.engine, keyboard, replies }, null, 1));
// Research Rae's own chat: the look's steps, in Rae's words.
ui('tap', '^Crew$'); await sleep(1500); // the tab, never BACK: BACK on a tab leaves the app
await on(/Research Rae/); ui('tap', '^Research Rae'); await on(/Searching remote AI engineering roles|Added \d roles/); await sleep(1500); shot('12-rae.png');
// The app in the background (left on Rae's chat): he asks from the computer, Chief's answer arrives as a notification,
// and its tap opens Chief's chat, not Rae's or Home.
A('shell', 'input', 'keyevent', 'HOME'); await sleep(2000);
await fetch(`${env.B}/api/bots/chief/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ text: 'any news' }) });
for (const end = Date.now() + 180_000; !/roles for you, Umer/.test(A('shell', 'dumpsys', 'notification', '--noredact'));) { if (Date.now() > end) throw new Error('Chief\'s answer never showed as a notification'); await sleep(2000); }
A('shell', 'cmd', 'statusbar', 'expand-notifications'); await sleep(2500); shot('13-notification.png');
ui('tap', 'roles for you, Umer'); await on(/Tell Chief anything/, 30_000); await on(/roles for you, Umer/, 30_000); await sleep(1500); shot('14-notification-opens-chief.png');
// The same chat on the web and in the installed app: the look's line and its roles as cards. home-gate shoots it at both
// widths, day and night; its 16px rule is Home's, so on a chat its verdict is kept in <slug>-gate.json, not a stop.
const repo = new URL('../..', import.meta.url).pathname, js = "(async () => { location.hash = '#/chief'; await new Promise((r) => setTimeout(r, 2500)); document.querySelector('.role')?.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 600)); })()";
for (const pwa of ['', '1']) spawnSync(process.execPath, [join(repo, 'scripts/verify/home-gate.mjs'), repo, `${env.B}/#person=${KEY}`, out, `${pwa ? 'pwa-' : ''}chief-results`, js], { stdio: 'inherit', env: { ...process.env, ...(pwa ? { GATE_PWA: '1' } : {}) } });
