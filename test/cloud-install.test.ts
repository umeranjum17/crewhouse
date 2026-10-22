// The cloud install on a real disk, with the download the person really gets: the app's folder with the
// engine set inside it, shipped read-only. Unpacking that over an earlier install failed with "File
// exists", so the phone's own "Try again" could never work. The recipe's install clears the old tree
// first, so a second run installs exactly like the first one did, and the kit's own folder (this
// phone's key and the receipt) is its sibling and stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recipe } from '../web/src/cloud.ts';
import { temp } from './tmp.ts';

/** The download, shaped like the real one: the app's folder, with a read-only engine set inside it. */
const download = (dir: string) => {
  const app = join(dir, 'stage', 'crewhouse', 'app'), set = join(app, 'runtime', 'openclaw.sets', 'abc');
  mkdirSync(join(set, 'node_modules'), { recursive: true });
  writeFileSync(join(set, '.byokit-tree'), 'engine\n');
  writeFileSync(join(set, 'node_modules', 'engine.js'), 'engine\n');
  writeFileSync(join(app, 'crewhouse'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(join(set, '.byokit-tree'), 0o444);
  chmodSync(join(set, 'node_modules'), 0o555);
  chmodSync(set, 0o555);
  const tgz = join(dir, 'crewhouse-linux-x64.tar.gz');
  execFileSync('tar', ['-czf', tgz, '--owner=0', '--group=0', '-C', join(dir, 'stage'), 'crewhouse']);
  return tgz;
};

/** The recipe's own install steps, run in the work directory the kit runs them in. */
const install = (work: string, tgz: string) => {
  for (const argv of recipe('http://127.0.0.1:7300', { download: `file://${tgz}` }, work).install) {
    execFileSync(argv[0], argv.slice(1), { cwd: work, stdio: 'pipe' });
  }
};

test('the cloud install runs again on a computer that already has Chief', () => {
  const dir = temp('cloud-install'), work = join(dir, 'work');
  mkdirSync(work);
  // The kit's own folder, with what the phone left on the computer: it is a sibling of the app's folder.
  mkdirSync(join(work, '.byokit', 'inbox'), { recursive: true });
  writeFileSync(join(work, '.byokit', 'installed.json'), '{"id":"sbx-1"}');
  const tgz = download(dir);

  install(work, tgz);
  assert.equal(readFileSync(join(work, 'crewhouse', 'app', 'runtime', 'openclaw.sets', 'abc', '.byokit-tree'), 'utf8'), 'engine\n');

  // The second run is the phone's "Try again": the same download over the same computer.
  install(work, tgz);
  assert.equal(readFileSync(join(work, 'crewhouse', 'app', 'runtime', 'openclaw.sets', 'abc', 'node_modules', 'engine.js'), 'utf8'), 'engine\n');
  assert.equal(existsSync(join(work, '.byokit', 'installed.json')), true, 'the kit’s own folder survives the install');

  // The download streams into tar, so a download that fails must still fail the step (not hand tar an empty stream).
  assert.throws(() => install(work, join(dir, 'missing.tar.gz')));
});
