// test/transcribe.test.ts
// The person reads the one thing to do when the computer has no Hex, or no speech model for it: never a code or a stack.
// No Hex, no model and no network here (`CREWHOUSE_HEX` names paths that are not Hex), so CI needs neither.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe } from '../src/transcribe.ts';

const words = (p: string) => { process.env.CREWHOUSE_HEX = p; return transcribe(new Uint8Array([1, 2, 3])).then(() => '', (e: Error) => e.message); };

test('with no Hex, the person reads the one install command', async () => {
  const said = await words('/nonexistent/hex');
  assert.match(said, /^Speaking here needs Hex on this computer first\. In a terminal, run: curl -fsSL \S+ \| sh$/);
  assert.doesNotMatch(said, /Error|undefined|at |\{|code/);
});

test('with no speech model, the person reads the model command', async () => {
  const said = await words('/bin/false'); // a binary that is not Hex: its model list is empty
  assert.match(said, /^Hex has no speech model on this computer yet\. In a terminal, run: ~\/\.local\/bin\/hex model install$/);
  assert.doesNotMatch(said, /Error|undefined|at |\{|code/);
});
