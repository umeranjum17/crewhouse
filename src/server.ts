import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { CHIEF, type Config } from './config.ts';
import type { Store } from './db.ts';
import type { Crew } from './crew.ts';
import * as disk from './bots.ts';
import { installTool, toolStatus } from './tools.ts';
import { where } from './accounts.ts';
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

/** HTTP + WebSocket on 127.0.0.1. The app API, the in-bot `crew` tool API, CLI hooks, and the web UI. */
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
      // Everyone's accounts, each from the vendor's own status command, with live limits and any sign-in in progress.
      return Promise.all(crew.members().flatMap((mm) => Object.entries(disk.RUNTIMES).map(async ([rt, name]) => ({
        member: mm.id, runtime: rt, name, where: where(cfg, mm.id, rt), ...(await crew.accounts.status(mm.id, rt, url.searchParams.has('fresh'))),
        limits: crew.limitsOf(mm.id, rt), restingUntil: crew.restingUntil(rt, mm.id), login: crew.accounts.loginView(mm.id, rt),
      }))));
    }
    if ((r = p.match(/^\/api\/accounts\/(\d+)\/([a-z]+)\/login(\/input|\/cancel)?$/)) && m === 'POST') {
      const [who, rt, sub] = [crew.member(Number(r[1])).id as number, r[2], r[3]];
      if (!disk.RUNTIMES[rt]) throw Object.assign(new Error(`no such account kind ${rt}`), { status: 404 });
      if (sub === '/input') crew.accounts.loginInput(who, rt, String((await readJson(req)).text ?? ''));
      else if (sub === '/cancel') crew.accounts.cancelLogin(who, rt);
      else crew.accounts.login(who, rt);
      return { ok: true };
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
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/tools$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.setGrants(cfg, r[1], (await readJson(req)).tools ?? []);
      db.event('bot.tools', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/settings$/)) && m === 'PUT') {
      crew.botPage(r[1]);
      disk.setSettings(cfg, r[1], await readJson(req));
      db.event('bot.settings', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/type$/)) && m === 'POST') { await crew.type(r[1], await readJson(req)); return { ok: true }; }
    if (m === 'GET' && p === '/api/tools') return toolStatus(cfg);
    if ((r = p.match(/^\/api\/tools\/([a-z0-9-]+)\/install$/)) && m === 'POST') {
      // Installs take minutes (the browser downloads Chromium); the result arrives as an event.
      const id = r[1];
      if (installing.has(id)) return { ok: true, already: true };
      installing.add(id);
      db.event('tool.installing', null, { tool: id });
      installTool(cfg, id)
        .then(() => db.event('tool.installed', null, { tool: id }))
        .catch((e) => db.event('tool.failed', null, { tool: id, error: String(e.message).slice(0, 300) }))
        .finally(() => installing.delete(id));
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/screen$/)) && m === 'GET') return { text: await crew.screen(r[1]).catch(() => '') };
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/takeover$/)) && m === 'POST') { await crew.takeOver(r[1]); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/giveback$/)) && m === 'POST') { await crew.giveBack(r[1], String((await readJson(req)).note ?? '')); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/reset$/)) && m === 'POST') { await crew.resetBot(r[1]); return { ok: true }; }
    if (m === 'GET' && p === '/api/schedule') {
      const when = parseSchedule(url.searchParams.get('text') ?? '');
      return { words: describe(when), next: nextRun(when, Date.now()) };
    }
    if (m === 'POST' && p === '/api/routines') return crew.addRoutine(await readJson(req), 'person', me);
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'PUT') { crew.updateRoutine(Number(r[1]), await readJson(req)); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'DELETE') { crew.deleteRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)\/run$/)) && m === 'POST') { crew.runRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/asks\/(\d+)\/answer$/)) && m === 'POST') { await crew.answer(Number(r[1]), await readJson(req)); return { ok: true }; }
    throw Object.assign(new Error('not found'), { status: 404 });
  }

  /** What `bin/crew` calls from inside a bot's CLI. The per-bot token decides who is asking. */
  async function crewTool(cmd: string, req: IncomingMessage) {
    const bot = crew.byToken(req.headers['x-crew-token'] as string);
    const b = await readJson(req);
    const task = crew.activeTask(bot.id)?.id;
    const chiefOnly = () => { if (bot.id !== CHIEF) throw Object.assign(new Error('only Chief can do that'), { status: 403 }); };
    switch (cmd) {
      case 'roster': return {
        crew: crew.bots().filter((x) => x.id !== CHIEF).map((x) => ({ id: x.id, name: x.display, role: x.role, busy: !!crew.activeTask(x.id) })),
        templates: disk.listTemplates(cfg).map((t) => ({ id: t.id, name: t.display, role: t.role })),
      };
      case 'recruit': chiefOnly(); { const n = crew.recruit(b.template, b.name, CHIEF); return { recruited: { id: n.id, name: n.display } }; }
      case 'assign': chiefOnly(); return crew.assign(b.bot, b.text ?? '', CHIEF, b.model);
      case 'routine': chiefOnly(); { const x = crew.addRoutine(b, CHIEF); return { routine: { id: x.id, name: x.name, next: new Date(x.next_at).toString() } }; }
      case 'routines': return crew.routines(crew.chiefFor()).map((x) => ({ id: x.id, bot: x.bot, name: x.name, when: x.words, state: x.state, next: new Date(x.next_at).toString() }));
      case 'status': return db.all("SELECT id, bot, title, state FROM tasks WHERE state IN ('queued','working','needs_you') ORDER BY id");
      case 'report': db.event('task.progress', bot.id, { task, text: String(b.text ?? '').slice(0, 200) }); return { ok: true };
      case 'remember': {
        disk.remember(cfg, bot.id, String(b.text ?? ''));
        db.event('memory.learned', bot.id, { task, text: String(b.text).slice(0, 200) });
        return { ok: true };
      }
      case 'deliver': {
        const full = disk.insideBot(cfg, bot.id, String(b.path ?? ''));
        if (!existsSync(full)) throw new Error(`no file at ${b.path}`);
        const rel = full.slice(disk.botDir(cfg, bot.id).length + 1);
        db.event('file.delivered', bot.id, { task, path: rel, note: String(b.note ?? '').slice(0, 200), size: statSync(full).size });
        crew.say(bot.id, 'system', `Delivered ${rel}${b.note ? `: ${b.note}` : ''}`, task ?? null);
        return { ok: true, path: rel };
      }
      case 'hook/stop': crew.finish(bot.id, String(b.last_assistant_message ?? '')); return {};
      // An empty turn (Codex at a usage limit ends like this) is left to the terminal fallback, which reads the reason.
      case 'hook/codex': if (b.type === 'agent-turn-complete' && b['last-assistant-message']) crew.finish(bot.id, String(b['last-assistant-message'])); return {};
      case 'hook/failure': crew.hookFailure(bot.id, b); return {};
      case 'hook/notify': db.event('run.notice', bot.id, { text: String(b.message ?? '').slice(0, 200) }); return {};
      case 'hook/permission': return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: await crew.permission(bot.id, b) } };
      case 'hook/session': crew.hookSession(bot.id, b); return {};
      case 'hook/tool': crew.hookTool(bot.id, b); return {};
      case 'hook/pretool': return crew.preTool(bot.id, b);
      case 'hook/statusline': return { text: crew.hookStatus(bot.id, b) };
      case 'call-me': chiefOnly(); crew.setAddress(String(b.text ?? '')); return { ok: true };
    }
    throw Object.assign(new Error(`unknown crew command ${cmd}`), { status: 404 });
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

  /** One socket per watching screen: desklink signaling in, engine events out. Closing it ends the session. */
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
