#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
const [success, failed] = process.argv.slice(2);
if (!success || !failed) throw new Error('usage: wait-link-stall.mjs <success-file> <failed-file>');
const end = Date.now() + 120_000;
while (Date.now() < end) {
  if (existsSync(failed)) throw new Error(readFileSync(failed, 'utf8'));
  if (existsSync(success)) process.exit(0);
  await new Promise((r) => setTimeout(r, 200));
}
throw new Error(`timed out waiting for ${success}`);
