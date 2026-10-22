// Composio's hosted tools: one sign-in through the engine's own MCP OAuth. The kit owns the browser hand-off, the callback
// and the sealed tokens; this file only keeps the person's state and the words for it. The engine projects a connected
// server's tools into runs as composio__<tool> (the engine's mcp docs: "<server>__<tool>"); the gate in crew.ts asks each call.
import type { AgentRuntime } from './runtime.ts';
import type { Store } from './db.ts';

export type ComposioState = { state: 'on' | 'waiting' | 'failed' | 'off'; url?: string; error?: string };
const KEY = 'composio.on', FAILED = "Composio didn't finish signing you in. No harm done; tap Connect apps to try once more.";

export class Composio {
  private url?: string; private error?: string; private waiting?: Promise<void>; private attempt?: object;
  private runtime: AgentRuntime; private db: Store;
  constructor(runtime: AgentRuntime, db: Store) { this.runtime = runtime; this.db = db; }
  on() { return this.db.get('SELECT value FROM settings WHERE key = ?', KEY)?.value === '1'; }
  status(): ComposioState {
    if (this.waiting) return { state: 'waiting', url: this.url };
    if (this.error) return { state: 'failed', error: this.error };
    return { state: this.on() ? 'on' : 'off' };
  }
  /** The page to open now; the callback is awaited in the background and the status turns on or failed by itself. */
  async connect(): Promise<ComposioState> {
    const { composioBegin, composioDone } = this.runtime;
    if (!composioBegin || !composioDone) throw Object.assign(new Error('Connect apps needs the AI engine, which is still starting.'), { status: 503 });
    this.error = undefined;
    const { url } = await composioBegin.call(this.runtime);
    this.url = url;
    const mine = this.attempt = {};
    this.waiting = composioDone.call(this.runtime).then(
      () => { if (this.attempt === mine) this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')", KEY); },
      (e) => { console.error('composio sign-in:', e?.code ?? e?.message ?? e); if (this.attempt === mine) this.error = FAILED; },
    ).finally(() => { if (this.attempt === mine) { this.waiting = undefined; this.url = undefined; } });
    return this.status();
  }
  async disconnect() {
    this.error = undefined; this.url = undefined; this.waiting = undefined; this.attempt = undefined;
    await this.runtime.composioSignOut?.();
    this.db.run('DELETE FROM settings WHERE key = ?', KEY);
  }
}
