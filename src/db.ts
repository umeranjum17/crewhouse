import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, any>;

const SCHEMA = `
-- The person is id 1. Legacy member columns stay for upgrade compatibility.
CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT, address TEXT, onboarded INTEGER DEFAULT 0, created_at INTEGER, quiet TEXT);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY, display TEXT NOT NULL, role TEXT, template TEXT, runtime TEXT, model TEXT,
  color TEXT, token TEXT UNIQUE, session TEXT, state TEXT DEFAULT 'off', created_at INTEGER);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, bot TEXT NOT NULL, title TEXT, body TEXT, origin TEXT,
  state TEXT NOT NULL DEFAULT 'queued', result TEXT, created_at INTEGER, updated_at INTEGER,
  brain TEXT, wake_at INTEGER);
CREATE INDEX IF NOT EXISTS tasks_bot_state ON tasks(bot, state);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, bot TEXT NOT NULL, author TEXT, text TEXT, task_id INTEGER, at INTEGER);
CREATE INDEX IF NOT EXISTS messages_bot ON messages(bot, id);
CREATE TABLE IF NOT EXISTS asks (
  id INTEGER PRIMARY KEY, bot TEXT, task_id INTEGER, kind TEXT, title TEXT, detail TEXT,
  state TEXT DEFAULT 'open', answer TEXT, at INTEGER, answered_at INTEGER);
CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY, bot TEXT NOT NULL, name TEXT, schedule TEXT NOT NULL, body TEXT, brain TEXT, member INTEGER DEFAULT 1,
  kind TEXT DEFAULT 'task', state TEXT DEFAULT 'on', next_at INTEGER, last_at INTEGER, last_task INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT, pk TEXT UNIQUE, role TEXT, member INTEGER DEFAULT 1, created_at INTEGER, last_seen INTEGER);
-- What the crew used of the person's AI each day (weighted tokens), for their share. Never shown as a number.
-- The last message the person has seen in each bot's thread: what makes a chat unread.
CREATE TABLE IF NOT EXISTS reads (member INTEGER, bot TEXT, seen INTEGER, PRIMARY KEY (member, bot));
CREATE TABLE IF NOT EXISTS usage (member INTEGER, day TEXT, tokens INTEGER, PRIMARY KEY (member, day));
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER, kind TEXT, bot TEXT, data TEXT);
`;

/** One SQLite file. Every write that matters appends an event in the same transaction. */
export class Store {
  db: DatabaseSync;
  private listeners = new Set<(e: Row) => void>();

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.db = new DatabaseSync(join(stateDir, 'crew.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
    this.db.exec(SCHEMA);
    // Columns added after the first release; CREATE IF NOT EXISTS leaves older tables as they were.
    // Member columns stay for compatibility with existing databases.
    for (const [table, col] of [['tasks', 'brain TEXT'], ['tasks', 'wake_at INTEGER'], ['people', 'quiet TEXT'], ['bots', 'member INTEGER DEFAULT 1'],
      ['tasks', 'member INTEGER DEFAULT 1'], ['messages', 'member INTEGER'], ['asks', 'member INTEGER'], ['tasks', 'routine INTEGER'], ['tasks', 'session TEXT'], ['routines', 'quiet INTEGER DEFAULT 0'], ['people', 'share TEXT'], ['routines', 'watch TEXT'], ['routines', 'trigger TEXT'], ['routines', 'cursor TEXT'], ['tasks', 'hops INTEGER DEFAULT 0'], ['routines', 'down INTEGER DEFAULT 0'], ['tasks', 'photos TEXT'], ['tasks', 'acted TEXT'], ['tasks', 'outcome TEXT'], ['tasks', 'tokens INTEGER DEFAULT 0'], ['tasks', 'parent INTEGER'], ['tasks', 'root INTEGER'], ['tasks', 'room INTEGER DEFAULT 0'], ['tasks', 'reask INTEGER DEFAULT 0'], ['routines', 'mailwatch INTEGER DEFAULT 0']]) {
      if (!this.all(`PRAGMA table_info(${table})`).some((c) => c.name === col.split(' ')[0])) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    }
    this.db.exec("UPDATE events SET data = '{}' WHERE kind IN ('system.engine','bot.models') AND data != '{}'");
  }

  all(sql: string, ...args: any[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  get(sql: string, ...args: any[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }

  /** Shared installs must pass through the backup-and-split release before this build. */
  single() {
    if (this.get('SELECT 1 FROM people WHERE id != 1')) throw new Error('Update through the one-person migration release bc37c20 (P1) first.');
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /** Append an event; listeners (WebSocket fan-out) hear it after the caller's transaction. */
  event(kind: string, bot: string | null, data: Row = {}): Row {
    const at = Date.now();
    const r = this.run('INSERT INTO events (at, kind, bot, data) VALUES (?, ?, ?, ?)', at, kind, bot, JSON.stringify(data));
    const e = { seq: Number(r.lastInsertRowid), at, kind, bot, data };
    queueMicrotask(() => this.listeners.forEach((l) => l(e)));
    return e;
  }

  /** Ephemeral updates for a live reply: fan out without filling the durable event log with tokens. */
  live(kind: string, bot: string, data: Row) {
    const e = { at: Date.now(), kind, bot, data };
    queueMicrotask(() => this.listeners.forEach((l) => l(e)));
  }

  onEvent(l: (e: Row) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }

  eventsForBot(bot: string, kinds: string[], limit = 300): Row[] {
    return this.all(`SELECT * FROM events WHERE bot = ? AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT ?`,
      bot, ...kinds, limit).map((e) => ({ ...e, data: JSON.parse(e.data) }));
  }

  events(after = 0, limit = 200): Row[] {
    return this.all('SELECT * FROM events WHERE seq > ? ORDER BY seq DESC LIMIT ?', after, limit)
      .map((e) => ({ ...e, data: JSON.parse(e.data) })).reverse();
  }

  close() { this.db.close(); }
}
