// The proof harness boots new OpenClawRuntime: run in CI's serial gateway lane, never beside another gateway boot.
// Chief's spawned lookup is still running when crewd is killed. The next boot must not replay it or admit it again,
// must say the job is unsure, and must still admit a fresh lookup. Real Gateway, scripted local provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

test('crewd killed under a spawned lookup: the job is unsure, nothing replays, a fresh lookup is admitted', { timeout: 285_000 }, async () => {
  const root = temp('native-restart'), ready = join(root, 'ready.json');
  let output = '', lab!: ChildProcess;
  const boot = () => {
    lab = spawn(process.execPath, ['scripts/verify/native-delegation.ts', root, ready, '--scripted'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    lab.stdout!.on('data', (c) => { output += c; }); lab.stderr!.on('data', (c) => { output += c; });
    return until('native household ready', () => { if (lab.exitCode !== null) throw Error(output); return existsSync(ready); }, 150_000).then(() => JSON.parse(readFileSync(ready, 'utf8')));
  };
  try {
    let lived = await boot();
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(lived.base + path, { method, headers: { authorization: `Bearer ${readFileSync(lived.authorityFile, 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
    };
    const { task } = await api('POST', '/api/bots/chief/messages', { text: '[legwork-hold] Look up one thing slowly.' });
    await until('the lookup is admitted and reading', async () => (await api('GET', '/api/events')).some((e: any) => e.data.task === task && e.kind === 'run.tool' && /example\.invalid/.test(e.data.words)), 120_000);
    const first = lab; process.kill(lived.pid, 'SIGKILL'); await new Promise((r) => first.once('exit', r));
    rmSync(ready); lived = await boot();
    await until('the recovered job is flagged', async () => (await api('GET', '/api/bots/chief')).tasks.some((t: any) => t.id === task && t.state === 'unsure'), 30_000);
    const page = await api('GET', '/api/bots/chief'), events = (await api('GET', '/api/events')).filter((e: any) => e.data.task === task);
    assert.match(page.tasks.find((t: any) => t.id === task).result, /restarted during a hand-off/);
    assert.equal(events.filter((e: any) => e.kind === 'run.delegated').length, 1, 'the lookup is not admitted a second time');
    assert.ok(!events.some((e: any) => e.kind === 'run.resumed'), 'a spawned job is never replayed');
    // After the restart Chief's own legwork is guarded: five spawn attempts, three admitted (an extra key and another agent are refused), the web only.
    const next = await api('POST', '/api/bots/chief/messages', { text: '[legwork] Look up alpha, beta and gamma.' });
    let chief: any;
    await until('a fresh lookup job is answered', async () => { chief = await api('GET', '/api/bots/chief'); return chief.tasks.some((t: any) => t.id === next.task && !['queued', 'working'].includes(t.state)); }, 100_000);
    assert.equal(chief.tasks.find((t: any) => t.id === next.task).state, 'done', JSON.stringify(chief.tasks));
    assert.deepEqual(chief.messages.filter((m: any) => m.author === 'bot' && m.text.includes('Legwork is in')).map((m: any) => m.text), ['Legwork is in: alpha, beta, gamma.']);
    const trail = (await api('GET', '/api/events')).filter((e: any) => e.data.task === next.task);
    assert.equal(trail.filter((e: any) => e.kind === 'run.delegated' && e.bot === 'chief').length, 3, 'only the three valid spawns are admitted');
    assert.equal(trail.filter((e: any) => e.kind === 'run.tool' && /example\.invalid/.test(e.data.words)).length, 3, 'each lookup’s web read passes Crewhouse’s gate');
    assert.equal((await api('GET', '/api/profile')).text, '', 'a lookup cannot change the person profile');
  } catch (error) { console.error(`Native restart output:\n${output}`); throw error; }
  finally {
    lab.kill('SIGTERM');
    await until('native household stopped', () => lab.exitCode !== null || lab.signalCode !== null, 30_000);
  }
  const seen = readFileSync(`${ready}.delegated.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(seen.filter((e) => e.type === 'admitted').length, 4, 'the held lookup, then three fresh ones: nothing is admitted twice');
  assert.equal(seen.filter((e) => e.type === 'ended' && e.reason === 'terminal').length, 3, 'each fresh lookup ended once, through the kit');
  assert.ok(!JSON.parse(readFileSync(`${ready}.provider.json`, 'utf8')).some((c: any) => JSON.stringify(c.body.messages).includes('item=held')), 'the held lookup was never asked of the model again');
});
