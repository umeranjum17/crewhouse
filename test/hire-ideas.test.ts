// Offer-to-hire rows on a Chief-only Home (E6): unhired templates offer up to 3
// goal rows needing nothing, tagged with the template to hire, inside the six-row cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { setup } = await import('./lab.ts');

test('Chief alone offers up to 3 goal rows, each naming the template to hire', () => {
  const { crew, done } = setup();
  const ideas: any[] = crew.snapshot().ideas;
  assert.ok(ideas.length >= 1 && ideas.length <= 3, `1-3 hire rows, got ${ideas.length}`);
  for (const i of ideas) {
    assert.ok(typeof i.hire === 'string' && i.hire, 'each row names its template');
    assert.equal(i.group, 'goal', 'goal rows first');
    assert.deepEqual(i.needs, [], 'only rows needing nothing are offered');
    assert.equal(i.bot, i.hire, 'the row belongs to the template it offers');
  }
  done();
});

test('hiring a helper turns its offer into its own row; the cap still holds', () => {
  const { crew, cfg, done } = setup();
  crew.recruit('scout', 'Scout', 'person');
  // Two hired rows, so the unhired templates' offers share the cap.
  const file = join(cfg.crewDir, 'bots', 'scout', 'bot.json');
  const goal = JSON.parse(readFileSync(file, 'utf8')).ideas.find((i: any) => i.group === 'goal');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')),
    ideas: [goal, { needs: [], promise: 'Hired scout row.', ask: 'hired row ' }] }, null, 2));
  const ideas: any[] = crew.snapshot().ideas;
  assert.equal(ideas.find((i: any) => i.bot === 'scout' && /good at/.test(i.promise))?.hire, undefined, 'no offer left for a hired template');
  assert.equal(ideas.filter((i: any) => i.hire).length, 3, 'other templates still offer');
  assert.ok(ideas.filter((i: any) => !i.needs.length).length <= 6, 'hire rows count toward the six-row cap');
  done();
});
