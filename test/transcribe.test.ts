// test/transcribe.test.ts
// The person reads the one thing to do when the computer has no Hex, or no speech model for it: never a code or a stack.
// No Hex, no model and no network here (`CREWHOUSE_HEX` names paths that are not Hex), so CI needs neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe } from '../src/transcribe.ts';

const words = (p: string) => { process.env.CREWHOUSE_HEX = p; return transcribe(new Uint8Array([1, 2, 3])).then(() => '', (e: Error) => e.message); };

test('with no Hex, the person reads the one install command', async () => {
  const said = await words('/nonexistent/hex');
  assert.match(said, /^Speaking needs Hex on your computer first\. On that computer, run: (curl -fsSL \S+ \| sh|brew install --cask \S+)$/);
});

test('with no speech model, the person reads the model command, at the Hex this computer has', async () => {
  const said = await words('/bin/false'); // a binary that is not Hex: it has no model
  assert.equal(said, "Speaking needs Hex's speech model on your computer first. On that computer, run: /bin/false model install parakeet_unified_en");
});

test('one refusal does not stop the next clip from trying again', async () => {
  await words('/nonexistent/hex');
  assert.match(await words('/bin/false'), /speech model/);
});
