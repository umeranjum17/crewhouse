// The demo households keep their "done today" at any hour: the base and hand-off households start at 2 and the
// hand-off lands Reel's video as the 3rd, ?demo=b1 shows only Tracer's list, just after midnight as at noon and late.
// Counted by the app's own homeCounts; the clock is node:test's mock, so nothing waits on the real time of day.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('demo households keep their done-today counts at 00:01, noon and 23:59', async () => {
  const { homeCounts } = await import('../web/src/adapter.ts');
  for (const [h, m] of [[0, 1], [12, 0], [23, 59]]) for (const v of ['umer', 'handoff', 'b1']) {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 9, 3, h, m).getTime() });
    (globalThis as { location?: unknown }).location = { search: `?demo=${v}` };
    try {
      const d = await import(`../web/src/demo.ts?${v}-${h}-${m}`);
      const done = async () => homeCounts(await d.demoCall('GET', '/api/state')).done;
      assert.equal(await done(), v === 'b1' ? 1 : 2, `${v} at ${h}:${m}`);
      if (v === 'handoff') { d.demoLive(() => {}); mock.timers.tick(4000); assert.equal(await done(), 3, `handoff +1 at ${h}:${m}`); }
    } finally { mock.timers.reset(); }
  }
});
