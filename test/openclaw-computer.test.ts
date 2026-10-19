// A bot's computer is OpenClaw's own: the engine's `computer` tool, through OpenClaw's node host with its bundled
// cua-computer on the bot's private display, every call through Crewhouse's gate. The scripted model fills a form on
// Chief's screen; the Gateway withholds the node host's other commands. CREWHOUSE_RECORD=<file.mp4> films the display.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { removeOnExit } from '../src/config.ts';
import { browserBin, Desktops, missing } from '../src/desktop.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { startModelStub } from './openclaw-stub.ts';

const skip = (missing().some((m) => m.startsWith('Xvfb')) && 'Xvfb is not installed') || (!browserBin() && 'no Chromium here');

test("Chief fills a form on its own screen with the engine's computer tool", { skip, timeout: 600_000 }, async () => {
  const state = removeOnExit(mkdtempSync(join(tmpdir(), 'crewhouse-computer-'))), bot = join(state, 'bots', 'chief');
  mkdirSync(bot, { recursive: true });
  let posted = '';
  const site = createServer((q, r) => {
    let body = '';
    q.on('data', (c) => { body += c; }).on('end', () => {
      if (q.method === 'POST') posted = body;
      r.setHeader('content-type', 'text/html').end(q.method === 'POST' ? '<h1>Thanks, saved.</h1>'
        : '<h1>Library card renewal</h1><form method="post"><label>Name <input name="name" style="font:32px sans-serif;width:90%;height:200px"></label><p><button>Save</button></p></form>');
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => site.once('listening', r));
  const stub = await startModelStub(), desktops = new Desktops(state), runtime = new OpenClawRuntime(state, '', { authSeal: undefined });
  const gated: Record<string, unknown>[] = [];
  let film: ReturnType<typeof spawn> | undefined;
  try {
    const desk = await desktops.ensure('chief', bot);
    // The bot's Chromium shows the form (crewd's own DevTools endpoint; the model never gets it).
    const ws = new WebSocket(desk.cdp!);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: `http://127.0.0.1:${(site.address() as AddressInfo).port}/renew` } }));
    await new Promise((r) => ws.on('message', (m) => { if (JSON.parse(String(m)).id === 1) r(0); }));
    ws.close();
    if (process.env.CREWHOUSE_RECORD) film = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-video_size', '1280x800', '-framerate', '10', '-i', desk.display, '-pix_fmt', 'yuv420p', process.env.CREWHOUSE_RECORD],
      { env: { PATH: process.env.PATH, DISPLAY: desk.display, XAUTHORITY: desk.xauth }, stdio: ['pipe', 'ignore', 'inherit'] });
    await runtime.start({
      tools: () => [],
      gate: async (_run, tool, input) => { gated.push({ tool, ...input }); return tool === 'computer' && input.node === 'crewhouse-chief' ? { allow: true } : { allow: false, reason: 'not this run' }; },
      call: async () => 'unused',
    });
    // The scripted model sees images: the engine offers its computer tool only to a vision model.
    await runtime.kit.patchConfig({ models: { providers: { 'crewhouse-stub': { baseUrl: stub.url, apiKey: 'stub-m1', api: 'openai-completions', models: [{ id: 'test', name: 'Test', reasoning: false, input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }] } } }, agents: { defaults: { model: { primary: 'crewhouse-stub/test' } } } });
    assert.equal(await runtime.computer('chief', { DISPLAY: desk.display, XAUTHORITY: desk.xauth }), 'crewhouse-chief');

    const node = (await runtime.kit.call('node.list', {}) as any).nodes.find((n: any) => n.displayName === 'crewhouse-chief');
    await assert.rejects(runtime.kit.call('node.invoke', { nodeId: node.nodeId, command: 'system.run', params: { command: ['id'] }, idempotencyKey: 'no-shell' } as any), 'the node host never runs a command for anyone');
    const act = (input: object) => `[tool computer ${JSON.stringify({ node: 'crewhouse-chief', ...input })}]`;
    const end = await runtime.run({ key: 'agent:m1:crewhouse:chief:1', bot: 'chief', task: 1, account: 'chatgpt', cwd: bot, builtins: [],
      system: 'You are Chief. Your id in Crewhouse is chief.', message: [act({ action: 'screenshot' }), act({ action: 'left_click', coordinate: [600, 280], frameId: '{frameId}' }),
        act({ action: 'type', text: 'Umer Farooq' }), act({ action: 'key', text: 'Return' }), act({ action: 'screenshot' })].join(' ') }, () => {});
    assert.ok(end.ok, JSON.stringify(end).slice(0, 600));
    assert.deepEqual(gated.map((g) => g.action), ['screenshot', 'left_click', 'type', 'key', 'screenshot'], 'every computer call crossed the gate');
    assert.equal(decodeURIComponent(posted.replace(/\+/g, ' ')), 'name=Umer Farooq', 'the form on its screen was filled and saved');
    const seen = stub.calls.flatMap((c) => c.body.messages ?? []).filter((m: any) => m.role === 'tool' || m.role === 'user').flatMap((m: any) => Array.isArray(m.content) ? m.content : []);
    assert.ok(seen.some((c: any) => c.type === 'image_url'), 'the model saw its screen');
  } finally {
    film?.stdin?.end('q');
    await new Promise((r) => film ? film.once('exit', r) : r(0));
    await runtime.stop(); await desktops.stopAll(); await stub.close(); site.close();
  }
});
