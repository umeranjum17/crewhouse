import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { CHIEF, type Config } from './config.ts';
import type { Store } from './db.ts';
import type { Crew } from './crew.ts';
import * as disk from './bots.ts';

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

/** HTTP + WebSocket on 127.0.0.1. The app API, the in-bot `crew` tool API, CLI hooks, and the web UI. */
export function startServer(cfg: Config, db: Store, crew: Crew) {
  const dist = join(cfg.repoDir, 'web', 'dist');
  const localHost = (h = '') => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    try {
      // DNS-rebinding guard: only answer requests addressed to loopback.
      if (!localHost(req.headers.host)) return send(res, 403, { error: 'loopback only' });

      if (p.startsWith('/crew/')) return send(res, 200, await crewTool(p.slice(6), req));

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
    if (m === 'GET' && p === '/api/state') return crew.snapshot();
    if (m === 'GET' && p === '/api/events') return db.events(Number(url.searchParams.get('after') || 0));
    if (m === 'POST' && p === '/api/onboard') return crew.onboard((await readJson(req)).address ?? '');
    if (m === 'POST' && p === '/api/recruit') { const b = await readJson(req); return crew.recruit(b.template, b.name, 'person'); }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)$/)) && m === 'GET') return crew.botPage(r[1]);
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/messages$/)) && m === 'POST') return crew.post(r[1], (await readJson(req)).text ?? '');
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/notes$/)) && m === 'PUT') {
      disk.writeNotes(cfg, r[1], (await readJson(req)).text ?? '');
      db.event('memory.edited', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/tools$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.setGrants(cfg, r[1], (await readJson(req)).tools ?? []);
      db.event('bot.tools', r[1], { by: 'person' });
      return { ok: true };
    }
    if (m === 'GET' && p === '/api/tools') return disk.toolStatus(cfg);
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/screen$/)) && m === 'GET') return { text: await crew.screen(r[1]).catch(() => '') };
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/reset$/)) && m === 'POST') { await crew.resetBot(r[1]); return { ok: true }; }
    if ((r = p.match(/^\/api\/asks\/(\d+)\/answer$/)) && m === 'POST') { await crew.answer(Number(r[1]), await readJson(req)); return { ok: true }; }
    throw Object.assign(new Error('not found'), { status: 404 });
  }

  /** What `bin/crew` calls from inside a bot's CLI. The per-bot token decides who is asking. */
  async function crewTool(cmd: string, req: IncomingMessage) {
    const bot = crew.byToken(req.headers['x-crew-token'] as string);
    const b = await readJson(req);
    const chiefOnly = () => { if (bot.id !== CHIEF) throw Object.assign(new Error('only Chief can do that'), { status: 403 }); };
    switch (cmd) {
      case 'roster': return {
        crew: crew.bots().filter((x) => x.id !== CHIEF).map((x) => ({ id: x.id, name: x.display, role: x.role, busy: !!crew.activeTask(x.id) })),
        templates: disk.listTemplates(cfg).map((t) => ({ id: t.id, name: t.display, role: t.role })),
      };
      case 'recruit': chiefOnly(); { const n = crew.recruit(b.template, b.name, CHIEF); return { recruited: { id: n.id, name: n.display } }; }
      case 'assign': chiefOnly(); return crew.assign(b.bot, b.text ?? '', CHIEF);
      case 'status': return db.all("SELECT id, bot, title, state FROM tasks WHERE state IN ('queued','working','needs_you') ORDER BY id");
      case 'report': db.event('task.progress', bot.id, { text: String(b.text ?? '').slice(0, 200) }); return { ok: true };
      case 'remember': {
        disk.remember(cfg, bot.id, String(b.text ?? ''));
        db.event('memory.learned', bot.id, { text: String(b.text).slice(0, 200) });
        return { ok: true };
      }
      case 'deliver': {
        const full = disk.insideBot(cfg, bot.id, String(b.path ?? ''));
        if (!existsSync(full)) throw new Error(`no file at ${b.path}`);
        const rel = full.slice(disk.botDir(cfg, bot.id).length + 1);
        db.event('file.delivered', bot.id, { path: rel, note: String(b.note ?? '').slice(0, 200), size: statSync(full).size });
        crew.say(bot.id, 'system', `Delivered ${rel}${b.note ? `: ${b.note}` : ''}`, crew.activeTask(bot.id)?.id ?? null);
        return { ok: true, path: rel };
      }
      case 'hook/stop': crew.finish(bot.id, String(b.last_assistant_message ?? '')); return {};
      case 'hook/codex': if (b.type === 'agent-turn-complete') crew.finish(bot.id, String(b['last-assistant-message'] ?? '')); return {};
      case 'hook/notify': db.event('run.notice', bot.id, { text: String(b.message ?? '').slice(0, 200) }); return {};
      case 'hook/permission': return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: await crew.permission(bot.id, b) } };
      case 'hook/session': crew.hookSession(bot.id, b); return {};
      case 'hook/tool': crew.hookTool(bot.id, b); return {};
      case 'hook/statusline': return { text: crew.hookStatus(bot.id, b) };
      case 'call-me': chiefOnly(); crew.setAddress(String(b.text ?? '')); return { ok: true };
    }
    throw Object.assign(new Error(`unknown crew command ${cmd}`), { status: 404 });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (!localHost(req.headers.host) || (origin && !localHost(new URL(origin).host)) || !req.url?.startsWith('/ws')) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  db.onEvent((e) => { const s = JSON.stringify(e); for (const c of wss.clients) if (c.readyState === 1) c.send(s); });

  return new Promise<typeof server>((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server)));
}
