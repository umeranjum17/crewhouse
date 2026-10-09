// The installed-app pairing proof (features/pwa-pair.md) as a plan for pwa-shell.mjs, against a running pair-lab.sh:
//   node pair-plan.mjs <lab dir> <evidence dir> > plan.json
// A real install from Settings, one recording (demo, the pair card, a relay code, the two words, yes at the computer,
// real data, a message over the link, Unpair, demo), then the demo, pair card, two-words and paired shots, day and
// night at 390 and 1440. The computer's side is the lab's own ./crewhouse (`pair-lab.sh cli`).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const [S, EV] = process.argv.slice(2).map((p) => resolve(p));
const SK = dirname(new URL(import.meta.url).pathname);
const WEB = /^WEB=(.*)$/m.exec(readFileSync(`${S}/env`, 'utf8'))[1];
const cli = `LAB=${S} ${SK}/pair-lab.sh cli`;
const put = (sel) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p, 'value').set.call(t, {{out}}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length; })()`;
const mode = `(document.querySelector('.demo-tag') ? 'demo' : document.querySelector('main') ? 'real' : 'none')`;
const toTop = `(() => { scrollTo(0, 0); for (const e of document.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 0; return true; })()`;
const sizes = [{ tag: 'phone', w: 390, h: 844, mobile: true }, { tag: 'desk', w: 1440, h: 900, mobile: false }];
const steps = [
  { name: 'open', url: WEB + '#/settings', settle: 4000 },
  { name: 'install', click: '.install .btn', settle: 3000 },
  { name: 'sheet', xshot: `${EV}/shots/install-sheet.png` },
  { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return' },
  { name: 'window', xshot: `${EV}/shots/installed-window.png` },
  { name: 'attach', attachApp: WEB },
  { name: 'standalone', eval: `matchMedia('(display-mode: standalone)').matches` },
  // The recording: demo, the pair card, the relay code, two words, yes at the computer, real data, a message over the link, unpair.
  { name: 'rec-demo', w: 390, h: 844, dpr: 2, mobile: true, url: WEB + '?day', settle: 3000, eval: mode },
  { name: 'rec', record: `${EV}/motion/demo-pair-real-unpair.webm`, seconds: 60 },
  { name: 'rec-pair-btn', click: '.pair-row .btn', settle: 2500 },
  { name: 'rec-code', run: `${cli} phones code | tail -1`, eval: put('.pair-code') },
  { name: 'rec-go', wait: `!!document.querySelector('.flow .btn.go')`, settle: 1500 },
  { name: 'rec-click', click: '.flow .btn.go', settle: 500 },
  { name: 'rec-words', wait: `!!document.querySelector('.pair-words')`, timeout: 20000, eval: `document.querySelector('.pair-words').textContent` },
  { name: 'rec-hold', run: 'sleep 3; true' },
  { name: 'rec-approve', run: `${cli} phones approve "$(${cli} phones pending | tail -1 | sed 's/.*: //')"` },
  { name: 'rec-real', wait: `${mode.replace(/'/g, "'")} === 'real'`, timeout: 20000, eval: mode },
  { name: 'rec-hold2', run: 'sleep 3; true' },
  { name: 'rec-say', run: `echo 'I want to market my app'`, eval: put('.composer textarea') },
  { name: 'rec-send', click: '.composer .send', settle: 6000 },
  { name: 'rec-settings', eval: `location.hash = '#/settings'` }, { name: 'rec-look', run: 'sleep 3; true' },
  { name: 'rec-unpair', eval: `(() => { window.confirm = () => true; [...document.querySelectorAll('button')].find((b) => b.textContent === 'Unpair').click(); return true; })()` },
  { name: 'rec-back', wait: `${mode} === 'demo'`, timeout: 20000, eval: mode },
  { name: 'rec-end', recwait: true },
];
// The shots: the demo with its Pair button and the pair card, each look and width.
for (const look of ['day', 'night']) for (const z of sizes) {
  const at = { w: z.w, h: z.h, dpr: z.mobile ? 2 : 1, mobile: z.mobile };
  steps.push({ name: `demo-${look}-${z.tag}`, ...at, url: `${WEB}?${look}`, settle: 3000, wait: `${mode} === 'demo'`, eval: toTop });
  steps.push({ name: `demo-${look}-${z.tag}-shot`, run: 'sleep 0.5; true', eval: mode, out: `${EV}/shots/demo-pair-button-${look}-${z.w}.png` });
  steps.push({ name: `card-${look}-${z.tag}`, eval: `location.hash = '#/pair'` });
  steps.push({ name: `card-${look}-${z.tag}-shot`, run: 'sleep 1.5; true', wait: `!!document.querySelector('.pair-code')`, out: `${EV}/shots/pair-card-${look}-${z.w}.png` });
}
// Two live pairs for the two-words step (day, then night); the night one gets its yes, so the app opens on real data.
for (const look of ['day', 'night']) {
  steps.push({ name: `pair-${look}`, w: 390, h: 844, dpr: 2, mobile: true, url: `${WEB}?${look}#/pair`, settle: 3000 });
  steps.push({ name: `code-${look}`, run: `${cli} phones code | tail -1`, eval: put('.pair-code') });
  steps.push({ name: `go-${look}`, run: 'sleep 0.5; true', click: '.flow .btn.go', settle: 500 });
  steps.push({ name: `words-${look}`, wait: `!!document.querySelector('.pair-words')`, timeout: 20000, eval: `document.querySelector('.pair-words').textContent`, out: `${EV}/shots/two-words-${look}-390.png` });
  steps.push({ name: `words-${look}-desk`, w: 1440, h: 900, dpr: 1, mobile: false, run: 'sleep 1; true', out: `${EV}/shots/two-words-${look}-1440.png` });
}
steps.push({ name: 'approve', run: `${cli} phones approve "$(${cli} phones pending | tail -1 | sed 's/.*: //')"` });
steps.push({ name: 'paired', wait: `${mode} === 'real'`, timeout: 20000, eval: mode });
for (const look of ['night', 'day']) for (const z of sizes) {
  const at = { w: z.w, h: z.h, dpr: z.mobile ? 2 : 1, mobile: z.mobile };
  steps.push({ name: `real-${look}-${z.tag}`, ...at, url: `${WEB}?${look}`, settle: 4000, wait: `${mode} === 'real'`, eval: `[${mode}, matchMedia('(display-mode: standalone)').matches, document.body.innerText.slice(0, 300)]`, out: `${EV}/shots/paired-real-${look}-${z.w}.png` });
  steps.push({ name: `set-${look}-${z.tag}`, eval: `location.hash = '#/settings'` });
  steps.push({ name: `set-${look}-${z.tag}-shot`, run: 'sleep 2; true', eval: `[...document.querySelectorAll('.card')].some((c) => /Paired with/.test(c.textContent))`, out: `${EV}/shots/paired-settings-${look}-${z.w}.png` });
}
console.log(JSON.stringify({ profile: `${S}/pwa/profile`, home: `${S}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`,
  args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps }, null, 1));
