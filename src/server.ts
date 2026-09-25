import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import type { Crew } from './crew.ts';
import * as disk from './bots.ts';
import { installTool } from './tools.ts';
import { OWNER, PROVIDERS, callbackPage, provider } from './accounts.ts';
import { coversOf } from './policy.ts';
import { describe, nextRun, parseSchedule } from './routines.ts';
import { Link } from './link.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
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
export async function startServer(cfg: Config, db: Store, crew: Crew) {
  const dist = join(cfg.repoDir, 'web', 'dist');
  const installing = new Set<string>();
  const localHost = (h = '') => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);
  // A paired phone acts as the household member it was paired for.
  const link = new Link(cfg, db, (m, path, body, member) => { const u = new URL(path, 'http://x'); return api(m, u.pathname, u.searchParams, body, member); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    try {
      // DNS-rebinding guard: only answer requests addressed to loopback.
      if (!localHost(req.headers.host)) return send(res, 403, { error: 'loopback only' });

      if (p.startsWith('/api/')) {
        // Mutations need a custom header, which a cross-site page cannot send without a preflight we never allow.
        if (req.method !== 'GET' && req.headers['x-crewhouse'] !== '1') return send(res, 403, { error: 'missing x-crewhouse header' });
        // Which household member is using this screen. It picks whose threads and accounts are shown, never what is allowed.
        const me = crew.viewer(req.headers['x-crewhouse-member']).id as number;
        // Phones: pairing and grants answer on this computer only, never over the phone link.
        if (p === '/api/phones' && req.method === 'GET') return send(res, 200, link.devices());
        if (p === '/api/phones/link' && req.method === 'GET') return send(res, 200, link.status());
        if (p === '/api/phones/pair' && req.method === 'POST') return send(res, 200, await link.offer((await readJson(req)).role ?? 'control', me));
        if (p === '/api/phones/lan' && req.method === 'PUT') { await link.setLan(!!(await readJson(req)).on); return send(res, 200, link.status()); }
        if (p === '/api/phones/relay' && req.method === 'PUT') { const b = await readJson(req); link.setRelay(typeof b.url === 'string' ? b.url.trim() : null); return send(res, 200, link.status()); }
        // A phone that scanned the code waits here: the person checks its two words and says yes or no.
        if (p === '/api/phones/answer' && req.method === 'POST') { const b = await readJson(req); link.answer(Number(b.id), b.yes === true); return send(res, 200, { ok: true }); }
        const phone = p.match(/^\/api\/phones\/([\w-]+)$/);
        if (phone && req.method === 'DELETE') { await link.revoke(phone[1]); return send(res, 200, { ok: true }); }
        return send(res, 200, await api(req.method!, p, url.searchParams, req.method === 'GET' ? {} : await readJson(req), me));
      }

      // An app's sign-in page sends the browser back here; the tab says, in words, how it went.
      if (p === '/connect/callback') {
        const words = await crew.connections.finish(url.searchParams);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(callbackPage('Crewhouse', words, /connected\./.test(words)));
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

  /** The app API, shared by the web app (HTTP) and paired phones (the link). `me` is the member using it. */
  async function api(m: string, p: string, q: URLSearchParams, body: any, me: number) {
    let r: RegExpMatchArray | null;
    if (m === 'GET' && p === '/api/state') return crew.snapshot(me);
    if (m === 'GET' && p === '/api/events') return db.events(Number(q.get('after') || 0));
    if (m === 'POST' && p === '/api/onboard') { const b = body; return crew.onboard(b.address ?? '', me, b.ask) ?? { ok: true }; }
    if (m === 'POST' && p === '/api/recruit') { const b = body; const { token, ...bot } = crew.recruit(b.template, b.name, 'person', me); return bot; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)$/)) && m === 'GET') return crew.botPage(r[1], me);
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/messages$/)) && m === 'POST') { const b = body; return crew.post(r[1], b.text ?? '', b.model, me); }
    if (m === 'GET' && p === '/api/people') return crew.members();
    if (m === 'POST' && p === '/api/people') return crew.addMember(body.name);
    if ((r = p.match(/^\/api\/people\/(\d+)$/)) && m === 'PUT') return crew.updateMember(Number(r[1]), body);
    if (m === 'GET' && p === '/api/accounts') {
      // Everyone's AI accounts: signed in or not (the engine's own local check), resting until when, and any sign-in in progress.
      // A work ChatGPT (Business, Enterprise, Edu) is flagged by its email, so the app can steer to a personal one.
      return Promise.all(crew.members().flatMap((mm) => Object.entries(PROVIDERS).map(async ([key, pr]) => {
        const signedIn = await crew.accounts.signedIn(mm.id, key);
        const plan = signedIn && key === 'chatgpt' ? await crew.accounts.plan(mm.id) : null;
        return { member: mm.id, account: key, name: pr.name, signedIn, restingUntil: crew.restingUntil(key, mm.id), signIn: crew.accounts.view(mm.id, key),
          notIncluded: crew.accounts.notIncluded(mm.id, key), work: plan?.work ? plan.email || true : false };
      })));
    }
    // "Sign in with …": start (the page by default, `via: 'code'` for the code), paste the address the browser landed on,
    // cancel, sign out; "I've changed my plan" (retry) and "Ask the owner to cover it".
    if ((r = p.match(/^\/api\/accounts\/(\d+)\/([a-z]+)\/(login|paste|cancel|logout|retry|ask-owner)$/)) && m === 'POST') {
      const [who, key, act] = [crew.member(Number(r[1])).id as number, r[2], r[3]];
      provider(key);
      const b = body;
      if (act === 'login') return { ok: true, signIn: await crew.accounts.login(who, key, { via: b.via === 'code' ? 'code' : 'browser', fresh: !!b.fresh }) };
      else if (act === 'retry') crew.retryAccount(who, key);
      else if (act === 'ask-owner') crew.askOwner(who, key);
      else if (act === 'paste') crew.accounts.paste(who, key, String(b.text ?? ''));
      else if (act === 'cancel') crew.accounts.cancel(who, key);
      else await crew.accounts.logout(who, key);
      return { ok: true, signIn: crew.accounts.view(who, key) };
    }
    // Connections: the viewer's own apps (Notion, Canva, Google…), connected on the app's own page (docs/ui-contract.md).
    if (m === 'GET' && p === '/api/connections') return crew.connections.list(me);
    // The owner switches Google on for the house, once: the household Google app's client ID and secret.
    if (m === 'PUT' && p === '/api/house/google') {
      if (me !== OWNER) throw Object.assign(new Error('only the owner sets this up'), { status: 403 });
      const b = body;
      crew.connections.setHouseGoogle(b.id, b.secret);
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/connections\/([a-z]+)$/))) {
      const app = r[1];
      if (m === 'POST') { const v = await crew.connections.connect(me, app); return v.state === 'done' ? { state: 'on' } : v.state === 'failed' ? Promise.reject(Object.assign(new Error(v.error), { status: 502 })) : { url: v.url }; }
      if (m === 'GET') return crew.connections.status(me, app);
      if (m === 'DELETE') { crew.connections.cancel(me, app); return { ok: true }; }
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/models$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      const models = disk.setBrains(cfg, r[1], body.models);
      db.event('bot.models', r[1], { by: 'person', models });
      return { thinks: crew.thinks(r[1]) };
    }
    // What a helper learned about the viewer, and what the whole crew knows about them: each person edits only their own.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/notes$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.writeNotes(cfg, { member: me, bot: r[1] }, body.text ?? '');
      db.event('memory.edited', r[1], { by: 'person', member: me });
      return { ok: true };
    }
    if (p === '/api/about' && m === 'GET') return { notes: disk.readNotes(cfg, { member: me, bot: null }), cap: disk.ABOUT_CAP };
    if (p === '/api/about' && m === 'PUT') {
      disk.writeNotes(cfg, { member: me, bot: null }, body.text ?? '');
      db.event('memory.edited', null, { by: 'person', member: me, everyone: true });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/memory\/(\d+)\/undo$/)) && m === 'POST') {
      const e = db.get("SELECT * FROM events WHERE seq = ? AND bot = ? AND kind = 'memory.learned'", Number(r[2]), r[1]);
      if (!e) throw Object.assign(new Error('no such memory'), { status: 404 });
      const d = JSON.parse(e.data);
      if ((d.member ?? 1) !== me) throw Object.assign(new Error('that is someone else\'s'), { status: 403 });
      if (db.get("SELECT 1 FROM events WHERE kind = 'memory.undone' AND json_extract(data, '$.seq') = ?", e.seq)) throw Object.assign(new Error('already undone'), { status: 409 });
      const commit = disk.forget(cfg, { member: me, bot: d.everyone ? null : r[1] }, { added: d.added ?? `- ${d.text}`, removed: d.removed ?? null, commit: d.commit ?? null });
      db.event('memory.undone', r[1], { seq: e.seq, text: d.text, commit, member: me });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/skills\/([a-z0-9-]+)$/)) && m === 'DELETE') {
      crew.botPage(r[1]); // 404 for unknown bots
      const k = disk.archiveSkill(cfg, r[1], r[2]);
      db.event('skill.removed', r[1], { name: k.name, says: k.says, member: me });
      return { ok: true };
    }
    // Who a helper is: the person writes it, a bot never does. "Put back" is the template's, under the helper's own name.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/soul$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.writeSoul(cfg, r[1], body.text ?? '');
      db.event('soul.changed', r[1], { by: 'person', member: me });
      return { soul: disk.readSoul(cfg, r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/soul\/reset$/)) && m === 'POST') {
      const b = crew.botPage(r[1]).bot;
      disk.writeSoul(cfg, r[1], disk.templateSoul(cfg, disk.loadTemplate(cfg, b.template), b.display), 'Put back how it started');
      db.event('soul.changed', r[1], { by: 'person', member: me, reset: true });
      return { soul: disk.readSoul(cfg, r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/tools$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.setGrants(cfg, r[1], body.tools ?? []);
      db.event('bot.tools', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/settings$/)) && m === 'PUT') {
      crew.botPage(r[1]);
      const b = body;
      // Standing answers come back as the plain words the page showed; keep the ones still listed.
      if (Array.isArray(b.allow)) b.allow = (disk.botConfig(cfg, r[1]).allow ?? []).filter((k) => b.allow.includes(coversOf(k)));
      disk.setSettings(cfg, r[1], b);
      db.event('bot.settings', r[1], { by: 'person' });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/steer$/)) && m === 'POST') { crew.steer(r[1], String(body.text ?? ''), me); return { ok: true }; }
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
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/giveback$/)) && m === 'POST') { await crew.giveBack(r[1], String(body.note ?? '')); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/reset$/)) && m === 'POST') { await crew.resetBot(r[1]); return { ok: true }; }
    if (m === 'GET' && p === '/api/schedule') {
      const when = parseSchedule(q.get('text') ?? '');
      return { words: describe(when), next: nextRun(when, Date.now()) };
    }
    if (m === 'POST' && p === '/api/routines') { const row = crew.addRoutine(body, 'person', me); return crew.routines(me).find((x) => x.id === row.id); }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'PUT') { crew.updateRoutine(Number(r[1]), body); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'DELETE') { crew.deleteRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)\/run$/)) && m === 'POST') { crew.runRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/asks\/(\d+)\/answer$/)) && m === 'POST') { await crew.answer(Number(r[1]), body); return { ok: true }; }
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

  await link.listen();
  server.on('close', () => link.close());
  return new Promise<typeof server>((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server)));
}
