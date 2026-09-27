import { createServer, type Server } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunRef, ToolHost } from '../runtime.ts';

/** The Gateway plugin cannot call a tool unless crewd recognizes the exact running task. */
export class ToolBridge {
  private server?: Server;
  private runs = new Map<string, RunRef>();
  private permits = new Map<string, { key: string; tool: string; input: string }>();
  readonly path: string;
  private readonly host: ToolHost;
  constructor(stateDir: string, host: ToolHost) {
    this.path = join(stateDir, 'openclaw/crewd.sock');
    this.host = host;
  }
  register(run: RunRef) { this.runs.set(run.key, run); }
  unregister(key: string) {
    this.runs.delete(key);
    for (const [permit, value] of this.permits) if (value.key === key) this.permits.delete(permit);
  }
  async start() {
    mkdirSync(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) rmSync(this.path);
    this.server = createServer((socket) => {
      let line = '';
      const controller = new AbortController();
      socket.on('close', () => controller.abort());
      socket.on('data', (chunk) => {
        line += chunk;
        if (line.length > 1_000_000) { socket.destroy(); return; }
        const end = line.indexOf('\n');
        if (end < 0) return;
        socket.pause();
        const frame = line.slice(0, end);
        void (async () => {
          try {
            const { kind, key, tool, input, permit } = JSON.parse(frame);
            const run = this.runs.get(key);
            if (!run || typeof tool !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Unknown run or invalid call');
            let output;
            if (kind === 'gate') {
              const decision = await this.host.gate(run, tool, input);
              if (decision.allow && tool.startsWith('crew_')) {
                const id = randomUUID();
                this.permits.set(id, { key, tool, input: JSON.stringify(input) });
                output = { allow: true, permit: id };
              } else output = decision;
            } else if (kind === 'call') {
              const allowed = this.permits.get(permit);
              this.permits.delete(permit);
              if (!allowed || allowed.key !== key || allowed.tool !== tool || allowed.input !== JSON.stringify(input)) throw new Error('Call was not gated');
              output = { text: await this.host.call(run, tool, input, controller.signal) };
            } else output = { allow: false, reason: 'Unknown request' };
            socket.end(JSON.stringify(output) + '\n');
          } catch { socket.end(JSON.stringify({ allow: false, reason: 'Crewhouse could not check this call.' }) + '\n'); }
        })();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.path, () => resolve());
    });
  }
  stop() { this.server?.close(); this.server = undefined; this.runs.clear(); if (existsSync(this.path)) rmSync(this.path); }
}
