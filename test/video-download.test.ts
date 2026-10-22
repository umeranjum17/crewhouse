// A pinned kit tool that fails must say so: the person reads what failed and why, and the record never claims the work
// was done. The journey: a helper with the video-download tool runs yt-dlp, the site has moved on, and the copy Crewhouse
// pins is behind the kit's own pin. The stub engine, a fake yt-dlp, no network and no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup, settled, task, delegated } from './lab.ts';
import { toolBin, toolStatus } from '../src/tools.ts';
import type { Config } from '../src/config.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';

const FAKE = `#!/bin/sh
echo "[youtube] Extracting URL: https://www.youtube.com/watch?v=abc123"
echo "ERROR: [youtube] abc123: Unable to extract player response" >&2
echo "ERROR: Requested format is not available" >&2
exit 1
`;

/** The kit as a pinned install leaves it: the copy in the tool's own folder, linked into the kit's bin, and the pin that
 *  says which copy this is. The pin here is the older release, so the kit's own pin is the newer one. */
function installFake(cfg: Config, version: string) {
  const dir = join(cfg.toolsDir, 'video-download');
  mkdirSync(dir, { recursive: true });
  mkdirSync(toolBin(cfg), { recursive: true });
  writeFileSync(join(dir, 'yt-dlp'), FAKE, { mode: 0o755 });
  try { symlinkSync(join(dir, 'yt-dlp'), join(toolBin(cfg), 'yt-dlp')); } catch { /* already linked */ }
  writeFileSync(join(dir, '.pin'), JSON.stringify({ download: { url: `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp`, sha256: '0'.repeat(64) } }));
  chmodSync(join(dir, 'yt-dlp'), 0o755);
}

test('a pinned tool that fails says what failed, and the record never claims the work was done', async () => {
  const { cfg, db, crew, done } = setup();
  crew.onboard('sir');
  crew.recruit('reel', 'Reel', 'person');
  installFake(cfg, '2026.08.19');
  const pinned = toolStatus(cfg).find((t) => t.id === 'video-download')!;
  assert.equal(pinned.ready, true, 'the copy is installed, so the helper may use it');
  assert.equal(pinned.outdated, true, 'the copy on this computer is behind the kit’s own pin');

  const id = delegated(crew, 'reel', '[tool bash {"command": "yt-dlp -f bestvideo+bestaudio https://www.youtube.com/watch?v=abc123 -o clip.mp4"}]').task;
  await settled(db, id);
  assert.equal(task(db, id).state, 'done');

  // What the model read: a clear failure with its cause, and the kit's own words about the copy it pins.
  const said = (crew.runtime as StubRuntime).transcript(task(db, id).session);
  assert.match(said, /^bash: error: yt-dlp failed \(exit 1\): ERROR: Requested format is not available/m, 'the cause comes first, not a silent result');
  assert.match(said, /is Crewhouse's pinned copy/, 'the kit says which copy this is');
  assert.match(said, /a newer copy \(2026\.10\.10\.233141\) than yours \(2026\.08\.19\), and an update brings it in/, 'the kit names the newer pinned copy it holds and the way to it');

  // The record the person reads: the step says the download did not happen, and the call is marked failed.
  const step = db.all("SELECT data FROM events WHERE kind = 'run.tool' AND json_extract(data, '$.task') = ?", id).map((e: any) => JSON.parse(e.data).words as string);
  assert.deepEqual(step, ["Couldn't download a video. yt-dlp is Crewhouse's pinned copy. A changed site is the usual reason a pinned copy stops working; Crewhouse has a newer copy (2026.10.10.233141) than yours (2026.08.19), and an update brings it in."]);
  assert.ok(!step.join(' ').includes('Downloaded a video'), 'the record never claims a video was downloaded');
  const call = db.all("SELECT data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ?", id).map((e: any) => JSON.parse(e.data));
  assert.equal(call.at(-1).ok, false, 'the call is recorded as failed');
  done();
});
