import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import type { Config } from './config.ts';
import type { Store } from './db.ts';
import { quietNow, type Crew } from './crew.ts';
import * as disk from './bots.ts';
import { toolStatus } from './tools.ts';
import { PROVIDERS, clock, provider } from './accounts.ts';
import { coversOf, toolWords } from './policy.ts';
import { describe, firstRun, nextRun, parseSchedule } from './routines.ts';
import { Link } from './link.ts';
import { lesson, Teacher } from './teach.ts';

/** A sign-in result tab: one line, in Crewhouse's own words, then the tab closes itself. */
const resultPage = (title: string, words: string, close = false) => '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  `<title>${title.replace(/[<&]/g, '')}</title><body style="font:18px system-ui;margin:3em auto;max-width:26em;padding:0 1em;text-align:center;color:#2e2a40">${words.replace(/[<&]/g, '')}` +
  (close ? '<script>setTimeout(() => window.close(), 1500)</script>' : '') + '</body>';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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
  for await (const c of req) { raw += c; if (raw.length > 12 << 20) throw Object.assign(new Error('too large'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
}

/** A skill-switch failure in the person's own words: the engine's machinery never reaches the app. */
const skillWords = (message: string) => /not one of the reviewed starter skills/.test(message) ? message
  : /starting up|still starting|not ready|ECONNREFUSED|connect/i.test(message) ? 'The crew is starting up; skills switch once it is ready.'
  : /not a trusted skill|trust/i.test(message) ? 'That skill has not been reviewed yet, so the crew leaves it alone.'
  : 'That did not go through. Try again in a bit.';
/** Weak validator: same file (size and mtime) → the browser's copy is still good and the answer is a 304. */
const etagOf = (path: string) => { const st = statSync(path); return `W/"${st.size.toString(16)}.${Math.floor(st.mtimeMs).toString(16)}"`; };
/** Content-named bundles (scripts/build-web.mjs) never change, so they cache forever; the shell is revalidated each load. */
const FRESH_BUNDLE = /-[\w-]{8}\.(?:js|css)$/;

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
  const etag = etagOf(path);
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', etag,
    'cache-control': FRESH_BUNDLE.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(path).pipe(res);
}

/** HTTP + WebSocket on 127.0.0.1: the app API and the web UI. What it returns is plain words: no commands, paths or model ids. */
export async function startServer(cfg: Config, db: Store, crew: Crew) {
  const dist = join(cfg.repoDir, 'web', 'dist');
  const installing = new Set<string>();
  const teacher = new Teacher();
  /** "Done showing": the wheel goes back, and the bot gets the steps (and a few page pictures) to keep as a skill. */
  const shown = async (bot: string, keep: boolean) => {
    const s = teacher.stop(bot);
    if (!s) throw Object.assign(new Error('nothing is being shown'), { status: 409 });
    await crew.giveBack(bot).catch(() => {});
    if (!keep || !s.steps.length) return { steps: s.steps.length };
    await crew.post(bot, lesson(s.what, s.steps), undefined, s.shots);
    return { steps: s.steps.length };
  };
  /** Installs take minutes (the browser downloads Chromium) and run npm, pip and downloads one after another, so each
   *  runs as its own process (src/tools.ts's own command): crewd keeps answering meanwhile. The result arrives as an event. */
  const install = (id: string) => {
    if (installing.has(id)) return;
    installing.add(id);
    db.event('tool.installing', null, { tool: id });
    return new Promise<void>((resolve) => {
      const done = (ok: boolean) => { if (!installing.delete(id)) return; db.event(ok ? 'tool.installed' : 'tool.failed', null, { tool: id }); resolve(); };
      const child = spawn(process.execPath, [join(cfg.repoDir, 'src', 'tools.ts'), 'install', id], {
        // crewd's own folders, spelled out; none of the owner's desktop session (XDG_*, display) reaches the installers.
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(XDG_|WAYLAND_DISPLAY$|DISPLAY$|XAUTHORITY$)/.test(k))),
          CREWHOUSE_TOOLS_DIR: cfg.toolsDir, CREWHOUSE_STATE_DIR: cfg.stateDir, CREWHOUSE_CREW_DIR: cfg.crewDir }, stdio: ['ignore', 'inherit', 'inherit'] });
      child.on('exit', (code) => done(code === 0));
      child.on('error', (e) => { console.error(`install ${id}:`, e); done(false); });
    });
  };
  // The downloaded app has no setup step: on its first runs it fetches the helpers' own tools itself, one at a time,
  // while everything else already works. The browser, with its own Chromium, is the big one.
  const packaged = process.env.CREWHOUSE_PACKAGED === '1';
  if (packaged) void (async () => { for (const t of toolStatus(cfg).filter((x) => x.installable && !x.ready)) await install(t.id); })();
  // A newer release, from the project's public release list, once a day and only for the downloaded app: nothing of
  // yours is sent. You see "A new Crewhouse is ready" with its download page.
  let update: { version: string; url: string } | null = null;
  const version = JSON.parse(readFileSync(join(cfg.repoDir, 'package.json'), 'utf8')).version as string;
  const newer = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); return false; };
  const checkUpdate = () => fetch(process.env.CREWHOUSE_RELEASES || 'https://api.github.com/repos/umeranjum17/crewhouse/releases/latest', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null)).then((rel: any) => {
      const v = String(rel?.tag_name ?? '').replace(/^v/, '');
      update = /^\d+\.\d+\.\d+$/.test(v) && newer(v, version) ? { version: v, url: String(rel.html_url) } : null;
    }).catch(() => {});
  if (packaged || process.env.CREWHOUSE_RELEASES) { void checkUpdate(); setInterval(checkUpdate, 86_400_000).unref(); }
  const localHost = (h = '') => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);
  // Every paired phone uses the person's crew.
  const link = new Link(cfg, db, (m, path, body, key) => { const u = new URL(path, 'http://x'); return api(m, u.pathname, u.searchParams, body, key); });
  crew.phoneLink = link;
  link.desk = { signal: (bot, w, method, params, canControl) => crew.desktopSignal(bot, w, method, params, canControl), release: (w) => crew.desktops.release(w) };
  link.quiet = () => quietNow(crew.person().quiet);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    try {
      // DNS-rebinding guard: only answer requests addressed to loopback.
      if (!localHost(req.headers.host) || !/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress ?? '')) return send(res, 403, { error: 'loopback only' });

      if (p.startsWith('/api/')) {
        // Mutations need a custom header, which a cross-site page cannot send without a preflight we never allow.
        if (req.method !== 'GET' && req.headers['x-crewhouse'] !== '1') return send(res, 403, { error: 'missing x-crewhouse header' });
        // Phones: pairing and grants answer on this computer only, never over the phone link.
        if (p === '/api/phones' && req.method === 'GET') return send(res, 200, link.devices());
        if (p === '/api/phones/link' && req.method === 'GET') return send(res, 200, link.status());
        // Pairing always adds a phone to the person's crew.
        if (p === '/api/phones/pair' && req.method === 'POST') { const b = await readJson(req); return send(res, 200, await link.offer(b.role ?? 'control')); }
        if (p === '/api/phones/refresh' && req.method === 'POST') { const b = await readJson(req); return send(res, 200, await api(req.method, p, url.searchParams, b)); }
        if (p === '/api/phones/pending' && req.method === 'GET') return send(res, 200, link.status().asking);
        if (p === '/api/phones/approve' && req.method === 'POST') { link.approve(String((await readJson(req)).words ?? '')); return send(res, 200, { ok: true }); }
        if (p === '/api/phones/lan' && req.method === 'PUT') { await link.setLan(!!(await readJson(req)).on); return send(res, 200, link.status()); }
        if (p === '/api/phones/relay' && req.method === 'PUT') { const b = await readJson(req); link.setRelay(typeof b.url === 'string' ? b.url.trim() : null, typeof b.enrol === 'string' ? b.enrol : undefined); return send(res, 200, link.status()); }
        if (p === '/api/phones/code' && req.method === 'POST') { const b = await readJson(req); return send(res, 200, await link.typed(b.role ?? 'control')); }
        // A phone that scanned the code waits here: the person checks its two words and says yes or no.
        if (p === '/api/phones/answer' && req.method === 'POST') { const b = await readJson(req);
          if (b.offer !== undefined) {
            if (!link.status().asking.some((a) => a.id === Number(b.id) && a.offer === b.offer)) return send(res, 403, { error: 'that phone is not waiting for you' });
            if (crew.botPage('chief').phoneOffer?.token !== b.offer) return send(res, 409, { error: 'that code is no longer showing' });
          }
          link.answer(Number(b.id), b.yes === true); return send(res, 200, { ok: true }); }
        const phone = p.match(/^\/api\/phones\/([\w-]+)$/);
        if (phone && req.method === 'DELETE') { await link.revoke(phone[1]); return send(res, 200, { ok: true }); }
        return send(res, 200, await api(req.method!, p, url.searchParams, req.method === 'GET' ? {} : await readJson(req)));
      }

      // An app's sign-in page sends the browser back here; the tab says, in words, how it went.
      if (p === '/connect/callback') {
        const words = await crew.connections.finish(new URL(req.url!, `http://${cfg.host}:${cfg.port}`));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(resultPage('Crewhouse', words, /connected\./.test(words)));
      }

      const file = p.match(/^\/files\/([a-z0-9-]+)\/(.+)$/);
      if (file) {
        const rel = join('files', decodeURIComponent(file[2])); if (rel !== 'files' && !rel.startsWith('files/')) return send(res, 404, { error: 'no such file' });
        if (!crew.fileFor(file[1], rel)) return send(res, 403, { error: 'not delivered to you' });
        const full = disk.insideBot(cfg, file[1], rel);
        if (!existsSync(full)) return send(res, 404, { error: 'no such file' });
        return sendFile(req, res, full);
      }

      const asset = join(dist, p === '/' ? 'index.html' : p.replace(/\.\.+/g, ''));
      if (existsSync(asset) && statSync(asset).isFile()) return sendFile(req, res, asset);
      const index = join(dist, 'index.html');
      if (!existsSync(index)) return send(res, 503, { error: 'web UI not built: run ./crewhouse setup' });
      // A deep link serves the shell, which the browser revalidates on every load so an update shows on the next visit.
      const etag = etagOf(index);
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', etag });
      res.end(readFileSync(index));
    } catch (e: any) {
      send(res, e.status ?? 400, { error: e.message });
    }
  });

  /** The app API, shared by the web app (HTTP) and paired phones (the link). Every screen uses the person’s crew. */
  async function api(m: string, p: string, q: URLSearchParams, body: any, key?: string) {
    let r: RegExpMatchArray | null;
    // What is installing now, and a newer Crewhouse to download.
    if (m === 'GET' && p === '/api/state') return { ...crew.snapshot(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone, installing: [...installing], showing: teacher.showing(), ...(update ? { update } : {}) };
    if (m === 'GET' && p === '/api/events') return db.events(Number(q.get('after') || 0), 200);
    if (m === 'GET' && p === '/api/room') return crew.room(Number(q.get('before')) || undefined);
    // The one phone-admin call a paired phone makes itself: renewing the Add-a-phone code it is looking at, so the
    // card on the phone refreshes like the web card's.
    if (m === 'POST' && p === '/api/phones/refresh') {
      if (Object.hasOwn(body ?? {}, 'member')) throw Object.assign(new Error('Get the latest Crewhouse app to keep chatting.'), { status: 426 });
      return crew.refreshPhone(Number(body?.message));
    }
    // A sent photo for the phone, which can't open this computer's /files address: small enough for one link frame.
    if (m === 'GET' && p === '/api/photo') {
      const rel = String(q.get('path') ?? '');
      if (!/^files\/photos\/[\w.-]+\.(jpg|png|webp)$/.test(rel)) throw Object.assign(new Error('not a photo'), { status: 404 });
      const full = disk.insideBot(cfg, String(q.get('bot') ?? ''), rel);
      if (!existsSync(full) || statSync(full).size > 900_000) throw Object.assign(new Error('no such photo'), { status: 404 });
      const ext = extname(full).slice(1);
      return { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, data: readFileSync(full).toString('base64') };
    }
    // A delivered file as words for the app's read-only preview: crewd parses it, the app never opens the raw file.
    // A finished video comes in pieces for the phone, which can't reach this computer's /files address.
    const preview = async (re: RegExp, word: string, fn: (rel: string) => unknown) => {
      const rel = String(q.get('path') ?? '');
      if (!re.test(rel)) throw Object.assign(new Error(word), { status: 404 });
      return fn(rel);
    };
    if (m === 'GET' && p === '/api/workbook') return preview(/^files\/[\w./-]+\.xlsx$/i, 'not a spreadsheet', (rel) => crew.workbookView(String(q.get('bot') ?? ''), rel));
    if (m === 'GET' && p === '/api/document') return preview(/^files\/[\w./-]+\.(docx|md|txt)$/i, 'not a document', (rel) => crew.documentView(String(q.get('bot') ?? ''), rel));
    if (m === 'GET' && p === '/api/video') return preview(/^files\/[\w./-]+\.(mp4|webm|mov)$/i, 'not a video', (rel) => crew.videoSlice(String(q.get('bot') ?? ''), rel, Number(q.get('after')) || 0));
    if (m === 'POST' && p === '/api/onboard') { const b = body; return crew.onboard(b.address ?? '', b.ask, typeof b.bot === 'string' ? b.bot : undefined) ?? { ok: true }; }
    if (m === 'POST' && p === '/api/recruit') { const b = body; const { token, ...bot } = crew.recruit(b.template, b.name, 'person'); return bot; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)$/)) && m === 'GET') return crew.botPage(r[1], Number(q.get('around')) || undefined);
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/messages$/)) && m === 'POST') { const b = body; return crew.post(r[1], b.text ?? '', b.model, b.photos, b.room === true, key); }
    if ((r = p.match(/^\/api\/people\/(\d+)$/)) && m === 'PUT') return crew.updatePerson(body);
    if (m === 'GET' && p === '/api/accounts') {
      // The person's AI accounts: signed in or not (the engine's own local check), resting until when, and any sign-in in progress.
      // A work ChatGPT (Business, Enterprise, Edu) is flagged by its email, so the app can steer to a personal one.
      return Promise.all(Object.entries(PROVIDERS).map(async ([key, pr]) => {
        const signedIn = await crew.accounts.signedIn(key);
        return { account: key, name: pr.name, signedIn, restingUntil: crew.restingUntil(key), signIn: crew.accounts.view(key),
          notIncluded: crew.accounts.notIncluded(key), work: false };
      }));
    }
    // "Sign in with …": start (the page by default, `via: 'code'` for the code), paste the address the browser landed on,
    // cancel, sign out; "I've changed my plan" (retry).
    if ((r = p.match(/^\/api\/accounts\/(\d+)\/([a-z]+)\/(login|paste|cancel|logout|retry)$/)) && m === 'POST') {
      const [key, act] = [r[2], r[3]];
      provider(key);
      const b = body;
      if (act === 'login') return { ok: true, signIn: await crew.accounts.login(key, b.via === 'code' ? 'code' : 'browser', !!b.fresh) };
      else if (act === 'retry') crew.retryAccount(key);
      else if (act === 'paste') crew.accounts.paste(key, String(b.text ?? ''));
      else if (act === 'cancel') await crew.accounts.cancel(key);
      else await crew.accounts.logout(key);
      return { ok: true, signIn: crew.accounts.view(key) };
    }
    // Connections: the person's apps (Notion, Canva, Google…), connected on the app's own page (docs/ui-contract.md).
    if (m === 'GET' && p === '/api/connections') return crew.connections.list();
    // The "How I did it" drawer: one plain row per tool call of a task, recorded by crewd, redacted to words.
    if ((r = p.match(/^\/api\/task\/(\d+)\/trail$/)) && m === 'GET') {
      const id = Number(r[1]);
      const task = db.get('SELECT * FROM tasks WHERE id = ?', id);
      if (!task) throw Object.assign(new Error('no such task'), { status: 404 });
      return db.all("SELECT at, data FROM events WHERE kind = 'run.call' AND json_extract(data, '$.task') = ? ORDER BY seq", id)
        .map((e: any) => { const d = JSON.parse(e.data); let input = {}; try { input = JSON.parse(d.input ?? '{}'); } catch { /* unreadable input: words only */ }
          return { at: e.at, words: toolWords(d.tool, input) || `Used ${String(d.tool).replace(/_/g, ' ')}`, ok: d.ok !== false && !String(d.head ?? '').startsWith('error:') }; });
    }
    // What the engine learned from your work, and Forget.
    if (m === 'GET' && p === '/api/learned') return crew.runtime.learned ? crew.runtime.learned() : [];
    if ((r = p.match(/^\/api\/learned\/forget$/)) && m === 'POST') {
      if (body.id) await crew.runtime.forget?.(String(body.id), String(body.skill ?? ''));
      return { ok: true };
    }
    if (m === 'GET' && p === '/api/learning') return { on: await Promise.resolve(crew.learningOn()) };
    if ((r = p.match(/^\/api\/learning$/)) && m === 'POST') { await crew.setLearning(body.on === true); return { ok: true, on: body.on === true }; }
    // The reviewed starter skill set, its on/off as the engine sees it, and switching it the engine's own way.
    if (m === 'GET' && p === '/api/skills') return crew.starterSkills();
    if (m === 'GET' && p === '/api/skills/search') return { results: await crew.searchSkills(String(q.get('q') ?? '').slice(0, 80)) };
    if ((r = p.match(/^\/api\/skills\/([a-z0-9-]+)\/(on|off)$/)) && m === 'POST') {
      try { await crew.setStarter(r[1], r[2] === 'on'); return { ok: true }; }
      catch (e: any) { throw Object.assign(new Error(skillWords(String(e?.message ?? e))), { status: 400 }); }
    }
    // Switch Google on once: the personal Google app's client ID and secret.
    if (m === 'PUT' && p === '/api/house/google') {
      const b = body;
      await crew.connections.setHouseGoogle(b.id, b.secret);
      return { ok: true };
    }
    // The person sets the monthly money cap: helpers can never spend past it, however many yeses.
    if (m === 'PUT' && p === '/api/house/money') {
      crew.setMoneyCap(body.cap);
      return { cap: crew.moneyCap(), spent: crew.spentThisMonth() };
    }
    if ((r = p.match(/^\/api\/connections\/([a-z]+)$/))) {
      const app = r[1];
      if (m === 'POST') { const v = await crew.connections.connect(app); return v.state === 'done' ? { state: 'on' } : v.state === 'failed' ? Promise.reject(Object.assign(new Error(v.error), { status: 502 })) : { url: v.url }; }
      if (m === 'GET') return crew.connections.status(app);
      if (m === 'DELETE') { await crew.connections.cancel(app); return { ok: true }; }
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/models$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.setBrains(cfg, r[1], body.models);
      db.event('bot.models', r[1], { by: 'person' });
      return { thinks: crew.thinks(r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/job$/)) && m === 'PUT') {
      crew.botPage(r[1]);
      disk.writeJob(cfg, r[1], body);
      db.event('job.changed', r[1], { by: 'person' });
      return { job: disk.readJob(cfg, r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/job\/draft$/)) && m === 'POST') {
      const b = crew.botPage(r[1]).bot;
      const idea = String(body.idea ?? '').replace(/\r/g, '').trim();
      if (!idea || idea.length > 600) throw Object.assign(new Error('describe the job in under 600 characters'), { status: 400 });
      crew.requestChief(`Write ${b.display}'s job from: ${idea}. Use crew_job.`, idea);
      return { ok: true };
    }
    // What a helper learned about the person, and what the whole crew knows about them.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/notes$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      disk.writeNotes(cfg, { bot: r[1] }, body.text ?? '');
      db.event('memory.edited', r[1], { by: 'person' });
      return { ok: true };
    }
    if (p === '/api/about' && m === 'GET') return { notes: disk.readNotes(cfg, { bot: null }), cap: disk.ABOUT_CAP };
    if (p === '/api/about' && m === 'PUT') {
      disk.writeNotes(cfg, { bot: null }, body.text ?? '');
      db.event('memory.edited', null, { by: 'person', everyone: true });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/memory\/(\d+)\/undo$/)) && m === 'POST') {
      const e = db.get("SELECT * FROM events WHERE seq = ? AND bot = ? AND kind = 'memory.learned'", Number(r[2]), r[1]);
      if (!e) throw Object.assign(new Error('no such memory'), { status: 404 });
      const d = JSON.parse(e.data);
      if (db.get("SELECT 1 FROM events WHERE kind = 'memory.undone' AND json_extract(data, '$.seq') = ?", e.seq)) throw Object.assign(new Error('already undone'), { status: 409 });
      const commit = disk.forget(cfg, { bot: d.everyone ? null : r[1] }, { added: d.added ?? `- ${d.text}`, removed: d.removed ?? null, commit: d.commit ?? null });
      db.event('memory.undone', r[1], { seq: e.seq, text: d.text, commit });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/skills\/([a-z0-9-]+)$/)) && m === 'DELETE') {
      crew.botPage(r[1]); // 404 for unknown bots
      const k = disk.archiveSkill(cfg, r[1], r[2]);
      db.event('skill.removed', r[1], { name: k.name, says: k.says });
      return { ok: true };
    }
    // Who a helper is: the person writes it, a bot never does. "Put back" is the template's, under the helper's own name.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/soul$/)) && m === 'PUT') {
      crew.botPage(r[1]); // 404 for unknown bots
      const prev = disk.readSoul(cfg, r[1]);
      disk.writeSoul(cfg, r[1], body.text ?? '');
      db.event('soul.changed', r[1], { by: 'person', prev });
      return { soul: disk.readSoul(cfg, r[1]) };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/soul\/reset$/)) && m === 'POST') {
      const { bot: b, soul: prev } = crew.botPage(r[1]);
      disk.writeSoul(cfg, r[1], disk.templateSoul(cfg, disk.loadTemplate(cfg, b.template), b.display), 'Put back how it started');
      db.event('soul.changed', r[1], { by: 'person', reset: true, prev });
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
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/read$/)) && m === 'POST') { crew.read(r[1]); return { ok: true }; }
    if (m === 'GET' && p === '/api/search') return crew.search(q.get('q') ?? '');
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/steer$/)) && m === 'POST') { crew.steer(r[1], String(body.text ?? '')); return { ok: true }; }
    if ((r = p.match(/^\/api\/tools\/([a-z0-9-]+)\/install$/)) && m === 'POST') {
      if (installing.has(r[1])) return { ok: true, already: true };
      void install(r[1]);
      return { ok: true };
    }
    // Teach by showing: take the wheel with a recorder on, then Done (keep it) or Cancel.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/show$/)) && m === 'POST') {
      const b = crew.bot(r[1]);
      if (!b) throw Object.assign(new Error('no such bot'), { status: 404 });
      if (!disk.canUse(cfg, b.id, 'computer')) throw Object.assign(new Error(`${b.display} has no computer of its own to show it on`), { status: 409 });
      const what = String(body.what ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!what) throw Object.assign(new Error('say in a few words what you are showing'), { status: 400 });
      const desk = await crew.desktops.ensure(b.id, disk.botDir(cfg, b.id));
      if (!desk.cdp) throw Object.assign(new Error(`${b.display}'s computer has no browser to show it on`), { status: 409 });
      await crew.takeOver(b.id);
      const bot = b.id;
      await teacher.start(bot, what, desk.cdp, () => void shown(bot, true).catch(() => {}));
      db.event('teach.started', bot, { what });
      return { ok: true };
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/shown$/)) && m === 'POST') {
      const out = await shown(r[1], body.keep !== false);
      db.event('teach.done', r[1], { steps: out.steps, kept: body.keep !== false });
      return out;
    }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/takeover$/)) && m === 'POST') { await crew.takeOver(r[1]); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/giveback$/)) && m === 'POST') {
      await crew.giveBack(r[1], String(body.note ?? ''), Array.isArray(body.keep) ? body.keep.map(String) : undefined);
      return { ok: true };
    }
    // The give-back sheet's ticks: the hosts on its tabs, read only while the person holds the wheel.
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/screen$/)) && m === 'GET') return { pages: await crew.tabHosts(r[1]) };
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/forget$/)) && m === 'POST') { await crew.forget(r[1], String(body.host ?? '')); return { ok: true }; }
    if ((r = p.match(/^\/api\/bots\/([a-z0-9-]+)\/reset$/)) && m === 'POST') { await crew.resetBot(r[1]); return { ok: true }; }
    if (m === 'GET' && p === '/api/schedule') {
      const when = parseSchedule(q.get('text') ?? '');
      const next = nextRun(when, Date.now());
      // `first` is the computer's own clock, so the card and the preview read the same words everywhere; `zone` lets a
      // screen away from home name the time zone (and only then).
      return { words: describe(when), next, first: firstRun(next), guessed: 'guessed' in when && when.guessed === true, zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
    if (m === 'POST' && p === '/api/routines') { const row = crew.addRoutine(body, 'person'); return crew.routines().find((x) => x.id === row.id); }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'PUT') { crew.updateRoutine(Number(r[1]), body); return { ok: true }; }
    if ((r = p.match(/^\/api\/routines\/(\d+)$/)) && m === 'DELETE') { crew.deleteRoutine(Number(r[1])); return { ok: true }; }
    // A run reports from crewd's own record (Crew.runRoutine), not from this call returning.
    if ((r = p.match(/^\/api\/routines\/(\d+)\/run$/)) && m === 'POST') { await crew.runRoutine(Number(r[1])); return { ok: true }; }
    if ((r = p.match(/^\/api\/asks\/(\d+)\/answer$/)) && m === 'POST') { await crew.answer(Number(r[1]), body, key); return { ok: true }; }
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
