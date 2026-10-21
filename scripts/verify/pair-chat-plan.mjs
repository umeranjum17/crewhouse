// The core journey's browser plan (scripts/verify/pair-chat.sh): the public shell on a public-style origin,
// the person pairs it to their own crew (the code the computer prints, the two words, yes at the computer),
// then says hello and reads Chief's real answer. One Chromium under Xvfb, driven over CDP from this plan.
//   node pair-chat-plan.mjs <lab dir> <evidence dir> > plan.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [S, EV] = process.argv.slice(2).map((p) => resolve(p));
const SK = dirname(new URL(import.meta.url).pathname);
const WEB = /^WEB=(.*)$/m.exec(readFileSync(`${S}/env`, 'utf8'))[1];
const cli = `${S}/cli`; // the computer's own CLI against this lab
const ASK = process.env.ASK ?? 'Good morning Chief. Please say hello back in one short sentence.';
const put = (sel) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return -1; const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p, 'value').set.call(t, {{out}}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length; })()`;
// The app's own state: the demo crew, the public shell with no computer paired, or the real crew.
const mode = `(document.querySelector('.demo-tag') ? 'demo' : document.querySelector('.fr-hello') || document.querySelector('.name-ask') ? 'real' : document.querySelector('.where') ? 'where' : document.querySelector('main') ? 'app' : 'none')`;
// The pair sheet is gone: the app has left it and is the person's own crew.
const unpaired = `!document.querySelector('.pair-words') && !document.querySelector('.pair-code')`;
// Chief's words in the thread, as the app shows them.
const answer = `(() => { const l = [...document.querySelectorAll('.line.them .bubble-text')].map((e) => e.textContent.trim()).filter(Boolean); return l.length ? l[l.length - 1] : ''; })()`;

const steps = [
  { name: 'open', w: 390, h: 844, dpr: 2, mobile: true, url: WEB, settle: 5000 },
  { name: 'where', eval: mode },
  { name: 'pair-row', click: '.where-opt.first', settle: 2500 },
  { name: 'sheet', eval: `document.body.innerText.slice(0, 200)` },
  { name: 'code', run: `${cli} phones code | tail -1`, eval: put('.pair-code') },
  { name: 'go-wait', wait: `!!document.querySelector('.pair-code')`, timeout: 30000 },
  { name: 'go', click: '.fr-acts .btn.go', settle: 1500 },
  { name: 'words', wait: `!!document.querySelector('.pair-words')`, timeout: 30000, eval: `document.querySelector('.pair-words').textContent`, out: `${EV}/two-words-390.png` },
  { name: 'approve', run: `${cli} phones approve "$(${cli} phones pending | tail -1 | sed 's/.*: //')"` },
  { name: 'paired', wait: unpaired, timeout: 120000, eval: mode },
  { name: 'hello', wait: `!!document.querySelector('.name-ask input')`, timeout: 60000 },
  { name: 'name', run: 'echo Umer', eval: put('.name-ask input') },
  { name: 'ask', run: `printf '%s' ${JSON.stringify(ASK)}`, eval: put('.hello-ask .composer textarea') },
  { name: 'send', click: '.hello-ask .composer .send', settle: 3000 },
  { name: 'answer', wait: `!!(${answer})`, timeout: 300000 },
  { name: 'reply', eval: answer },
];
// The same answer, in both looks and both widths: the person's own screen.
for (const look of ['day', 'night']) {
  for (const z of [{ w: 390, h: 844, dpr: 2, mobile: true, tag: '390' }, { w: 1440, h: 900, dpr: 1, mobile: false, tag: '1440' }]) {
    steps.push({ name: `chat-${look}-${z.tag}`, w: z.w, h: z.h, dpr: z.dpr, mobile: z.mobile, url: `${WEB}?${look}#/chief`, settle: 5000, wait: `!!(${answer})`, timeout: 90000, out: `${EV}/chief-reply-${look}-${z.tag}.png` });
  }
}
console.log(JSON.stringify({ profile: `${S}/pwa/profile`, home: `${S}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`, steps }, null, 1));
