import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const driver = path.join(root, 'scripts/verify/cloud-unlink.sh');

async function withStub(run: (dir: string, calls: string) => void | Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cloud-unlink-guard-'));
  const calls = path.join(dir, 'adb-calls');
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const stub = path.join(bin, 'adb');
  await writeFile(stub, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ADB_CALLS"\nexit 71\n', { mode: 0o755 });
  await writeFile(calls, '');
  try { await run(dir, calls); } finally { await rm(dir, { recursive: true, force: true }); }
}

function invoke(dir: string, calls: string, serial: string, underLock?: string) {
  return spawnSync('bash', [driver, path.join(dir, 'out'), path.join(dir, 'lab.apk')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      SERIAL: serial,
      ADB_CALLS: calls,
      FM_PHONE_LOCK_DIR: dir,
      ...(underLock === undefined ? {} : { CLOUD_UNLINK_UNDER_LOCK: underLock }),
    },
  });
}

test('physical device without a held lock is refused before adb', async () => {
  await withStub(async (dir, calls) => {
    const result = invoke(dir, calls, 'ABCD1234');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ABCD1234.*physical device.*lock is not held/);
    assert.equal(await readFile(calls, 'utf8'), '');
  });
});

test('lock marker without the held device lock is refused before adb', async () => {
  await withStub(async (dir, calls) => {
    const result = invoke(dir, calls, 'ABCD1234', 'ABCD1234');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /ABCD1234.*physical device.*lock is not held/);
    assert.equal(await readFile(calls, 'utf8'), '');
  });
});

test('emulator serial passes the physical-device guard', async () => {
  await withStub(async (dir, calls) => {
    const result = invoke(dir, calls, 'emulator-5554');
    assert.doesNotMatch(result.stderr, /physical device.*lock is not held/);
    assert.notEqual((await readFile(calls, 'utf8')).length, 0);
  });
});
