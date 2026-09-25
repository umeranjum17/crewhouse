// Teach by showing: the recorder writes down pages, clicks and which field was typed in, by label, and never what was
// typed or anything from a password field. The real-browser test drives a headless Chromium on a local page
// (skipped where there is none); nothing leaves the machine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as http } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { lesson, stepsOf, Teacher } from '../src/teach.ts';

test('steps in the person\'s words: the host and path of a page, labels for the rest, repeats folded', () => {
  assert.deepEqual(stepsOf([
    { kind: 'open', url: 'https://www.news.example/stats/?tab=open&token=abc#top' },
    { kind: 'open', url: 'chrome://newtab/' },
    { kind: 'fill', label: 'Search' }, { kind: 'fill', label: 'Search' },
    { kind: 'click', label: 'Subscribers' },
    { kind: 'choose', label: 'Period' },
    { kind: 'open', url: 'https://news.example/' },
  ]), ['Opened news.example/stats', 'Typed in “Search”', 'Clicked “Subscribers”', 'Chose an option in “Period”', 'Opened news.example']);
  assert.equal(lesson('pull the newsletter stats.', ['Opened news.example/stats', 'Clicked “Subscribers”']),
    'I showed you how to pull the newsletter stats. Here is what I did, step by step:\n1. Opened news.example/stats\n2. Clicked “Subscribers”\n' +
    'Please keep this as one of your skills (ask me with crew_learn, in plain steps), then do it once now so I can see it works.');
});

const browser = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find(existsSync);
test('a real show: what was clicked and which box was typed in, never the words, nothing from a password box', { skip: !browser && 'no Chromium here' }, async () => {
  const page = `<html><body><h1>Stats</h1><label for="n">Your name</label><input id="n"><input type="password" name="password" aria-label="Password">
    <button id="save">Save</button><a href="/next">Subscribers</a></body></html>`;
  const site = http((q, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(q.url === '/next' ? '<p>Subscribers: 12</p>' : page));
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const port = await new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => r(port)); }); });
  const profile = mkdtempSync(join(tmpdir(), 'crewhouse-teach-'));
  const chrome = spawn(browser!, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const teacher = new Teacher();
  // Chrome keeps writing its profile until it has exited: wait for that before removing it.
  after(async () => {
    teacher.stop('reel');
    site.close();
    if (chrome.exitCode === null) await new Promise((r) => { chrome.once('exit', r); chrome.kill(); });
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const until = async (what: string, fn: () => unknown) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`timed out: ${what}`); };
  await until('chromium', () => fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.ok, () => false));
  await teacher.start('reel', 'pull the stats', port, () => {});
  assert.ok(teacher.has('reel'));

  // The person drives: we act in the page as they would, through its own debugging connection.
  const [t] = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((x: any) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let id = 0;
  const call = (method: string, params: object) => new Promise<any>((resolve) => {
    const me = ++id;
    const on = (raw: any) => { const m = JSON.parse(String(raw)); if (m.id === me) { ws.off('message', on); resolve(m.result); } };
    ws.on('message', on);
    ws.send(JSON.stringify({ id: me, method, params }));
  });
  const site_ = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  await call('Page.navigate', { url: `${site_}/stats` });
  await until('the page', async () => (await call('Runtime.evaluate', { expression: 'document.getElementById("save") !== null && window.__crewhouseShow === true', returnByValue: true }))?.result?.value);
  const act = (js: string) => call('Runtime.evaluate', { expression: js });
  await act(`(() => { const n = document.getElementById('n'); n.value = 'Umer secret words'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await act(`(() => { const p = document.querySelector('[type=password]'); p.value = 'hunter2'; p.dispatchEvent(new Event('change', { bubbles: true })); p.click(); })()`);
  await act(`document.getElementById('save').click()`);
  await act(`document.querySelector('a').click()`);
  await until('the next page', () => teacher.showing().reel?.steps >= 5);
  await new Promise((r) => setTimeout(r, 1500)); // one picture per page, taken once it has drawn
  ws.close();

  const out = teacher.stop('reel')!;
  const host = `127.0.0.1`;
  assert.deepEqual(out.steps, [`Opened ${host}/stats`, 'Typed in “Your name”', 'Clicked “Save”', 'Clicked “Subscribers”', `Opened ${host}/next`]);
  assert.doesNotMatch(JSON.stringify(out.steps), /Umer|secret|hunter2|Password/i, 'never what was typed, nothing from the password box');
  assert.ok(out.shots.length >= 1 && out.shots.every((s) => s.type === 'image/jpeg' && s.data.length > 100), 'a picture of the pages');
  assert.equal(teacher.has('reel'), false);
});
