#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const lab = process.argv[2];
if (!lab) throw new Error('usage: pwa-reconnect-event.mjs <lab>');
const env = Object.fromEntries(readFileSync(`${lab}/env`, 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const person = readFileSync(`${lab}/state/person.key`, 'utf8').trim();
const r = await fetch(`${env.B}/api/bots/chief/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${person}` }, body: JSON.stringify({ text: 'phone reconnect proof' }) });
if (!r.ok) throw new Error(`the isolated app rejected the reconnect proof message: HTTP ${r.status}`);
