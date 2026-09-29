// The engine port on the kit with the kit's fake Gateway as its transport: no engine, no network, no account.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { fakeGateway, type FakeScript } from '@byokit/openclaw/testing';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import type { RunRef } from '../src/runtime.ts';

export function faked(host: { gate?: (run: RunRef, tool: string) => any; call?: (run: RunRef, tool: string, input: any) => any } = {}, script?: FakeScript) {
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-kit-'));
  const fake = fakeGateway(script);
  const runtime = new OpenClawRuntime(state, '', { transport: fake.factory, spawnEngine: false });
  const seen = { gated: [] as [RunRef, string][], called: [] as [RunRef, string, any][] };
  const started = runtime.start({
    tools: () => [],
    gate: async (run, tool) => { seen.gated.push([run, tool]); return host.gate?.(run, tool) ?? { allow: true }; },
    call: async (run, tool, input) => { seen.called.push([run, tool, input]); return host.call?.(run, tool, input) ?? 'done'; },
  });
  const ask = (frame: object): Promise<any> => new Promise((resolve, reject) => {
    const socket = connect(join(state, 'openclaw', 'bridge.sock'));
    let text = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => { text += chunk; if (text.includes('\n')) { resolve(JSON.parse(text)); socket.end(); } });
    socket.on('connect', () => socket.write(JSON.stringify(frame) + '\n'));
  });
  const done = async () => { await runtime.stop(); rmSync(state, { recursive: true, force: true }); };
  return { state, fake, runtime, seen, started, ask, done };
}
