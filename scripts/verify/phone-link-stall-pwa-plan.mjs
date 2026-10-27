#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { version } from './steps.mjs';

const [labArg, outArg] = process.argv.slice(2);
if (!labArg || !outArg) throw new Error('usage: phone-link-stall-pwa-plan.mjs <lab> <evidence-dir>');
const lab = resolve(labArg), out = resolve(outArg);
const env = Object.fromEntries(readFileSync(`${lab}/env`, 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
const base = JSON.parse(execFileSync(process.execPath, ['scripts/verify/pair-plan.mjs', lab, out], { encoding: 'utf8' }));
const q = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const launchInstalled = `entry=$(find ${q(`${base.home}/.local/share/applications`)} -maxdepth 1 -type f -name 'chrome-*-Default.desktop' -print -quit); test -n "$entry"; command=$(sed -n 's/^Exec=//p' "$entry"); test -n "$command"; eval "$command"`;
const cli = `LAB=${q(lab)} ${q(`${import.meta.dirname}/pair-lab.sh`)} cli`;
const pairCode = `(() => { const t = document.querySelector('.pair-code'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, {{out}}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length; })()`;
const atWorkAfterPaint = `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.body.innerText.includes('Scout is working') && !document.body.innerText.includes("Can't reach the home computer")))))`;
const pendingWords = `$(LAB=${q(lab)} ${q(`${import.meta.dirname}/pair-lab.sh`)} cli phones pending | tail -1 | sed 's/.*: //')`;
const steps = base.steps.slice(0, base.steps.findIndex((step) => step.name === 'standalone') + 1);
steps.forEach((step) => { delete step.xshot; }); // Setup UI is not part of the outcome evidence set.
const returnAt = steps.findIndex((step) => step.name === 'return');
if (returnAt < 0) throw new Error('the pairing plan has no install confirmation step');
steps.splice(returnAt + 1, 0, { name: 'launch-installed-pwa', run: launchInstalled });
const standalone = steps.find((step) => step.name === 'standalone');
standalone.wait = `matchMedia('(display-mode: standalone)').matches`;
standalone.timeout = 10000;
steps.push(
  { name: 'pair-settings', url: `${env.WEB}?demo&day#/settings`, settle: 2500 },
  { name: 'pair-open', eval: `location.hash = '#/pair'` },
  { name: 'pair-code', run: `${cli} phones code | tail -1`, eval: pairCode },
  { name: 'pair-submit', wait: "!!document.querySelector('.fr-acts .btn.go')", eval: "document.querySelector('.fr-acts .btn.go').click()" },
  { name: 'pair-words', wait: '!!document.querySelector(".pair-words")', timeout: 20_000, eval: 'document.querySelector(".pair-words").textContent' },
  { name: 'pair-approve', run: `${cli} phones approve "${pendingWords}"` },
  { name: 'paired', wait: "!!document.querySelector('.demo-tag') === false", timeout: 20_000, eval: "!!document.querySelector('.demo-tag')" },
  { name: 'seed', run: `node scripts/verify/seed-link-stall.mjs ${q(lab)}` },
  { name: 'working', wait: "document.body.innerText.includes('Scout is working')", timeout: 30_000, eval: "document.body.innerText.includes('Scout is working')" },
  { name: 'home', url: `${env.WEB}#/`, settle: 3000, wait: "document.body.innerText.includes('Scout is working')" },
);
const sizes = [{ tag: 'phone', w: 390, h: 844, mobile: true }, { tag: 'desk', w: 1440, h: 900, mobile: false }];
for (const look of ['light', 'dark']) for (const size of sizes) {
  steps.push({ name: `before-${look}-${size.tag}`, scheme: look === 'light' ? 'light' : 'dark', w: size.w, h: size.h, dpr: size.mobile ? 2 : 1, mobile: size.mobile,
    wait: atWorkAfterPaint, eval: "document.body.innerText.includes('Scout is working') && !document.body.innerText.includes(\"Can't reach the home computer\")", out: `${out}/shots/pwa-before-${look}-${size.w}.png` });
}
const queue = `${lab}/link-queue.txt`, done = `${lab}/link-resumed.txt`, failed = `${lab}/link-stall-failed.txt`, log = `${lab}/link-stall.log`;
steps.push(
  { name: 'stall-watch-start', eval: `(() => { window.__stallWatchStart = Date.now(); window.__stallSamples = []; window.__stallMonitor = setInterval(() => { const text = document.body.innerText; window.__stallSamples.push({ banner: /Can't reach the home computer/i.test(text), working: /Scout is working/.test(text) }); }, 1000); return true; })()` },
  { name: 'stall-start', run: `node scripts/verify/hold-link-loop.mjs ${q(lab)} ${q(queue)} ${q(done)} ${q(failed)} > ${q(log)} 2>&1 </dev/null & echo $! > ${q(`${lab}/link-stall.pid`)}` },
  { name: 'stall-queue', run: `node scripts/verify/wait-link-stall.mjs ${q(queue)} ${q(failed)}` },
  { name: 'stall-grace', wait: `Date.now() - window.__stallWatchStart >= 20000 && document.body.innerText.includes('Scout is working') && !document.body.innerText.includes("Can't reach the home computer")`, timeout: 25000 },
);
for (const look of ['light', 'dark']) for (const size of sizes) {
  steps.push({ name: `during-${look}-${size.tag}`, scheme: look === 'light' ? 'light' : 'dark', w: size.w, h: size.h, dpr: size.mobile ? 2 : 1, mobile: size.mobile,
    wait: atWorkAfterPaint, eval: "document.body.innerText.includes('Scout is working') && !document.body.innerText.includes(\"Can't reach the home computer\")", out: `${out}/shots/pwa-during-${look}-${size.w}.png` });
}
steps.push(
  { name: 'stall-resume', run: `node scripts/verify/wait-link-stall.mjs ${q(done)} ${q(failed)}` },
  { name: 'stall-visibility', wait: `window.__stallSamples.length >= 70 && window.__stallSamples.every((sample) => !sample.banner && sample.working)`, timeout: 10000, eval: `JSON.stringify({ samples: window.__stallSamples.length, banner: window.__stallSamples.some((sample) => sample.banner), missingWork: window.__stallSamples.some((sample) => !sample.working) })` },
  { name: 'reconnect-message', run: `node scripts/verify/pwa-reconnect-event.mjs ${q(lab)}` },
  { name: 'chief-thread', eval: `location.hash = '#/chief'` },
  { name: 'reconnect-visible', wait: "document.body.innerText.includes('phone reconnect proof')", timeout: 30_000, eval: "document.body.innerText.includes('phone reconnect proof')" },
  { name: 'home-after', url: `${env.WEB}#/`, settle: 6000 },
  { name: 'working-after', wait: "document.body.innerText.includes('Scout is working') && !document.body.innerText.includes(\"Can't reach the home computer\")", timeout: 30_000 },
);
for (const look of ['light', 'dark']) for (const size of sizes) {
  steps.push({ name: `after-${look}-${size.tag}`, scheme: look === 'light' ? 'light' : 'dark', w: size.w, h: size.h, dpr: size.mobile ? 2 : 1, mobile: size.mobile,
    wait: atWorkAfterPaint, eval: "document.body.innerText.includes('Scout is working') && !document.body.innerText.includes(\"Can't reach the home computer\")", out: `${out}/shots/pwa-after-${look}-${size.w}.png` });
}
base.bin = '/usr/bin/google-chrome-stable';
base.steps = steps;
base.record = {
  target: { version: version() },
  start: 'A fresh isolated Crewhouse on the stub engine, paired installed PWA, and a scripted Scout task',
  steps: ['Install and pair the PWA to the isolated computer; seed Scout working on a held task', 'Hold the computer event loop, record the link accept queue, and capture the app during reconnection', 'Resume the computer and verify the PWA loads the post-stall Chief message and still shows Scout working'],
  result: 'The installed PWA keeps running work visible through the event-loop stall, shows no transient cannot-reach banner, and reads fresh computer data after automatic reconnection',
};
console.log(JSON.stringify(base, null, 1));
