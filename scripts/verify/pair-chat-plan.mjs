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
// Chief's words in the thread after the person's last line, as the app shows them (his name question and pitch come first).
const answer = `(() => { const all = [...document.querySelectorAll('.lines .line')]; const me = all.map((e) => e.classList.contains('me')).lastIndexOf(true); const l = all.slice(me + 1).filter((e) => e.classList.contains('them')).map((e) => e.querySelector('.bubble-text')?.textContent.trim()).filter(Boolean); return me < 0 || !l.length ? '' : l[l.length - 1]; })()`;

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
  // The first run opens on Chief's chat: he asks the name, the person answers in the chat's own box, his pitch follows.
  { name: 'hello', wait: `location.hash === '#/chief' && !!document.querySelector('.dock textarea') && /What shall I call you/.test(document.body.innerText)`, timeout: 60000 },
  { name: 'name', run: 'echo Umer', eval: put('.dock textarea') },
  { name: 'name-send', click: '.dock button.send', settle: 3000 },
  { name: 'pitch', wait: `document.querySelectorAll('.chips.center .chip').length >= 3`, timeout: 120000 },
  { name: 'ask', run: `printf '%s' ${JSON.stringify(ASK)}`, eval: put('.dock textarea') },
  { name: 'send', click: '.dock button.send', settle: 3000 },
  { name: 'answer', wait: `!!(${answer})`, timeout: 300000 },
  { name: 'settle', run: 'sleep 20; true' }, // the first words are a partial line: let the answer finish streaming before it is read
  { name: 'reply', eval: answer },
];
// The same answer, in both looks and both widths: the person's own screen.
for (const look of ['day', 'night']) {
  for (const z of [{ w: 390, h: 844, dpr: 2, mobile: true, tag: '390' }, { w: 1440, h: 900, dpr: 1, mobile: false, tag: '1440' }]) {
    steps.push({ name: `chat-${look}-${z.tag}`, w: z.w, h: z.h, dpr: z.dpr, mobile: z.mobile, url: `${WEB}?${look}#/chief`, settle: 5000, wait: `!!(${answer})`, timeout: 90000, out: `${EV}/chief-reply-${look}-${z.tag}.png` });
  }
}
console.log(JSON.stringify({ profile: `${S}/pwa/profile`, home: `${S}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`, steps }, null, 1));
