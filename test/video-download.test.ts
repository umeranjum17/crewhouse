// The video job. A pasted link: Chief hands it to Video Vic, the person picks the quality on a card before anything downloads,
// and only that pick lands in the helper's files with its link. And a pinned kit tool that fails must say so: the person
// reads what failed and why, and the record never claims the work was done. The stub engine, a fake yt-dlp, no network
// and no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as A from '../web/src/adapter.ts';
import * as disk from '../src/bots.ts';
import { toolBin, toolStatus } from '../src/tools.ts';
import { INFO, SAVER } from './video-saver.ts';
import type { Config } from '../src/config.ts';
import type { StubRuntime } from '../src/stub-runtime.ts';
process.env.CREWHOUSE_HOLD_MS ??= '3000'; // the quality card holds Video Vic's call this long, then the turn parks
const { setup, settled, task, delegated, until } = await import('./lab.ts');

const FAKE = `#!/bin/sh
echo "[youtube] Extracting URL: https://www.youtube.com/watch?v=abc123"
echo "ERROR: [youtube] abc123: Unable to extract player response" >&2
echo "ERROR: Requested format is not available" >&2
exit 1
`;

/** The kit as a pinned install leaves it: the copy in the tool's own folder, linked into the kit's bin, and the pin that
 *  says which copy this is. The pin here is the older release, so the kit's own pin is the newer one. */
function installFake(cfg: Config, version: string, script = FAKE) {
  const dir = join(cfg.toolsDir, 'video-download');
  mkdirSync(dir, { recursive: true });
  mkdirSync(toolBin(cfg), { recursive: true });
  writeFileSync(join(dir, 'yt-dlp'), script, { mode: 0o755 });
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

const LINK = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

test('a pasted video link: Chief hands it to Video Vic, the person picks the quality first, and only that is saved with its link', async () => {
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  const { cfg, db, crew, done } = setup();
  try {
    crew.onboard('Umer');
    const vic = crew.recruit('reel', undefined, 'person');
    installFake(cfg, '2026.10.10.233141', SAVER);
    writeFileSync(join(cfg.toolsDir, 'video-download', 'info.json'), JSON.stringify(INFO));
    const files = join(disk.botDir(cfg, vic.id), 'files'), saved = () => existsSync(files) ? readdirSync(files).filter((f) => !f.startsWith('.')) : [];

    const asked = (await crew.post('chief', `Save this video for me: ${LINK}`))!.task;
    await until('the quality card', () => db.get("SELECT 1 FROM asks WHERE kind = 'video' AND state = 'open'"));
    const row = db.get("SELECT * FROM asks WHERE kind = 'video'")!, job = task(db, row.task_id);
    assert.equal(row.bot, 'chief', 'the card is Chief’s: only Chief asks the person');
    assert.equal(job.bot, vic.id, 'the job went to Video Vic');
    assert.equal(job.parent, asked, 'handed on from Chief’s own job');
    assert.deepEqual(saved(), [], 'nothing downloads before the person picks');

    // The card the app draws: the video's own title, where it is from, three qualities at 1080p or under and the sound
    // alone, each with yt-dlp's size (the 480p one worked out from its bit rate), and no format id or link in sight.
    const view = crew.snapshot().asks.find((a: any) => a.id === row.id)!, card = A.card(view, crew.snapshot());
    assert.equal(card.kind, 'video');
    assert.equal(card.head, 'Save “Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film”');
    assert.equal(card.video!.from, 'youtube.com');
    assert.deepEqual(card.video!.choices.map((c) => `${c.label} ${c.size}`), ['1080p about 160 MB', '720p about 80 MB', '480p about 46 MB', 'Audio only about 10 MB']);
    assert.doesNotMatch(JSON.stringify(view.detail), /format|watch\?v=|137\+140/, 'the app never sees format ids or the raw link');

    await assert.rejects(() => crew.answer(row.id, { answer: 'allow', pick: '4k' }), /pick one of the choices/);
    await crew.answer(row.id, { answer: 'allow', pick: '720p' });
    await until('Video Vic’s job done', () => task(db, job.id).state === 'done');

    // The pick, and only the pick: 720p's mp4 with the matching sound, delivered with the link it came from.
    assert.deepEqual(saved(), ['big-buck-bunny-60fps-4k.mp4']);
    assert.equal(readFileSync(join(files, saved()[0]), 'utf8'), 'video 136+140');
    const delivered = JSON.parse(db.get("SELECT data FROM events WHERE kind = 'file.delivered'")!.data);
    assert.match(delivered.note, /in 720p, from https:\/\/www\.youtube\.com\/watch\?v=aqz-KE-bpKQ$/);
    assert.equal(db.get("SELECT answer FROM asks WHERE id = ?", row.id)!.answer, '720p', 'the answered card names the pick');
    await settled(db, asked);
    assert.equal(task(db, asked).state, 'done');
    assert.equal(db.get("SELECT text FROM messages WHERE bot = 'chief' AND author = 'bot' AND task_id = ?", asked)?.text, "It's saved in the quality you picked. It came from https://www.youtube.com/watch?v=aqz-KE-bpKQ", 'Chief answers from Video Vic’s report');
  } finally { delete process.env.CREWHOUSE_STUB_GOLDEN; done(); }
});

test('a pick that comes after the turn parked still saves it: the job picks up again on its own and nothing is asked twice', async () => {
  process.env.CREWHOUSE_STUB_GOLDEN = '1';
  const { cfg, db, crew, done } = setup();
  try {
    crew.onboard('Umer');
    const vic = crew.recruit('reel', undefined, 'person');
    installFake(cfg, '2026.10.10.233141', SAVER);
    writeFileSync(join(cfg.toolsDir, 'video-download', 'info.json'), JSON.stringify(INFO));
    await crew.post('chief', `Save this video for me: ${LINK}`);
    await until('the quality card', () => db.get("SELECT 1 FROM asks WHERE kind = 'video' AND state = 'open'"));
    const row = db.get("SELECT * FROM asks WHERE kind = 'video'")!;
    // Nobody answered in time: the hand-off's turn ends, and the job waits on the person with no run behind it.
    await until('the turn parked', () => !crew.sessionOf(vic.id), 15_000);
    assert.equal(task(db, row.task_id).state, 'needs_you');
    await crew.answer(row.id, { answer: 'allow', pick: 'audio' });
    await until('Video Vic’s job done', () => task(db, row.task_id).state === 'done');
    assert.equal(readFileSync(join(disk.botDir(cfg, vic.id), 'files', 'big-buck-bunny-60fps-4k.m4a'), 'utf8'), 'video 140', 'the sound alone, as picked');
    assert.equal(db.all("SELECT 1 FROM asks WHERE kind = 'video'").length, 1, 'the resumed call found the answered card, so nothing was asked twice');
  } finally { delete process.env.CREWHOUSE_STUB_GOLDEN; done(); }
});
