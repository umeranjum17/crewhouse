// Teach a task by showing it: while the person drives a bot's own Chromium ("Show Reel how"), crewd watches that browser
// over its debugging port and writes down what they did, in plain words: pages opened, what they clicked by its visible
// label, which field they typed in by its label. Never what they typed, and nothing at all from a password field.
// One screenshot per page. The bot then gets the steps (and the first screenshots) and keeps them as a skill on the
// person's yes. Nothing here involves the model.
import { WebSocket } from 'ws';

/** What the page script reports; `label` is the element's visible name, never its value. */
export type Raw = { kind: 'open'; url: string } | { kind: 'click' | 'fill' | 'choose'; label: string };

const MAX_STEPS = 60;
export const SHOW_MS = 15 * 60_000;

/** The page's side, injected into every page of the bot's browser: labels only, and never inside a password field. */
const PAGE = `(() => {
  if (window.__crewhouseShow) return; window.__crewhouseShow = true;
  const text = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const labelOf = (el) => {
    if (!el) return '';
    const byId = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    return text(el.getAttribute('aria-label') || (byId && byId.innerText) || (el.closest('label') && el.closest('label').innerText)
      || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.innerText || el.value && el.type === 'submit' && el.value || el.name || '');
  };
  const secret = (el) => el && (el.type === 'password' || /pass|pin|otp|cvv|cvc|card.?num/i.test(el.name || el.id || el.autocomplete || ''));
  const say = (m) => { try { window.__crewhouseStep(JSON.stringify(m)); } catch (e) {} };
  addEventListener('click', (e) => {
    const el = e.target && e.target.closest && e.target.closest('a,button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],input[type=checkbox],input[type=radio],summary,label');
    if (!el || secret(el)) return;
    const label = labelOf(el); if (label) say({ kind: 'click', label });
  }, true);
  addEventListener('change', (e) => {
    const el = e.target; if (!el || secret(el)) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'select') return say({ kind: 'choose', label: labelOf(el) || 'a list' });
    if (tag === 'textarea' || (tag === 'input' && !/^(checkbox|radio|submit|button|file|hidden)$/.test(el.type))) say({ kind: 'fill', label: labelOf(el) || 'a box' });
  }, true);
})();`;

/** The steps in the person's words, repeats folded ("Typed in “Search”" once, however many keys). */
export function stepsOf(raw: Raw[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    let s = '';
    if (r.kind === 'open') {
      try { const u = new URL(r.url); if (!/^https?:$/.test(u.protocol)) continue; s = `Opened ${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')}`; } catch { continue; }
    } else if (r.kind === 'click') s = `Clicked “${r.label}”`;
    else if (r.kind === 'fill') s = `Typed in “${r.label}”`;
    else s = `Chose an option in “${r.label}”`;
    if (out.at(-1) !== s) out.push(s);
  }
  return out.slice(0, MAX_STEPS);
}

type Showing = { bot: string; what: string; raw: Raw[]; shots: { type: string; data: string }[]; seen: Set<string>; sockets: WebSocket[]; timer: NodeJS.Timeout; poll: NodeJS.Timeout; at: number };

/** The shows in progress, one per bot. */
export class Teacher {
  private shows = new Map<string, Showing>();

  showing() { return Object.fromEntries([...this.shows].map(([bot, s]) => [bot, { what: s.what, steps: stepsOf(s.raw).length }])); }
  has(bot: string) { return this.shows.has(bot); }

  /** Start watching the bot's browser on its debugging port. `onTimeout` ends a show left running for 15 minutes. */
  start(bot: string, what: string, cdp: number, onTimeout: () => void) {
    this.stop(bot);
    const s: Showing = { bot, what, raw: [], shots: [], seen: new Set(), sockets: [], at: Date.now(),
      timer: setTimeout(onTimeout, SHOW_MS), poll: setInterval(() => void this.attach(s, cdp), 1000) };
    this.shows.set(bot, s);
    return this.attach(s, cdp);
  }

  /** End the show: its steps in plain words and up to four page pictures. */
  stop(bot: string) {
    const s = this.shows.get(bot);
    if (!s) return null;
    this.shows.delete(bot);
    clearTimeout(s.timer); clearInterval(s.poll);
    for (const ws of s.sockets) ws.close();
    return { what: s.what, steps: stepsOf(s.raw), shots: s.shots.slice(0, 4) };
  }

  /** Every page the browser has open: listen to it once. */
  private async attach(s: Showing, cdp: number) {
    const list = await fetch(`http://127.0.0.1:${cdp}/json/list`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json(), () => []) as any[];
    for (const t of list.filter((x) => x.type === 'page' && x.webSocketDebuggerUrl && !s.seen.has(x.id))) {
      if (!this.shows.has(s.bot)) return;
      s.seen.add(t.id);
      await this.listen(s, t.webSocketDebuggerUrl, t.url);
    }
  }

  /** Resolves once the page is being listened to, so nothing the person does after Start is missed. */
  private listen(s: Showing, url: string, first: string) {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    s.sockets.push(ws);
    let n = 0;
    const pending = new Map<number, (r: any) => void>();
    const call = (method: string, params: object = {}) => new Promise<any>((resolve) => { const id = ++n; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const opened = (u: string) => {
      if (/^(about|chrome|devtools|data):/.test(u)) return;
      s.raw.push({ kind: 'open', url: u });
      // A picture of each page once it has drawn, for the bot to look at alongside the steps.
      setTimeout(() => void call('Page.captureScreenshot', { format: 'jpeg', quality: 50 }).then((r) => {
        if (r?.data && s.shots.length < 8) s.shots.push({ type: 'image/jpeg', data: r.data });
      }), 1200);
    };
    const ready = new Promise<void>((resolve) => ws.on('open', async () => {
      await call('Runtime.enable');
      await call('Page.enable');
      await call('Runtime.addBinding', { name: '__crewhouseStep' });
      await call('Page.addScriptToEvaluateOnNewDocument', { source: PAGE });
      await call('Runtime.evaluate', { expression: PAGE });
      opened(first);
      resolve();
    }));
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.id) { pending.get(m.id)?.(m.result); pending.delete(m.id); return; }
      if (s.raw.length >= MAX_STEPS * 4) return;
      if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) opened(m.params.frame.url);
      if (m.method === 'Runtime.bindingCalled' && m.params.name === '__crewhouseStep') {
        try {
          const r = JSON.parse(m.params.payload);
          if (['click', 'fill', 'choose'].includes(r.kind) && typeof r.label === 'string' && r.label.trim()) s.raw.push({ kind: r.kind, label: r.label.slice(0, 60) });
        } catch { /* not ours */ }
      }
    });
    ws.on('error', () => {});
    return Promise.race([ready, new Promise<void>((r) => setTimeout(r, 3000))]);
  }
}

/** What the bot is told after a show: the steps, and to keep them as a skill (its card is the person's yes). */
export function lesson(what: string, steps: string[]) {
  return `I showed you how to ${what.replace(/[.!?\s]+$/, '')}. Here is what I did, step by step:\n` +
    steps.map((s, i) => `${i + 1}. ${s}`).join('\n') +
    '\nPlease keep this as one of your skills (ask me with crew_learn, in plain steps), then do it once now so I can see it works.';
}
