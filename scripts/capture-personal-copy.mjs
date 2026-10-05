// Capture the README's demo screens with Umer as the person. Serve web/dist first.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const base = process.argv[2];
if (!base) throw new Error('Usage: node scripts/capture-personal-copy.mjs http://127.0.0.1:<port>');
const env = { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'ch-personal-copy' };
const axi = (...args) => execFileSync('chrome-devtools-axi', args, { env, stdio: 'pipe' }).toString();
const scenes = [
  ['home-day', 'demo&day', 1440, 1000], ['home-night', 'demo&night', 1440, 1000],
  ['hello', 'demo=hello&day', 900, 900], ['signin', 'demo=first&day#/chief', 390, 844],
  ['phone-day', 'demo&day', 390, 844], ['phone-night', 'demo&night', 390, 844],
  ['draft', 'demo=chase&day#/ask/17', 390, 844], ['order', 'demo=meals&day#/ask/20', 390, 844],
  ['routine', 'demo&day#/chief', 390, 844], ['routines', 'demo&day#/routines', 390, 844],
  ['crew', 'demo&day#/crew', 900, 900], ['workbook', 'demo&day#/f/scribe/files%2Fmonthly-budget.xlsx', 1440, 900],
];
for (const [name, query, w, h] of scenes) {
  axi('resize', String(w), String(h));
  axi('open', `${base}/?${query}`);
  const end = Date.now() + 15000;
  while (!axi('eval', '() => !!document.querySelector(".main, .hello") && !document.querySelector(".splash")').includes('true')) {
    if (Date.now() > end) throw new Error(`Screen not ready: ${name}`);
  }
  const png = resolve(`.personal-copy/${name}.png`);
  axi('screenshot', png);
  execFileSync('magick', [png, '-quality', '85', resolve(`docs/screenshots/readme/${name}.webp`)]);
  console.log(name);
}
