// Chief's computer in the installed app (features/chief-computer.md), a plan for pwa-shell.mjs against a running
// pair-lab.sh whose web/dist was built with CREWHOUSE_CLOUD=1:
//   node computer-plan.mjs <lab dir> <evidence dir> > plan.json
// Pairs the public shell by the relay code (yes at the computer), names the person Umer, installs the app from
// Settings, then in the installed window: Settings with its Chief's computer row and the page, day
// and night at 390 and 1440, plus one tap on the dimmed Reset, which must answer with the reason — no sheet, no toast.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const [S, EV] = process.argv.slice(2).map((p) => resolve(p));
const SK = dirname(new URL(import.meta.url).pathname);
const WEB = /^WEB=(.*)$/m.exec(readFileSync(`${S}/env`, 'utf8'))[1];
const cli = `LAB=${S} ${SK}/pair-lab.sh cli`;
const put = (sel) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p, 'value').set.call(t, {{out}}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length; })()`;
const reset = `document.querySelector('.computer-off .row-item')`;
const steps = [
  { name: 'pair', w: 390, h: 844, dpr: 2, mobile: true, url: `${WEB}?day#/pair`, settle: 3000 },
  { name: 'code', run: `${cli} phones code | tail -1`, eval: put('.pair-code') },
  { name: 'go', run: 'sleep 0.5; true', click: '.flow .btn.go', settle: 500 },
  { name: 'words', wait: `!!document.querySelector('.pair-words')`, timeout: 20000, eval: `document.querySelector('.pair-words').textContent` },
  { name: 'approve', run: `${cli} phones approve "$(${cli} phones pending | tail -1 | sed 's/.*: //')"` },
  { name: 'hello', wait: `!!document.querySelector('.hello .idea')`, timeout: 20000 },
  { name: 'name', run: 'echo Umer', eval: put('.name-ask input') },
  { name: 'onboard', click: '.hello .idea', settle: 4000 },
  { name: 'open', w: 1400, h: 950, dpr: 1, mobile: false, url: `${WEB}#/settings`, settle: 4000 },
  { name: 'offer', wait: `!!document.querySelector('.install .btn')`, timeout: 20000 },
  { name: 'install', click: '.install .btn', settle: 3000 },
  { name: 'sheet', xshot: `${EV}/pwa/install-sheet.png` },
  { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return' },
  { name: 'window', xshot: `${EV}/pwa/installed-window.png` },
  { name: 'attach', attachApp: WEB },
  { name: 'standalone', eval: `matchMedia('(display-mode: standalone)').matches` },
];
for (const look of ['day', 'night']) for (const [w, h] of [[390, 844], [1440, 900]]) {
  const at = { w, h, dpr: w < 500 ? 2 : 1, mobile: w < 500 };
  steps.push({ name: `settings-${look}-${w}`, ...at, url: `${WEB}?${look}#/settings`, settle: 4000, wait: `[...document.querySelectorAll('.go-to')].some((a) => a.textContent === "Chief's computer")`, timeout: 20000,
    eval: `[matchMedia('(display-mode: standalone)').matches, [...document.querySelectorAll('.go-to')].map((a) => a.textContent)]`, out: `${EV}/pwa/settings-${look}-${w}.png` });
  steps.push({ name: `computer-${look}-${w}`, eval: `(() => { [...document.querySelectorAll('.go-to')].find((a) => a.textContent === "Chief's computer").click(); return location.hash; })()` });
  steps.push({ name: `computer-${look}-${w}-shot`, run: 'sleep 1; true', wait: `!!${reset}`, eval: `document.querySelector('.computer').innerText`, out: `${EV}/pwa/computer-${look}-${w}.png` });
  steps.push({ name: `tap-${look}-${w}`, eval: `(() => { document.querySelector('.computer-off').click(); return true; })()` });
  steps.push({ name: `tap-${look}-${w}-shot`, run: 'sleep 0.5; true',
    eval: `[!!document.querySelector('.computer-connect.nudge'), !!document.querySelector('.computer-ask'), !!document.querySelector('.toast'), document.querySelector('.computer-connect')?.textContent ?? '']`,
    out: `${EV}/pwa/computer-tap-${look}-${w}.png` });
}
// A tap on the dimmed Reset answers with the reason (the `.computer-connect.nudge` line) — no sheet, no toast.
// The answer is also recorded at 390 wide: the recorder starts first, then the tap lands inside its six seconds.
steps.push({ name: 'tap-390', w: 390, h: 844, dpr: 2, mobile: true, url: `${WEB}?day#/computer`, settle: 2000, wait: `!!${reset}`,
  record: `${EV}/pwa/computer-tap-answer.webm`, seconds: 6 });
steps.push({ name: 'tap-390-click', eval: `(() => { document.querySelector('.computer-off').click(); return true; })()` });
steps.push({ name: 'tap-390-shot',
  eval: `[!!document.querySelector('.computer-connect.nudge'), !!document.querySelector('.computer-ask'), !!document.querySelector('.toast'), document.querySelector('.computer-connect')?.textContent ?? '']`,
  out: `${EV}/pwa/computer-tap-answer.png` });
steps.push({ name: 'tap-390-recorded', recwait: true });
console.log(JSON.stringify({ profile: `${S}/pwa/profile`, home: `${S}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`,
  args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps }, null, 1));
