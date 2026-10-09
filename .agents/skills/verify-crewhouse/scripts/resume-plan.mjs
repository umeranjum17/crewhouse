// Plan for pwa-shell.mjs proving the installed app's cold relaunch returns to the last place (features/pwa-resume.md):
//   node resume-plan.mjs <WEB origin> <evidence dir> <lab dir> > plan.json
// Serves the built shell on a *.localhost origin (serve-web.mjs), installs it for real, then drives: open a thread,
// cold-launch back to it (day/night), a named link wins, a gone thread falls back to Home, 320 px, 1.3x text, offline.
import { dirname, resolve } from 'node:path';
const [WEB, EV, LAB] = process.argv.slice(2).map((p) => (p.endsWith('/') ? p : p));
const S = dirname(new URL(import.meta.url).pathname);
const phone = { w: 390, h: 844, dpr: 2, mobile: true };
const steps = [
  { name: 'open', url: WEB + '#/settings', settle: 4000 },
  { name: 'install', click: '.install .btn', settle: 3000 },
  { name: 'sheet', xshot: `${EV}/shots/install-sheet.png` },
  { name: 'tab', key: 'Tab' }, { name: 'return', key: 'Return' },
  { name: 'window', xshot: `${EV}/shots/installed-window.png` },
  { name: 'attach', attachApp: WEB },
  { name: 'standalone', eval: `matchMedia('(display-mode: standalone)').matches` },
  { name: 'set-thread', ...phone, eval: `location.hash = '#/h/scout'` },
  { name: 'thread-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'thread-shot', eval: `[location.hash, !!document.querySelector('.page.helper')]`, out: `${EV}/shots/1-thread-open-390.png` },
  { name: 'cold-day', url: WEB + '?day', settle: 2500 },
  { name: 'cold-day-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'cold-day-shot', eval: `[location.hash, !!document.querySelector('.page.helper')]`, out: `${EV}/shots/2-relaunch-thread-day-390.png` },
  { name: 'cold-night', url: WEB + '?night', settle: 2500 },
  { name: 'cold-night-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'cold-night-shot', eval: `[location.hash, !!document.querySelector('.page.helper')]`, out: `${EV}/shots/3-relaunch-thread-night-390.png` },
  { name: 'named', url: WEB + '?day#/things', settle: 2500 },
  { name: 'named-wait', wait: `location.hash === '#/things'`, timeout: 20000 },
  { name: 'named-shot', eval: `location.hash`, out: `${EV}/shots/4-named-link-wins-390.png` },
  { name: 'seed-gone', eval: `localStorage.setItem('crewhouse.place.demo', '#/h/vanished')` },
  { name: 'gone-cold', url: WEB + '?day', settle: 2500 },
  { name: 'gone-wait', wait: `location.hash === '#/'`, timeout: 20000 },
  { name: 'gone-shot', eval: `[location.hash, !!document.querySelector('.page.mute')]`, out: `${EV}/shots/5-gone-falls-home-390.png` },
  { name: 'reopen', eval: `location.hash = '#/h/scout'` },
  { name: 'reopen-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'narrow', w: 320, h: 720, dpr: 2, mobile: true, url: WEB + '?day', settle: 2500 },
  { name: 'narrow-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'narrow-shot', eval: `[location.hash, document.documentElement.scrollWidth <= innerWidth]`, out: `${EV}/shots/6-relaunch-thread-320.png` },
  { name: 'big-text', ...phone, url: WEB + '?night', settle: 2500 },
  { name: 'big-text-wait', wait: `!!document.querySelector('.page.helper')`, timeout: 20000 },
  { name: 'big-text-scale', eval: `(() => { const els = [...document.querySelectorAll('*')]; const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i) => { if (sizes[i]) e.style.fontSize = (sizes[i] * 1.3).toFixed(2) + 'px'; }); return sizes.length; })()` },
  { name: 'big-text-shot', run: 'sleep 1; true', eval: `[location.hash, document.documentElement.scrollWidth <= innerWidth]`, out: `${EV}/shots/7-relaunch-thread-130pct-390.png` },
  { name: 'offline', offline: true, url: WEB + '?day', settle: 3500 },
  { name: 'offline-wait', wait: `!!document.querySelector('.shell, .splash, .offline')`, timeout: 20000 },
  { name: 'offline-shot', eval: `[location.hash, !navigator.onLine, !!document.querySelector('.page.helper')]`, out: `${EV}/shots/8-offline-shell-390.png` },
  { name: 'online', offline: false },
];
console.log(JSON.stringify({ profile: `${resolve(LAB)}/profile`, home: `${resolve(LAB)}/home`, headless: false, xkey: `${S}/xkey.py`, recorder: `${S}/record.mjs`,
  args: ['--window-size=1400,950', '--force-device-scale-factor=1', 'about:blank'], steps }, null, 1));
