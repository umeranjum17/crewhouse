#!/usr/bin/env node
// Holds the isolated crewd event loop synchronously while a real Android app is paired and watching a running Scout job.
// The kernel's accept queue and the phone's automatic recovery are captured from that same run.
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import * as A from '../../web/src/adapter.ts';

const LAB = process.env.LAB, SERIAL = process.env.SERIAL, OUT = process.env.OUT;
if (!LAB || !SERIAL || !OUT) throw new Error('set LAB, SERIAL and OUT for the owned lab and emulator');
const env = Object.fromEntries(readFileSync(join(LAB, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const person = readFileSync(join(LAB, 'state', 'person.key'), 'utf8').trim();
const adb = (...args) => execFileSync('adb', ['-P', process.env.ADB_SERVER_PORT, '-s', SERIAL, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
const connect = () => new Promise((resolve, reject) => { const socket = net.createConnection(port, '127.0.0.1'); socket.once('connect', () => resolve(socket)); socket.once('error', reject); });
const api = async (method, path, body) => {
  const r = await fetch(`${env.B}${path}`, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${person}` }, body: body && JSON.stringify(body) });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status}`);
  return result;
};
const nodes = () => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('shell', 'cat', '/sdcard/ui.xml');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => ({
    text: (n.match(/ text="([^"]*)"/) || [])[1] || '',
    desc: (n.match(/content-desc="([^"]*)"/) || [])[1] || '',
    b: (n.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || []).slice(1).map(Number),
  }));
};
const find = (re) => nodes().find((n) => re.test(n.text) || re.test(n.desc));
const until = async (label, check, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`timed out waiting for ${label}`);
};
const tap = (re) => { const n = find(re); if (!n) throw new Error(`phone has no ${re}`); adb('shell', 'input', 'tap', String((n.b[0] + n.b[2]) >> 1), String((n.b[1] + n.b[3]) >> 1)); };
const shot = (name) => writeFileSync(join(OUT, name), execFileSync('adb', ['-P', process.env.ADB_SERVER_PORT, '-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }));
const textOnPhone = (re) => nodes().some((n) => re.test(n.text) || re.test(n.desc));

await api('POST', '/api/onboard', { address: 'Umer' }).catch(() => {});
await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
await api('POST', '/api/bots/scout/messages', { text: 'Scout, ask permission before checking the file.' });
await until('Scout working', async () => A.office(await api('GET', '/api/state')).crew.some((c) => c.id === 'scout' && c.seat === 'working'));
await until('phone Home', () => find(/^Search your chats$/) || find(/^Home$/));
if (!find(/^Search your chats$/) && find(/^Home$/)) tap(/^Home$/);
await until('phone chat list', () => find(/^Search your chats$/));
const log = readFileSync(join(LAB, 'crewd.log'), 'utf8');
const inspector = log.match(/Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0]?.replace('Debugger listening on ', '');
if (!inspector) throw new Error('the owned crewd did not start its loopback inspector');
const port = Number(env.LINK_PORT);
const stallMs = 85_000;
for (const [theme, night] of [['light', 'no'], ['dark', 'yes']]) {
  adb('shell', 'cmd', 'uimode', 'night', night);
  await until('Scout visible as working', () => textOnPhone(/Scout is working/));
  if (textOnPhone(/Can't reach the home computer/i)) throw new Error(`phone started out offline in ${theme} mode`);
  shot(`phone-${theme}-before-stall.png`);
  const ws = new WebSocket(inspector);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  const evaluate = (expression) => new Promise((resolve, reject) => { const call = ++id; pending.set(call, { resolve, reject }); ws.send(JSON.stringify({ id: call, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  const held = evaluate(`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${stallMs}); 'event loop resumed'`);
  const clients = await Promise.all([connect(), connect()]);
  const started = Date.now();
  let queue = 0, queueLine = '';
  while (Date.now() - started < stallMs - 1000) {
    queueLine = execFileSync('ss', ['-ltn', 'sport', '=', `:${port}`], { encoding: 'utf8' });
    const row = queueLine.split('\n').find((line) => line.includes(`:${port}`) && line.startsWith('LISTEN'));
    queue = Number(row?.trim().split(/\s+/)[1] ?? 0);
    if (queue > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  writeFileSync(join(OUT, `accept-queue-${theme}.txt`), `link port ${port}\n${queueLine}`);
  if (!queue) throw new Error(`the event-loop stall did not produce a non-empty TCP accept queue in ${theme} mode`);
  await until('phone has been offline for twenty seconds', () => Date.now() - started >= 20_000, 25_000);
  if (textOnPhone(/Can't reach the home computer/i)) throw new Error(`short-stall grace showed the phone banner in ${theme} mode`);
  if (!textOnPhone(/Scout is working/)) throw new Error(`the running Scout job disappeared during the ${theme} reconnect`);
  shot(`phone-${theme}-during-stall.png`);
  const resumed = await held;
  if (resumed?.result?.value !== 'event loop resumed') throw new Error(`the ${theme} event-loop stall did not finish cleanly`);
  const recovered = await connect();
  for (const socket of [...clients, recovered]) socket.destroy();
  writeFileSync(join(OUT, `link-resumed-${theme}.txt`), 'event loop resumed; a new link TCP connection succeeded');
  await until('phone reconnect toast', () => textOnPhone(/Back in touch with the home computer/), 15_000);
  if (textOnPhone(/Can't reach the home computer/i)) throw new Error(`phone retained the cannot-reach banner after ${theme} recovery`);
  if (!textOnPhone(/Scout is working/)) throw new Error(`Scout work was not visible after ${theme} recovery`);
  await until('phone reconnect toast clears', () => !textOnPhone(/Back in touch with the home computer/), 15_000);
  shot(`phone-${theme}-after-reconnect.png`);
  ws.close();
  console.log(`${theme}: ${stallMs}ms event-loop stall; accept queue reached ${queue}; phone automatically reconnected with Scout at work`);
}
