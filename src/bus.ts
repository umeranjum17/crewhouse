// The @mention bus. A helper's crew_mention passes crewd's gate and lands as one `bus` row (the outbox and, by its state, the inbox's seen-mark),
// rides NATS JetStream as an id (the words stay in crew.db), and the target's durable reader turns it into a task exactly once.
import { join } from 'node:path';
import { ensureNats, NatsBus, type BusReader } from './nats.ts';
import type { Config } from './config.ts';
import type { Row, Store } from './db.ts';

const HOPS = 3, CHAIN = 12, PER_HOUR = 20, MAX_AGE = 7 * 86_400_000, td = new TextDecoder();
export type BusHost = { say(bot: string, author: string, text: string, task: number | null): unknown; name(bot: string): string | undefined; start(row: Row): void };

export class Bus {
  private cfg: Config; private db: Store; private host: BusHost;
  private nats?: Promise<NatsBus>; private readers = new Map<string, Promise<BusReader>>(); private flushing = false; private wait = 0;
  constructor(cfg: Config, db: Store, host: BusHost) { this.cfg = cfg; this.db = db; this.host = host; }

  /** The gate: the person-readable reason a mention may not go, from SQLite alone so it holds with the broker down. */
  private refusal(from: string, task: Row, to: string, text: string): string | undefined {
    const chain = task.root ?? task.id, up = this.db.get('SELECT * FROM bus WHERE task = ?', task.id), hops = (up?.hops ?? 0) + 1, a = this.host.name(from), b = this.host.name(to);
    if (!b) return `There is no helper "${to}". Ask Chief who is on the crew.`;
    if (to === from) return 'You cannot ask yourself.';
    if (up?.from_bot === to) return `${b} gave you this job, so your answer goes back to ${b} when you finish. Do not mention ${b} to reply.`;
    if (this.db.get('SELECT 1 FROM bus WHERE chain = ? AND to_bot = ? AND text = ?', chain, to, text)) return `You already asked ${b} exactly that.`;
    const stop = hops > HOPS || this.db.get('SELECT COUNT(*) AS n FROM bus WHERE chain = ?', chain)!.n >= CHAIN;
    if (stop) { this.host.say(from, 'system', `${a} and ${b} kept passing this back, so I stopped it.`, task.id); this.host.say(to, 'system', `${a} and ${b} kept passing this back, so I stopped it.`, null); this.db.event('bus.stopped', from, { task: task.id, to, hops }); return 'This job has been passed along too many times, so no more mentions go. Finish it yourself or tell the person.'; }
    if (this.db.get('SELECT COUNT(*) AS n FROM bus WHERE from_bot = ? AND at > ?', from, Date.now() - 3_600_000)!.n >= PER_HOUR) return 'You have asked other helpers a lot this hour. Wait, or tell the person.';
  }

  /** crew_mention: gate, then one write (the chat line and the outbox row), then the publish in the background. */
  mention(from: string, task: Row, to: string, text: string) {
    text = text.trim(); if (!text) throw new Error('say what you want to ask');
    const no = this.refusal(from, task, to, text); if (no) throw new Error(no);
    const id = this.db.tx(() => {
      const up = this.db.get('SELECT hops FROM bus WHERE task = ?', task.id), r = this.db.run("INSERT INTO bus (from_bot, to_bot, sender_task, chain, hops, text, state, at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)", from, to, task.id, task.root ?? task.id, (up?.hops ?? 0) + 1, text, Date.now());
      this.host.say(from, 'system', `Asked ${this.host.name(to)}: ${text}`, task.id);
      return Number(r.lastInsertRowid);
    });
    void this.flush();
    return { asked: this.host.name(to), id };
  }

  private open(): Promise<NatsBus> {
    return this.nats ??= (async () => {
      const bin = this.cfg.natsBin || await ensureNats(join(this.cfg.toolsDir, 'nats'));
      const bus = await NatsBus.open({ bin, stateDir: this.cfg.stateDir, stream: { name: 'CREW', subjects: ['crew.>'], perSubjectCap: CHAIN, maxAgeMs: MAX_AGE } });
      return bus;
    })().catch((e) => { this.nats = undefined; throw e; });
  }

  private reader(bus: NatsBus, bot: string) {
    return this.readers.get(bot) ?? (this.readers.set(bot, bus.reader(`bot-${bot}`, `crew.mention.${bot}.>`, async (m) => {
      const row = this.db.get('SELECT * FROM bus WHERE id = ?', Number(JSON.parse(td.decode(m.data)).id));
      if (row?.state === 'open') this.host.start(row); // claims the row in the task's own transaction; a repeat finds it taken and does nothing
      await m.ack();
    })), this.readers.get(bot)!);
  }

  /** From crewd's tick: unsent mentions go again, and a down broker is tried every 30 s, not every tick. */
  retry() { if (Date.now() >= this.wait) void this.flush(); }

  /** Send every open mention, expire the old, and keep a reader for each target. Safe to call at any time and after a restart. */
  async flush() {
    if (this.flushing || !this.db.get("SELECT 1 FROM bus WHERE state = 'open'")) return;
    this.flushing = true;
    try {
      for (const row of this.db.all("SELECT * FROM bus WHERE state = 'open' AND at < ?", Date.now() - MAX_AGE)) { this.db.run("UPDATE bus SET state = 'missed' WHERE id = ?", row.id); this.host.say(row.to_bot, 'system', `A message from ${this.host.name(row.from_bot)} waited too long and was dropped.`, null); }
      const bus = await this.open();
      for (const row of this.db.all("SELECT * FROM bus WHERE state = 'open' ORDER BY id")) { await this.reader(bus, row.to_bot); await bus.publish(`crew.mention.${row.to_bot}.${row.chain}`, JSON.stringify({ id: row.id }), `m-${row.id}`); }
    } catch (e) { this.wait = Date.now() + 30_000; this.db.event('bus.down', null, { why: (e as Error).message.slice(0, 200) }); } finally { this.flushing = false; }
  }

  /** The target's job ended: its words go back to the helper that asked. */
  reply(task: Row, state: string, result?: string) {
    const row = this.db.get("SELECT * FROM bus WHERE task = ? AND state = 'taken'", task.id);
    if (!row || !['done', 'failed', 'unsure'].includes(state)) return;
    this.db.run("UPDATE bus SET state = 'done' WHERE id = ?", row.id);
    this.host.say(row.from_bot, task.bot, state === 'done' ? (result ?? '').slice(0, 1200) : `${this.host.name(task.bot)} could not finish that.`, row.sender_task);
  }

  async stop() {
    const bus = await this.nats?.catch(() => undefined); if (!bus) return;
    for (const r of this.readers.values()) await (await r).stop().catch(() => {});
    await bus.close(true);
  }
}
