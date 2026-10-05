// Measure the graceful close of a task browser (test/browser.ts) under load: the number of rounds and
// the extra CPU spinners are arguments, so the same command shows the harness's own cost under pressure.
//   node scripts/measure-browser-close.mjs [rounds] [spinners]
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadavg, setPriority, tmpdir } from 'node:os';
import { browserBin } from '../src/desktop.ts';
import { taskBrowser } from '../test/browser.ts';

const rounds = Number(process.argv[2] ?? 5);
const spinners = Number(process.argv[3] ?? 0);
const spin = [];
for (let i = 0; i < spinners; i++) {
  const child = spawn(process.execPath, ['-e', 'const t=Date.now();while(Date.now()-t<600000){Math.sqrt(Math.random())}'], { stdio: 'ignore' });
  try { setPriority(child.pid, 19); } catch { undefined; }
  spin.push(child);
}
try {
const bin = browserBin();
if (!bin) throw new Error('no Chromium on PATH');
const until = async (what, fn, ms = 30000) => {
  for (const end = Date.now() + ms;; await new Promise((r) => setTimeout(r, 20))) {
    let ok = false;
    try { ok = !!(await fn()); } catch { ok = false; }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
};
for (let i = 0; i < rounds; i++) {
  const profile = mkdtempSync(join(tmpdir(), 'close-measure-'));
  const browser = taskBrowser(bin, ['--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], profile);
  const portFile = join(profile, 'DevToolsActivePort');
  await until('the browser to listen', () => existsSync(portFile) && readFileSync(portFile, 'utf8').includes('\n'));
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  await until('a page', async () => ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) ).some((t) => t.type === 'page'));
  await new Promise((r) => setTimeout(r, 2000)); // let the process tree settle, as the journeys do
  const began = Date.now();
  await browser.close();
  console.log(`round ${i + 1}: closed in ${Date.now() - began} ms (load ${loadavg()[0].toFixed(1)})`);
  rmSync(profile, { recursive: true, force: true });
}
} finally {
  for (const s of spin) try { s.kill('SIGKILL'); } catch { undefined; }
}
