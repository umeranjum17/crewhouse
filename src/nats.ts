// The @mention bus's broker: the pinned NATS server, hash-checked when fetched, run as one supervised child on loopback behind a
// token, plus the publish and durable-reader calls crewd makes on it. Nothing here leaves the machine, and nothing downloads on import.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { AckPolicy, DiscardPolicy, jetstream, jetstreamManager, StorageType, type JetStreamClient, type JetStreamManager, type JsMsg } from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';

export const NATS_VERSION = '2.15.2';
const RELEASE = `https://github.com/nats-io/nats-server/releases/download/v${NATS_VERSION}`, MS = 1_000_000, MAX_BYTES = 64 * 1024 * 1024;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The sha256 GitHub publishes for each pinned release archive, recomputed over every download. */
const ASSETS: Record<string, { url: string; sha256: string; folder: string }> = {
  'linux-x64': { url: `${RELEASE}/nats-server-v${NATS_VERSION}-linux-amd64.tar.gz`, folder: `nats-server-v${NATS_VERSION}-linux-amd64`, sha256: '67cb8e10bc6f0c4b47f75a728529a20953dbae2a4f9a4a52ae8517d65ae303ff' },
  'linux-arm64': { url: `${RELEASE}/nats-server-v${NATS_VERSION}-linux-arm64.tar.gz`, folder: `nats-server-v${NATS_VERSION}-linux-arm64`, sha256: 'bc2c788dcbf2849af749564e06a0d48c19bced851f2d68a2e21c54d078949b28' },
  'darwin-x64': { url: `${RELEASE}/nats-server-v${NATS_VERSION}-darwin-amd64.tar.gz`, folder: `nats-server-v${NATS_VERSION}-darwin-amd64`, sha256: '9c45b23c19498692e81cd39c75e8382f0e6ff59c0d5b9470e32fe6640afa4446' },
  'darwin-arm64': { url: `${RELEASE}/nats-server-v${NATS_VERSION}-darwin-arm64.tar.gz`, folder: `nats-server-v${NATS_VERSION}-darwin-arm64`, sha256: 'cbd2219d01502c38733485ac684269da585ee479fa3b1377264beecdefdf9e9d' },
};

/** The pinned server's absolute path in `dir`, fetched and hash-checked when missing. Never a server found on PATH: it may be years old. */
export async function ensureNats(dir: string): Promise<string> {
  const platform = `${process.platform}-${process.arch}`, asset = ASSETS[platform];
  if (!asset) throw new Error(`The @mention bus needs a NATS server for "${platform}", and only ${Object.keys(ASSETS).join(', ')} are pinned.`);
  dir = resolve(dir);
  const bin = join(dir, 'nats-server'), stamp = `${bin}.sha256`;
  mkdirSync(dir, { recursive: true });
  // The archive's hash is what we trust, so it is stamped beside the unpacked binary; the binary alone is never re-trusted.
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, 'utf8') === asset.sha256) return bin;
  let body: Uint8Array;
  try { const res = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) }); if (!res.ok) throw new Error(`it answered ${res.status}`); body = new Uint8Array(await res.arrayBuffer()); }
  catch (e) { throw new Error(`The @mention bus could not download its NATS server (${(e as Error).message}); check the connection and try again.`); }
  if (body.byteLength > MAX_BYTES) throw new Error('The @mention bus refused a download far bigger than the NATS server.');
  if (createHash('sha256').update(body).digest('hex') !== asset.sha256) throw new Error('The downloaded NATS server failed its safety check, so it was not kept; try again later.');
  const work = mkdtempSync(join(dir, '.unpack-'));
  try {
    writeFileSync(join(work, 'a.tgz'), body);
    if (spawnSync('tar', ['-xzf', 'a.tgz'], { cwd: work }).status !== 0) throw new Error('The downloaded NATS server could not be unpacked.');
    const inner = join(work, asset.folder, 'nats-server');
    if (!existsSync(inner)) throw new Error('The downloaded NATS server archive held no server.');
    chmodSync(inner, 0o755);
    renameSync(inner, bin);
    writeFileSync(stamp, asset.sha256);
  } finally { rmSync(work, { recursive: true, force: true }); }
  return bin;
}

export type StreamOptions = { name: string; subjects: string[]; maxAgeMs?: number; perSubjectCap?: number };
export type BusMessage = { data: Uint8Array; ack(): Promise<void> };
export type BusReader = { stop(): Promise<void> };

const freePort = () => new Promise<number>((ok, no) => { const s = createServer().once('error', no).listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); }); });

/** One local JetStream server as the crew's bus: a supervised child on 127.0.0.1 behind a token only crewd holds. */
export class NatsBus {
  private readonly nc: NatsConnection; private readonly js: JetStreamClient; private readonly jsm: JetStreamManager;
  private readonly o: { bin: string; stream: StreamOptions; pidFile: string };
  private constructor(nc: NatsConnection, jsm: JetStreamManager, o: { bin: string; stream: StreamOptions; pidFile: string }) {
    this.nc = nc; this.jsm = jsm; this.js = jetstream(nc); this.o = o;
  }

  static async open(o: { bin: string; stateDir: string; stream: StreamOptions }): Promise<NatsBus> {
    const dir = join(o.stateDir, 'nats'), portFile = join(dir, 'port'), tokenFile = join(dir, 'token'), pidFile = join(dir, 'pid');
    mkdirSync(join(dir, 'store'), { recursive: true, mode: 0o700 });
    const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : randomBytes(24).toString('hex');
    if (!existsSync(tokenFile)) writeFileSync(tokenFile, token, { mode: 0o600 });
    // Two servers on one store silently lose acknowledged messages, so the port is saved once and never re-picked: a server an
    // earlier crewd left running is adopted, and a port taken by something else is refused in words rather than moved.
    const port = existsSync(portFile) ? Number(readFileSync(portFile, 'utf8')) : await freePort();
    if (!existsSync(portFile)) writeFileSync(portFile, String(port), { mode: 0o600 });
    const servers = `127.0.0.1:${port}`;
    let probe: NatsConnection | undefined, child: ChildProcess | undefined;
    try { probe = await connect({ servers, token, maxReconnectAttempts: 0, timeout: 1500 }); } catch { /* nothing of ours answers yet */ }
    if (!probe) {
      const conf = join(dir, 'nats.conf'), logFile = join(dir, 'server.log');
      writeFileSync(conf, `host: 127.0.0.1\nport: ${port}\nauthorization { token: "${token}" }\njetstream { store_dir: "${join(dir, 'store')}"\n sync_interval: always }\n`, { mode: 0o600 });
      // The server logs to a file, not a pipe: crewd may die and the server must outlive it, and a closed pipe would kill it.
      const log = openSync(logFile, 'w', 0o600);
      child = spawn(o.bin, ['-c', conf], { stdio: ['ignore', log, log], env: {}, detached: true });
      closeSync(log);
      let gone: number | undefined;
      child.once('exit', (code) => { gone = code ?? -1; });
      if (child.pid) writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
      child.unref();
      for (const end = Date.now() + 10_000; !probe && Date.now() < end;) {
        if (gone !== undefined) { const err = readFileSync(logFile, 'utf8').slice(-2000).trim().split('\n').pop() ?? ''; throw new Error(/address already in use|bind/i.test(err) ? `Port ${port} is taken by another program, so the crew's message bus cannot start; free it and restart Crewhouse.` : `The crew's message bus stopped at start (exit ${gone}): ${err}`); }
        try { probe = await connect({ servers, token, maxReconnectAttempts: 0, timeout: 500 }); } catch { await wait(25); }
      }
      if (!probe) { child.kill(); throw new Error("The crew's message bus did not answer in time."); }
    }
    await probe.close();
    const nc = await connect({ servers, token, maxReconnectAttempts: -1, reconnectTimeWait: 200 }), s = o.stream, maxAgeMs = s.maxAgeMs ?? 7 * 86_400_000;
    const jsm = await jetstreamManager(nc), cfg = {
      name: s.name, subjects: s.subjects, storage: StorageType.File, max_age: maxAgeMs * MS, duplicate_window: Math.min(120_000, maxAgeMs) * MS, discard: DiscardPolicy.New,
      ...(s.perSubjectCap ? { max_msgs_per_subject: s.perSubjectCap, discard_new_per_subject: true } : {}) };
    await jsm.streams.add(cfg).catch(() => jsm.streams.update(s.name, cfg));
    return new NatsBus(nc, jsm, { bin: o.bin, stream: s, pidFile });
  }

  /** Store one message. A repeated `msgId` inside the duplicate window is refused by the server, not stored twice. */
  async publish(subject: string, data: string, msgId: string) {
    const ack = await this.js.publish(subject, new TextEncoder().encode(data), { msgID: msgId, timeout: 5000 });
    return { seq: ack.seq, duplicate: ack.duplicate };
  }

  /** A durable reader: it keeps its place across restarts, and each message waits for `ack()` or is delivered again. */
  async reader(durable: string, filter: string, handler: (m: BusMessage) => Promise<void>): Promise<BusReader> {
    const cfg = { durable_name: durable, ack_policy: AckPolicy.Explicit, filter_subject: filter, max_deliver: 5, max_ack_pending: 1, ack_wait: 30_000 * MS };
    const name = this.o.stream.name;
    await this.jsm.consumers.add(name, cfg).catch(() => this.jsm.consumers.update(name, durable, cfg));
    const messages = await (await this.js.consumers.get(name, durable)).consume();
    const loop = (async () => { for await (const m of messages as AsyncIterable<JsMsg>) { try { await handler({ data: m.data, ack: async () => { await m.ackAck(); } }); } catch { m.nak(1000); } } })().catch(() => {});
    return { stop: async () => { await messages.close(); await loop; } };
  }

  /** Close this connection. The server keeps running for the next crewd to adopt, unless `stopServer`: then the saved pid is
   *  stopped, but only while its command line still names our binary. */
  async close(stopServer = false) {
    await this.nc.drain().catch(() => {});
    const pid = Number(existsSync(this.o.pidFile) ? readFileSync(this.o.pidFile, 'utf8') : 0);
    if (!stopServer || !pid || !spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout.includes(this.o.bin)) return;
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 150; i++) { try { process.kill(pid, 0); } catch { return; } await wait(20); }
  }
}
