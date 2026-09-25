import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Crew } from './crew.ts';
import * as disk from './bots.ts';
import { installTool } from './tools.ts';
import { PROVIDERS, provider } from './accounts.ts';
import { coversOf } from './policy.ts';
import { describe, nextRun, parseSchedule } from './routines.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.pdf': 'application/pdf',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body ?? { ok: true }));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 1 << 20) throw Object.assign(new Error('too large'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

function sendFile(req: IncomingMessage, res: ServerResponse, path: string) {
  const size = statSync(path).size;
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) { // video seeking in the browser needs ranges
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
  createReadStream(path).pipe(res);
}

/** HTTP + WebSocket on 127.0.0.1: the app API and the web UI. What it returns is plain words: no commands, paths or model ids. */
export function startServer(cfg: Config, db: Store, crew: Crew) {
  const dist = join(cfg.repoDir, 'web', 'dist');
  const installing = new Set<string>();
  const localHost = (h = '') => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    try {
      // DNS-rebinding guard: only answer requests addressed to loopback.
      if (!localHost(req.headers.host)) return send(res, 403, { error: 'loopback only' });

      if (p.startsWith('/api/')) {
        // Mutations need a custom header, which a cross-site page cannot send without a preflight we never allow.
        if (req.method !== 'GET' && req.headers['x-crewhouse'] !== '1') return send(res, 403, { error: 'missing x-crewhouse header' });
        return send(res, 200, await api(req, p, url));
      }

      const file = p.match(/^\/files\/([a-z0-9-]+)\/(.+)$/);
      if (file) {
        const full = disk.insideBot(cfg, file[1], join('files', decodeURIComponent(file[2])));
        if (!existsSync(full)) return send(res, 404, { error: 'no such file' });
        return sendFile(req, res, full);
      }

      const asset = join(dist, p === '/' ? 'index.html' : p.replace(/\.\.+/g, ''));
      if (existsSync(asset) && statSync(asset).isFile()) return sendFile(req, res, asset);
      const index = join(dist, 'index.html');
      if (!existsSync(index)) return send(res, 503, { error: 'web UI not built: run ./crewhouse setup' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(readFileSync(index));
    } catch (e: any) {
      send(res, e.status ?? 400, { error: e.message });
    }
  });

  async function api(req: IncomingMessage, p: string, url: URL) {
    const m = req.method;
    let r: RegExpMatchArray | null;
    // Which household member is using this screen. It picks whose threads and accounts are shown, never what is allowed.
    const me = crew.viewer(req.headers['x-crewhouse-member']).id as number;
    if (m === 'GET' && p === '/api/state') return crew.snapshot(me);
    if (m === 'GET' && p === '/api/events') return db.events(Number(url.searchParams.get('after') || 0));
    if (m === 'POST' && p === '/api/onboard') return crew.onboard((await readJson(req)).address ?? '', me);
    if (m === 'POST' && p === '/api/recruit') { const b = await readJson(req); const { token, ...bot } = crew.recruit(b.template, b.name, 'person', me); return bot; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)$/)) && m === 'GET') return crew.botPage(r[1], me);
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/messages$/)) && m === 'POST') { const b = await readJson(req); return crew.post(r[1], b.text ?? '', b.model, me); }
    if (m === 'GET' && p === '/api/people') return crew.members();
    if (m === 'POST' && p === '/api/people') return crew.addMember((await readJson(req)).name);
    if ((r = p.match(/^\/api\/people\/(\d+)$/)) && m === 'PUT') return crew.updateMember(Number(r[1]), await readJson(req));
    if (m === 'GET' && p === '/api/accounts') {
      // Everyone's AI accounts: signed in or not (the engine's own local check), resting until when, and any sign-in in progress.
      return Promise.all(crew.members().flatMap((mm) => Object.entries(PROVIDERS).map(async ([key, pr]) => ({
        member: mm.id, account: key, name: pr.name, key: !!pr.key, signedIn: await crew.accounts.signedIn(mm.id, key),
        restingUntil: crew.restingUntil(key, mm.id), signIn: crew.accounts.view(mm.id, key),
      }))));
    }
    // "Sign in with …": start (optionally by code, or with a pasted key), paste the address the browser landed on, cancel, or sign out.
    if ((r = p.match(/^\/api\/accounts\/(\d+)\/([a-z]+)\/(login|paste|cancel|logout)$/)) && m === 'POST') {
      const [who, key, act] = [crew.member(Number(r[1])).id as number, r[2], r[3]];
      provider(key);
      const b = await readJson(req);
      if (act === 'login') await crew.accounts.login(who, key, { via: b.via === 'code' ? 'code' : 'browser', key: b.key });
      else if (act === 'paste') crew.accounts.paste(who, key, String(b.text ?? ''));
      else if (act === 'cancel') crew.accounts.cancel(who, key);
      else await crew.accounts.logout(who, key);
      return { ok: true, signIn: crew.accounts.view(who, key) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/models$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      const models = disk.setBrains(cfg, r[1], (await readJson(req)).models);
      db.event('bot.models', r[1], { by: 'person', models });
      return { thinks: crew.thinks(r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/notes$/)) && m === 'PUT') {
      disk.writeNotes(cfg, r[1], (await readJson(req)).text ?? '');
      db.event('memory.edited', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/memory\/(\d+)\/undo$/)) && m === 'POST') {
      const e = db.get("SELECT * FROM events WHERE seq = ? AND bot = ? AND kind = 'memory.learned'", Number(r[2]), r[1]);
      if (!e) throw Object.assign(new Error('no such memory'), { status: 404 });
      if (db.get("SELECT 1 FROM events WHERE kind = 'memory.undone' AND json_extract(data, '$.seq') = ?", e.seq)) throw Object.assign(new Error('already undone'), { status: 409 });
      const d = JSON.parse(e.data);
      const commit = disk.forget(cfg, r[1], { added: d.added ?? `- ${d.text}`, removed: d.removed ?? null, commit: d.commit ?? null });
      db.event('memory.undone', r[1], { seq: e.seq, text: d.text, commit });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/tools$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.setGrants(cfg, r[1], (await readJson(req)).tools ?? []);
      db.event('bot.tools', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/settings$/)) && m === 'PUT') {
      crew.botPage(r[1]);
      const b = await readJson(req);
      // Standing answers come back as the plain words the page showed; keep the ones still listed.
      if (Array.isArray(b.allow)) b.allow = (disk.botConfig(cfg, r[1]).allow ?? []).filter((k) => b.allow.includes(coversOf(k)));
      disk.setSettings(cfg, r[1], b);
      db.event('bot.settings', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/steer$/)) && m === 'POST') { crew.steer(r[1], String((await readJson(req)).text ?? ''), me); return { ok: true }; }
    if ((r = p.match(/^\/api\/tools\/([a-z0-9-]+)\/install$/)) && m === 'POST') {
      // Installs take minutes (the browser downloads Chromium); the result arrives as an event.
      const id = r[1];
      if (installing.has(id)) return { ok: true, already: true };
      installing.add(id);
      db.event('tool.installing', null, { tool: id });
      installTool(cfg, id)
        .then(() => db.event('tool.installed', null, { tool: id }))
        .catch((e) => { console.error(`install ${id}:`, e); db.event('tool.failed', null, { tool: id }); })
        .finally(() => installing.delete(id));
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/takeover$/)) && m === 'POST') { await crew.takeOver(r[1]); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/giveback$/)) && m === 'POST') { await crew.giveBack(r[1], String((await readJson(req)).note ?? '')); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/reset$/)) && m === 'POST') { await crew.resetBot(r[1]); return { ok: true }; }
    if (m === 'GET' && p === '/api/schedule') {
      const when = parseSchedule(url.searchParams.get('text') ?? '');
      return { words: describe(when), next: nextRun(when, Date.now()) };
    }
    if (m === 'POST' && p === '/api/routines') { const row = crew.addRoutine(await readJson(req), 'person', me); return crew.routines(me).find((x) => x.id === row.id); }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'PUT') { crew.updateRoutine(Number(r[1]), await readJson(req)); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'DELETE') { crew.deleteRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)\/run$/)) && m === 'POST') { crew.runRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/asks\/(\d+)\/answer$/)) && m === 'POST') { await crew.answer(Number(r[1]), await readJson(req)); return { ok: true }; }
    throw Object.assign(new Error('not found'), { status: 404 });
  }

  const wss = new WebSocketServer({ noServer: true });
  const desk = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (!localHost(req.headers.host) || (origin && !localHost(new URL(origin).host)) || !req.url?.startsWith('/ws')) return socket.destroy();
    const bot = /^\/ws\/desktop\/([a-z0-9-]+)$/.exec(req.url)?.[1];
    if (bot) return desk.handleUpgrade(req, socket, head, (ws) => watch(ws, bot));
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  /** One socket per watching screen: desklink signaling in, desktop events out. Closing it ends the session. */
  function watch(ws: import('ws').WebSocket, bot: string) {
    const watcher = { send: (event: unknown) => { if (ws.readyState === 1) ws.send(JSON.stringify({ event })); } };
    ws.on('message', async (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      try {
        const result = await crew.desktopSignal(bot, watcher, String(msg.method), msg.params ?? {});
        ws.send(JSON.stringify({ id: msg.id, result }));
      } catch (e: any) {
        ws.send(JSON.stringify({ id: msg.id, error: { code: e.code ?? 'engine', message: e.message } }));
      }
    });
    ws.on('close', () => crew.desktops.release(watcher));
  }
  db.onEvent((e) => { const s = JSON.stringify(e); for (const c of wss.clients) if (c.readyState === 1) c.send(s); });

  return new Promise<typeof server>((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server)));
}
