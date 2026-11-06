// The paired half of action-card.sh, a plan for pwa-shell.mjs: install the web app, pair it as a control device, then Tracer's
// email: the person's own words, Review one email, the card with Send at each look and width, a double tap, the Sent receipt.
//   node action-card-plan.mjs <lab dir> <evidence dir> > plan.json
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const [S, EV] = process.argv.slice(2).map((p) => resolve(p));
const SK = dirname(new URL(import.meta.url).pathname), WEB = /^WEB=(.*)$/m.exec(readFileSync(`${S}/env`, 'utf8'))[1], cli = `LAB=${S} ${SK}/pair-lab.sh cli`;
const WORDS = 'Hi Ada, these are my own words about the town hall roof.';
const put = (sel, value) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); const p = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(t, ${value}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length > 0; })()`;
const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent === ${JSON.stringify(text)})`;
const draft = `[...document.querySelectorAll('.card.ask.draft-ask')].find((c) => c.textContent.includes('To ada@fernwood.example'))`;
const center = (el) => `(() => { const e = ${el}; if (!e) return false; e.scrollIntoView({ block: 'nearest' }); return true; })()`;
const looks = [['day', 390, 844, true], ['day', 1280, 832, false], ['night', 390, 844, true], ['night', 1280, 832, false]];
const steps = [
  { name: 'open', url: `${WEB}?demo#/settings`, settle: 4000 },
  { name: 'install', click: '.install .btn', settle: 3000 },
  { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return' },
  { name: 'attach', attachApp: WEB },
  { name: 'standalone', eval: `matchMedia('(display-mode: standalone)').matches` },
  { name: 'pair', w: 390, h: 844, dpr: 2, mobile: true, url: `${WEB}?day#/pair`, settle: 3000 },
  { name: 'code', run: `${cli} phones code | tail -1`, eval: put('.pair-code', '{{out}}') },
  { name: 'go', wait: `!!${button('.fr', 'Pair')}`, timeout: 20000, eval: `(() => { ${button('.fr', 'Pair')}.click(); return true; })()`, settle: 500 },
  { name: 'words', wait: `!!document.querySelector('.pair-words')`, timeout: 20000 },
  { name: 'approve', run: `${cli} phones approve "$(${cli} phones pending | tail -1 | sed 's/.*: //')"` },
  { name: 'paired', wait: `!document.querySelector('.pair-words') && !document.querySelector('.where')`, timeout: 20000 },
  { name: 'thread', url: `${WEB}?day#/chief`, settle: 3000, wait: `!!${draft}?.querySelector('textarea.draft-edit')`, timeout: 20000 },
  { name: 'own-words', eval: `(() => { const c = ${draft}; const t = c.querySelector('textarea.draft-edit'); t.dataset.card = '1'; return ${put('textarea[data-card]', JSON.stringify(WORDS))}; })()` },
  { name: 'edited', wait: `${draft}.querySelector('.ask-status').textContent.startsWith('Draft')`, eval: center(draft), out: `${EV}/paired/draft-review-day-390.png` },
  { name: 'review', eval: `(() => { [...${draft}.querySelectorAll('button')].find((b) => b.textContent === 'Review one email').click(); return true; })()` },
  { name: 'send-card', wait: `!!${button('.card.ask', 'Send')}`, timeout: 20000 },
];
for (const [look, w, h, mobile] of [...looks.slice(1), looks[0]]) steps.push(
  { name: `send-${look}-${w}`, w, h, dpr: 2, mobile, url: `${WEB}?${look}#/chief`, settle: 3000, wait: `!!${button('.card.ask', 'Send')} && !${button('.card.ask', 'Send')}.disabled`, timeout: 20000 },
  { name: `send-${look}-${w}-shot`, eval: center(`${button('.card.ask', 'Send')}?.closest('.card')`), run: 'sleep 0.5; true', out: `${EV}/paired/send-${look}-${w}.png` });
steps.push({ name: 'rec', record: `${EV}/paired/send-once.webm`, seconds: 30 },
  { name: 'look', run: 'sleep 2; true' },
  { name: 'double-tap', eval: `(() => { const b = ${button('.card.ask', 'Send')}; b.click(); b.click(); return true; })()` },
  { name: 'sent', wait: `[...document.querySelectorAll('.card.answered')].some((e) => /^Sent|Sent$/.test(e.textContent))`, timeout: 20000 },
  { name: 'hold', run: 'sleep 2; true' }, { name: 'rec-end', recwait: true });
for (const [look, w, h, mobile] of looks) steps.push(
  { name: `sent-${look}-${w}`, w, h, dpr: 2, mobile, url: `${WEB}?${look}#/chief`, settle: 3000, wait: `[...document.querySelectorAll('.card.answered')].some((e) => /^Sent|Sent$/.test(e.textContent))`, timeout: 20000 },
  { name: `sent-${look}-${w}-shot`, eval: center(`[...document.querySelectorAll('.card.answered')].find((e) => /^Sent|Sent$/.test(e.textContent))`), run: 'sleep 0.5; true', out: `${EV}/paired/sent-${look}-${w}.png` });
console.log(JSON.stringify({ profile: `${S}/pwa/profile`, home: `${S}/pwa/home`, headless: false, xkey: `${SK}/xkey.py`, recorder: `${SK}/record.mjs`,
  args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps }, null, 1));
