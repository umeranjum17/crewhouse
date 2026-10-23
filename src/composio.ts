// Composio OAuth and sealed tokens belong to the kit; this file keeps sign-in state. Hosted composio__<tool> calls go through crew.ts's policy gate.
import type { AgentRuntime } from './runtime.ts';
import type { Store } from './db.ts';

export const GMAIL_CONNECT = 'Composio is on. For Gmail, request read-only access for a read request and start with the connection tool. In code-mode exec (JavaScript, not a shell command), run `return await MCP.composio.$api("COMPOSIO_MANAGE_CONNECTIONS", {schema: true});`. Then call the connection function named in the returned header with one object matching the returned schema. If direct tools are offered instead, call composio__COMPOSIO_MANAGE_CONNECTIONS using its advertised schema. These are tool APIs, not files in your folder: never read engine files or search node_modules for tool shapes. For reads, do not request send, modify or delete access; if read-only cannot be requested, explain why and stop. Show the Composio connection link to the person, even though ordinary replies omit links, then wait for consent; never invent a link or claim Gmail is connected before the tool confirms it. Native Gmail grants are unavailable; do not call crew_connect for Gmail.';
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
