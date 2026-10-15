// Capture the README's pictures, day and night, from the built-in demo (Maya and her crew).
// Serve the app first (a stub-engine crewd, as the done-done `stub-drive` journey boots it), then:
//   CHROME_DEVTOOLS_AXI_SESSION=<yours> node scripts/capture-readme.mjs http://127.0.0.1:<port> [name ...]
// Name the scenes to regenerate only those (e.g. `home-phone`); no names captures all.
// The demo's own "You're trying a demo crew" nudge is hidden: it is not part of the app a person runs.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/capture-readme.mjs http://127.0.0.1:<port> [name ...]');
const only = new Set(process.argv.slice(3));
const axi = (...args) => execFileSync('chrome-devtools-axi', args, { stdio: 'pipe' }).toString();
const out = resolve(process.env.CAPTURE_DIR ?? '.readme-capture');
mkdirSync(out, { recursive: true });
mkdirSync('docs/screenshots/readme', { recursive: true });
const desk = '1440x900x1', phone = '390x844x2,mobile,touch';
// A phone thread opens at its newest line; `scroll` starts the shot on a whole message instead of a cut one.
const lines = (js) => `() => { const l = document.querySelector(".lines"); ${js}; return l.scrollTop }`;
const scenes = [
  ['home', 'demo#/', desk], ['home-phone', 'demo#/', phone], ['ask', 'demo=hello#/', phone],
  ['plan', 'demo=live#/', phone, lines('const m = [...l.children].find((e) => e.textContent.includes("great, and can")); l.scrollTop += m.getBoundingClientRect().top - 165')],
  ['answer', 'demo=answer#/', phone, lines('l.scrollTop = 0')],
  ['spend', 'demo=meals#/ask/20', phone], ['files', 'demo#/f/scribe/files%2Fmonthly-budget.xlsx', desk],
];
for (const [name, query, view, scroll] of scenes) {
  if (only.size && !only.has(name)) continue;
  for (const look of ['day', 'night']) {
    axi('emulate', '--viewport', view);
    const [q, hash] = query.split('#');
    axi('open', `${base}/?${q}&${look}#${hash}`);
    const end = Date.now() + 15000;
    while (!axi('eval', '() => !!document.querySelector(".main, .hello") && !document.querySelector(".splash")').includes('true')) {
      if (Date.now() > end) throw new Error(`Screen not ready: ${name}`);
    }
    axi('eval', '() => { const s = document.createElement("style"); s.textContent = ".pair-row{display:none!important}"; document.head.append(s); return true }');
    execFileSync('sleep', ['1']); // let the last layout settle after the nudge goes
    if (scroll) { axi('eval', scroll); execFileSync('sleep', ['0.5']); }
    const png = `${out}/${name}-${look}.png`;
    axi('screenshot', png);
    execFileSync('magick', [png, '-quality', '82', resolve(`docs/screenshots/readme/${name}-${look}.webp`)]);
    console.log(name, look);
  }
}
