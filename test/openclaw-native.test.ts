// The proof harness boots new OpenClawRuntime: run in CI's serial gateway lane, never beside another gateway boot.
// A real HTTP/person journey through Crewhouse, the pinned Gateway and its scripted local provider; no account/network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temp } from './tmp.ts';
import { until } from './lab.ts';

test('Chief delegates natively, the helper keeps its grants, and the native result reaches both chats once', { timeout: 280_000 }, async () => {
  const root = temp('native'), ready = join(root, 'ready.json');
  const child = spawn(process.execPath, ['scripts/verify/native-delegation.ts', root, ready, '--scripted'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let output = '';
  const retain = (chunk: Buffer) => { output += chunk; if (process.env.CREWHOUSE_NATIVE_LOG) appendFileSync(process.env.CREWHOUSE_NATIVE_LOG, chunk); };
  child.stdout.on('data', retain); child.stderr.on('data', retain);
  const closed = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {
    await until('isolated native household ready', () => { if (child.exitCode !== null) throw Error(output); return existsSync(ready); }, 240_000);
    const { base, authorityFile, crewDir, helper: helperId } = JSON.parse(readFileSync(ready, 'utf8'));
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${readFileSync(authorityFile, 'utf8')}`, 'x-crewhouse': '1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
    };
    const { task } = await api('POST', '/api/bots/chief/messages', { text: 'Ask Research Rae to read the facts file and bring back its reference.' });
    let chief: any, helper: any;
    await until('Chief receives native helper report', async () => { chief = await api('GET', '/api/bots/chief'); return chief.tasks.some((t: any) => t.id === task && !['queued', 'working'].includes(t.state)); }, 90_000);
    helper = await api('GET', `/api/bots/${helperId}`);
    assert.equal(chief.tasks.find((t: any) => t.id === task).state, 'done', JSON.stringify(chief.tasks));
    assert.equal(helper.tasks.length, 1, 'the refused arbitrary target must not create another helper job');
    assert.equal(helper.tasks[0].state, 'done', JSON.stringify(helper.tasks));
    assert.equal(helper.messages.filter((m: any) => m.author === 'bot' && m.text.includes('BLUE-42')).length, 1);
    assert.equal(chief.messages.filter((m: any) => m.author === 'bot' && m.text.includes('BLUE-42')).length, 1, 'no homemade completion relay duplicates the native result');
    assert.equal((await api('GET', '/api/profile')).text, '', 'the helper cannot change Chief’s person profile');
    const events = await api('GET', '/api/events'), native = events.filter((e: any) => e.kind === 'run.delegated');
    assert.equal(native.length, 1); assert.equal(native[0].bot, helperId);
    assert.ok(!events.some((e: any) => e.kind === 'room.wrap'));
    assert.equal(events.filter((e: any) => e.kind === 'run.call' && e.data.tool === 'crew_read').length, 1);
    const next = await api('POST', '/api/bots/chief/messages', { text: 'Ask Research Rae to read the file again: uncertain proof.' });
    await until('an unconfirmed native result stays unsure', async () => { chief = await api('GET', '/api/bots/chief'); return chief.tasks.some((t: any) => t.id === next.task && !['queued', 'working'].includes(t.state)); }, 90_000);
    assert.equal(chief.tasks.find((t: any) => t.id === next.task).state, 'unsure', JSON.stringify(chief.tasks));
    const again = await api('GET', `/api/bots/${helperId}`);
    assert.equal(again.tasks.find((t: any) => t.id !== helper.tasks[0].id).state, 'unsure', JSON.stringify(again.tasks));
    // A Crewhouse-authored refusal stays specific; arbitrary engine diagnostics stay out of the person's chat.
    writeFileSync(join(crewDir, 'bots', helperId, 'AGENTS.md'), 'Instructions. '.repeat(1000));
    const tooLong = await api('POST', '/api/bots/chief/messages', { text: 'Ask Research Rae to read the facts file once more.' });
    await until('the overlong helper refusal reaches Chief', async () => { chief = await api('GET', '/api/bots/chief'); return chief.tasks.some((t: any) => t.id === tooLong.task && t.state === 'failed'); }, 90_000);
    assert.match(chief.tasks.find((t: any) => t.id === tooLong.task).result, /instructions and notes are too long.*Shorten them/);
    assert.equal((await api('GET', `/api/bots/${helperId}`)).tasks.length, 2, 'a refused setup never starts another helper job');
  } catch (error) { console.error(`Native household output:\n${output}`); throw error; }
  finally {
    child.kill('SIGTERM');
    await until('native household stopped', () => child.exitCode !== null || child.signalCode !== null, 30_000);
    assert.equal(await closed, 0, output.slice(-6000));
  }
});
