// React runs a component's hooks in the same order every render. A hook after an early `return` is skipped on the render
// that returns early: "Rendered more hooks than during the previous render" crashed the phone when Add opened the new
// helper's page before refreshed state had it. No eslint here, so this reads each component for the shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `file:line` of every hook call at a function's own indent that follows an early return in that function. */
export function lateHooks(file: string, source: string) {
  const found: string[] = [];
  let early = 0;
  source.split('\n').forEach((line, i) => {
    if (/^(export )?(async )?function /.test(line)) early = 0;
    else if (/^  if \(.*\) return\b/.test(line)) early = early || i + 1;
    else if (early && /^  (const .* = )?use[A-Z]\w*\(/.test(line)) found.push(`${file}:${i + 1}`);
  });
  return found;
}

test('the phone screens call every hook before any early return', () => {
  const files = ['mobile/App.tsx', ...readdirSync('mobile/src').filter((n) => n.endsWith('.tsx')).map((n) => join('mobile/src', n))];
  assert.deepEqual(files.flatMap((f) => lateHooks(f, readFileSync(f, 'utf8'))), []);
  const crashed = 'function HelperPage() {\n  const h = find();\n  if (!h) return null;\n  const { width } = useWindowDimensions();\n}';
  assert.deepEqual(lateHooks('x.tsx', crashed), ['x.tsx:4'], 'the check sees the shape that crashed');
});
