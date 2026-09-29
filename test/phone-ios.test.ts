// The iPhone's ways in: its shortcuts and controls open crewhouse://ask, and the share sheet reaches ShareIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askOf } from '../mobile/src/ask.ts';

const root = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const crew = [{ id: 'scribe', template: 'scribe' }, { id: 'reel-2', template: 'reel' }, { id: 'pip', template: 'helper' }];

test('an ask from a shortcut fills the helper from that template, or Chief, and never sends', () => {
  assert.deepEqual(askOf('crewhouse://ask?to=scribe&text=turn%20this%20into%20posts', crew), { chat: 'scribe', text: 'turn this into posts' });
  assert.deepEqual(askOf('crewhouse://ask?to=reel&text=a%20demo%3A%201%2B1%3D2%20%26%20more', crew), { chat: 'reel-2', text: 'a demo: 1+1=2 & more' }, 'a renamed helper is found by its template');
  assert.deepEqual(askOf('crewhouse://ask?to=reel', []), { chat: 'chief', text: '' }, 'no such helper: Chief');
  assert.deepEqual(askOf('crewhouse://ask', crew), { chat: 'chief', text: '' });
  assert.deepEqual(askOf('crewhouse://ask?to=chief&text=%E0%A4%A', crew), { chat: 'chief', text: '' }, 'broken words are dropped, not thrown');
  assert.equal(askOf('crewhouse://pair?code=x', crew), null);
  assert.equal(askOf('crewhouse://dataUrl=crewhouseShareKey', crew), null, "the share sheet's own opening is not an ask");
});

test("the phone's actions name only helpers the crew can have, and every one opens an ask", () => {
  const dir = join(root, 'mobile/targets/actions');
  const swift = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.swift')).map((f) => readFileSync(join(dir, String(f)), 'utf8')).join('\n');
  const kinds = [...swift.matchAll(/case \w+ = "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['chief', 'scribe', 'reel']);
  for (const k of kinds.slice(1)) assert.ok(readdirSync(join(root, 'templates')).includes(k), `${k} is a helper template`);
  assert.match(swift, /crewhouse:\/\/ask\?to=/);
  assert.doesNotMatch(swift, /URLSession/, 'an action only opens the app; it never sends');
});

test('the share sheet is on for the iPhone too, for what ShareIn takes', () => {
  const share = JSON.parse(read('mobile/app.json')).expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-share-intent')[1];
  assert.equal(share.disableIOS, undefined);
  const rules = share.iosActivationRules;
  assert.equal(rules.NSExtensionActivationSupportsText, true);
  assert.equal(rules.NSExtensionActivationSupportsImageWithMaxCount, 4);
  assert.match(read('mobile/App.tsx'), /image\/'\)\)\.slice\(0, 4\)/, 'ShareIn keeps the same four photos');
  assert.equal(rules.NSExtensionActivationSupportsMovieWithMaxCount, undefined, 'no video: ShareIn sends photos and words only');
});
