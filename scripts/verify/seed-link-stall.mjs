#!/usr/bin/env node
// Seed the isolated pair lab with a visible, held Scout job for the phone-link-stall journey.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../../web/src/adapter.ts';
const lab = process.argv[2];
if (!lab) throw new Error('usage: seed-link-stall.mjs <lab>');
const env = Object.fromEntries(readFileSync(join(lab, 'env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
const key = readFileSync(join(lab, 'state', 'person.key'), 'utf8').trim();
const api = async (method, path, body) => {
  const response = await fetch(`${env.B}${path}`, { method, headers: { 'content-type': 'application/json', 'x-crewhouse': '1', authorization: `Bearer ${key}` }, body: body && JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return result;
};
const state = await api('GET', '/api/state');
if (!state.person.onboarded) await api('POST', '/api/onboard', { address: 'Umer' });
if (!state.bots.some((bot) => bot.id === 'scout')) await api('POST', '/api/recruit', { template: 'scout', name: 'Scout' });
await api('POST', '/api/bots/scout/messages', { text: 'Scout, ask permission before checking the file.' });
const end = Date.now() + 30_000;
while (Date.now() < end) {
  const view = A.office(await api('GET', '/api/state'));
  if (view.crew.some((member) => member.id === 'scout' && member.seat === 'working')) {
    console.log('Scout is at work on the isolated pair lab');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
throw new Error('Scout did not reach the working state in 30 seconds');
