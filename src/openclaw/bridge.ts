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
  /** While armed, ONLY the captured review — the member's own collection-review session, for the captured action —
   *  may run the workshop, and only ONCE: the engine mints the reviewer's session key fresh per run
   *  (`incognito-<uuid>`), so the first qualifying call is the captured call, the window closes behind it, and no
   *  replay or same-prefix different review gets a second pass. Unarmed — the default — every session crewhouse did
   *  not register fails closed, the workshop included. */
  private armed?: { member: number; review: string; action: string; until: number; used?: boolean };
  readonly path: string;
  private readonly host: ToolHost;
  constructor(stateDir: string, host: ToolHost) {
    this.path = join(stateDir, 'openclaw/crewd.sock');
    this.host = host;
  }
  register(run: RunRef) { this.runs.set(run.key, run); }
  /** Open the workshop window for the engine's own reviewer (crewd arms it only after a verified capture), bound to
   *  the exact captured member, review and action — the same member's same action passes, everything else is denied
   *  even inside the window. */
  armCuration(scope: { member: number; review: string; action: string }, ms: number) { this.armed = { ...scope, until: Date.now() + ms }; }
  disarmCuration() { this.armed = undefined; }
  get curationArmed() { return !!this.armed && Date.now() < this.armed.until; }
  private curationAllowed(key: unknown, tool: string, input: any) {
    const a = this.armed;
    if (!a || a.used || Date.now() >= a.until || tool !== 'skill_workshop' || input?.action !== a.action) return false;
    if (typeof key !== 'string' || !key.startsWith(`agent:m${a.member}:${a.review}:`)) return false;
    a.used = true;
    return true;
  }
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
            if (typeof tool !== 'string' || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Unknown run or invalid call');
            const run = this.runs.get(key);
            let output;
            if (kind === 'gate' && !run) {
              // The engine's own reviewer (the collection review crewhouse triggered) is not a crew run: only the
              // captured review's own session, for the captured action, inside the window; everything else fails closed.
              if (this.curationAllowed(key, tool, input)) output = { allow: true };
              else throw new Error('Unknown run');
            } else if (kind === 'gate') {
              const decision = await this.host.gate(run!, tool, input);
              if (decision.allow && tool.startsWith('crew_')) {
                const id = randomUUID();
                this.permits.set(id, { key, tool, input: JSON.stringify(input) });
                output = { allow: true, permit: id };
              } else output = decision;
            } else if (kind === 'call') {
              // crew_* tools carry a one-use permit from their gate; crewd's own bash/browser/app tools are gated by the
              // same hook before every call, and the socket is reachable only by the gateway's own process.
              if (tool.startsWith('crew_')) {
                const allowed = this.permits.get(permit);
                this.permits.delete(permit);
                if (!allowed || allowed.key !== key || allowed.tool !== tool || allowed.input !== JSON.stringify(input)) throw new Error('Call was not gated');
              }
              output = { text: await this.host.call(run!, tool, input, controller.signal) };
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
