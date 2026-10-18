// The phone's cloud connect (web/src/cloud.ts) on BYOKit's fake boat.dev: a refused key is said in Chief's words and
// never kept; an accepted one lists the person's computer, and Use this computer walks the kit's setup steps to ready
// with this phone's key delivered, no new rental; an install failure stops the list at that row and the retry resumes;
// a throw stops on the row setup was on, or on none before the kit's first step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyPair } from '@byokit/pair';
import { startFakeSandboxServer, memoryStore } from '@byokit/cloud/testing';
import type { SetupStep } from '@byokit/cloud';
import { checkKey, connect, cost, progress, provider, said } from '../web/src/cloud.ts';

const all = async (g: AsyncGenerator<SetupStep>) => { const out: SetupStep[] = []; for await (const s of g) out.push(s); return out; };

test('paste a boat.dev key, pick the computer, and the progress list follows the kit to ready', async () => {
  const server = await startFakeSandboxServer({ key: 'good-key' });
  try {
    const seeded = await provider(async () => 'good-key', server.url).create!({ name: 'old', size: 'small', keepCopies: true, idempotencyKey: 'seed' });
    const store = memoryStore();
    const bad = await checkKey(provider(async () => 'wrong', server.url), store, 'wrong').catch((e) => e);
    assert.equal(said(bad), "boat.dev didn't accept your key. Make a new one and try again.");
    assert.equal(await store.load(), null);

    const p = provider(async () => 'good-key', server.url);
    const listed = await checkKey(p, store, 'good-key');
    assert.deepEqual(listed.map((r) => r.id), [seeded.id]);
    assert.equal((await store.load())!.providerKey, 'good-key');
    assert.equal(cost(), '$0.018/hour · about $13.14 for 730 hours. boat.dev plans start at $20 a month with compute credit included; this computer uses that credit. List price checked 13 Oct.');

    server.machine.script('curl', { code: 1, stdout: '', stderr: 'no route', timedOut: false });
    const phone = keyPair().publicKey;
    const failed = await all(connect(p, store, seeded.id, phone));
    assert.deepEqual(progress(failed), { done: 2, failed: 2, why: 'boat.dev reports a problem with your cloud computer.', retry: true });

    server.machine.script('curl', { code: 0, stdout: '', stderr: '', timedOut: false });
    const steps = await all(connect(p, store, seeded.id, phone));
    assert.deepEqual(steps.map((s) => s.step), ['checking-access', 'listing', 'inspecting', 'installing', 'pairing', 'ready']);
    assert.deepEqual(progress(steps), { done: 5, failed: -1, why: '', retry: false });
    // A throw mid-setup marks the row setup was on; one before the kit's first step marks none. Both offer Try again.
    assert.deepEqual(progress(steps.slice(0, 4), 'lost'), { done: 3, failed: 3, why: 'lost', retry: true });
    assert.deepEqual(progress([], 'lost'), { done: 0, failed: -1, why: 'lost', retry: true });
    assert.deepEqual([...server.machine.files.get('/home/user/crewhouse/.byokit/inbox/phone.bin')!.bytes], [...phone]);
    assert.equal(server.requests.filter((r) => r.method === 'POST' && r.path === '/sandboxes').length, 1, 'only the seeded computer was ever rented');
  } finally { await server.close(); }
});
