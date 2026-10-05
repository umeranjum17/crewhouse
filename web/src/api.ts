// The whole client contract with crewd. Framework-free so the Expo app can reuse it.
export type Json = any;


/** `?demo` runs the screens on a personal assistant demo (web/src/demo.ts): for design review and screenshots. */
export const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

/** How a call reaches crewd: HTTP on this computer; the phone app swaps in its encrypted link. */
export type Transport = (method: string, path: string, body?: Json) => Promise<Json>;
let call: Transport = http;
export function setTransport(t: Transport) { call = t; }

async function http(method: string, path: string, body?: Json) {
  if (demo) return (await import('./demo.ts')).demoCall(method, path, body);
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-crewhouse': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error ?? `HTTP ${res.status}`), { status: res.status });
  return out;
}

/** What went wrong, in the three ways a screen cares about: the home computer is unreachable, crewd doesn't do that yet, or it failed. */
export const trouble = (e: any): 'offline' | 'missing' | 'failed' => (e?.status === 404 ? 'missing' : !e?.status ? 'offline' : 'failed');

export const api = {
  state: () => call('GET', '/api/state'),
  room: (before?: number) => call('GET', `/api/room${before ? `?before=${before}` : ''}`),
  bot: (id: string, around?: number) => call('GET', `/api/bots/${id}${around ? `?around=${around}` : ''}`),
  /** The person has read this chat up to now: its unread dot goes. */
  read: (id: string) => call('POST', `/api/bots/${id}/read`),
  /** Words across the person's own chats and finished things. */
  search: (q: string) => call('GET', `/api/search?q=${encodeURIComponent(q)}`),
  /** `photos`: up to four, each `{type: 'image/jpeg' | 'image/png' | 'image/webp', data: base64}`. */
  /** A photo someone sent, as data: the phone shows it without opening this computer's own address. */
  photo: (bot: string, path: string) => call('GET', `/api/photo?bot=${encodeURIComponent(bot)}&path=${encodeURIComponent(path)}`) as Promise<{ type: string; data: string }>,
  /** A delivered spreadsheet, read by crewd itself: its tabs, headings and first rows, as words only. */
  workbook: (bot: string, path: string) => call('GET', `/api/workbook?bot=${encodeURIComponent(bot)}&path=${encodeURIComponent(path)}`) as Promise<Json>,
  /** A delivered document, read by crewd itself: its headings, paragraphs, lists and tables, as words only. */
  document: (bot: string, path: string) => call('GET', `/api/document?bot=${encodeURIComponent(bot)}&path=${encodeURIComponent(path)}`) as Promise<Json>,
  /** A finished video in pieces for the phone, which can't reach this computer's /files address: base64 slices
   *  `{data, more, size}` from byte `after`. */
  video: (bot: string, path: string, after: number) => call('GET', `/api/video?bot=${encodeURIComponent(bot)}&path=${encodeURIComponent(path)}&after=${after}`) as Promise<{ data: string; more: boolean; size: number }>,
  /** `photos`: up to four, each `{type: 'image/jpeg' | 'image/png' | 'image/webp', data: base64}`. `said` is what the
   *  person wrote, when the ask the helper reads is not their own words (the bubble builds one): the thread shows
   *  `said`, the helper gets `text`. */
  post: (id: string, text: string, photos?: { type: string; data: string }[] | { room: boolean }, said?: string) => call('POST', `/api/bots/${id}/messages`, { text, ...(said ? { said } : {}), ...(Array.isArray(photos) && photos.length ? { photos } : {}), ...(!Array.isArray(photos) && photos ? photos : {}) }),
  /** A word to a helper's running job: it reads it after its current step, without starting over. */
  steer: (id: string, text: string) => call('POST', `/api/bots/${id}/steer`, { text }),
  /** First run: how Chief addresses the person, and (from an idea card) their first request, in one tap.
   *  A goal card also names its helper, so the request starts there instead of with Chief. */
  onboard: (address: string, ask?: string, bot?: string) => call('POST', '/api/onboard', { address, ask, bot }),
  recruit: (template: string, name: string) => call('POST', '/api/recruit', { template, name }),
  /** What one helper learned about the person, and what the whole crew knows about them. */
  notes: (id: string, text: string) => call('PUT', `/api/bots/${id}/notes`, { text }),
  about: () => call('GET', '/api/about'),
  setAbout: (text: string) => call('PUT', '/api/about', { text }),
  /** Who a helper is, in the person's words; `soulReset` puts back how it started. */
  job: (id: string, parts: Json) => call('PUT', `/api/bots/${id}/job`, parts),
  draftJob: (id: string, idea: string) => call('POST', `/api/bots/${id}/job/draft`, { idea }),
  soul: (id: string, text: string) => call('PUT', `/api/bots/${id}/soul`, { text }),
  soulReset: (id: string) => call('POST', `/api/bots/${id}/soul/reset`),
  /** Put away a skill a helper learned (it is kept, just no longer used). */
  removeSkill: (id: string, name: string) => call('DELETE', `/api/bots/${id}/skills/${name}`),
  settings: (id: string, body: { allow?: string[]; memory?: boolean; handoff?: 'ask' | 'go' }) => call('PUT', `/api/bots/${id}/settings`, body),
  reset: (id: string) => call('POST', `/api/bots/${id}/reset`),
  /** A review card's Start again: the same job and the same session, its findings still in hand. */
  again: (id: string, task: number) => call('POST', `/api/bots/${id}/task/${task}/again`),
  undoMemory: (id: string, seq: number) => call('POST', `/api/bots/${id}/memory/${seq}/undo`),
  /** How one job was done, step by step, in plain words — recorded by crewd, on demand. */
  taskTrail: (id: number) => call('GET', `/api/task/${id}/trail`) as Promise<{ at: number; words: string; ok: boolean }[]>,
  /** What the engine learned from the person's work, and Forget for one of them. */
  learned: () => call('GET', '/api/learned') as Promise<{ id: string; skill: string; at: number; state: string }[]>,
  forgetLearned: (id: string, skill: string) => call('POST', '/api/learned/forget', { id, skill }),
  /** "Learn from how I work": the engine's own learning switch. */
  learning: () => call('GET', '/api/learning') as Promise<{ on: boolean }>,
  setLearning: (on: boolean) => call('POST', '/api/learning', { on }),
  takeOver: (id: string) => call('POST', `/api/bots/${id}/takeover`),
  /** Teach by showing: take the wheel with a recorder on; then Done (the bot keeps it as a skill) or Cancel. */
  show: (id: string, what: string) => call('POST', `/api/bots/${id}/show`, { what }),
  shown: (id: string, keep: boolean) => call('POST', `/api/bots/${id}/shown`, { keep }),
  giveBack: (id: string, note: string, keep?: string[]) => call('POST', `/api/bots/${id}/giveback`, { note, keep }),
  /** The hosts on its tabs, for the give-back sheet — only while the person holds the wheel. */
  pages: async (id: string): Promise<string[]> => (await call('GET', `/api/bots/${id}/screen`)).pages ?? [],
  /** Take a site back off its signed-in list, and clear it from its browser. */
  forget: (id: string, host: string) => call('POST', `/api/bots/${id}/forget`, { host }),
  person: (id: number, body: { name?: string; address?: string; quiet?: string | null; share?: string }) => call('PUT', `/api/people/${id}`, body),
  accounts: () => call('GET', '/api/accounts'),
  /** "Sign in with ChatGPT": its own page, which comes straight back to the home computer. `via: 'code'` is the fallback;
   *  `fresh` asks ChatGPT's page which account again ("Use my personal account"). */
  signIn: (account: string, body: { via?: 'code'; fresh?: boolean } = {}) => call('POST', `/api/accounts/1/${account}/login`, body),
  retryAccount: (account: string) => call('POST', `/api/accounts/1/${account}/retry`),
  /** The person switches Google on for their crew: their own Google app's client ID and secret (docs/google-setup.md). */
  houseGoogle: (id: string, secret: string) => call('PUT', '/api/house/google', { id, secret }),
  /** Owner only: the most helpers may spend in a month, in dollars. */
  moneyCap: (cap: number) => call('PUT', '/api/house/money', { cap }),
  signInCancel: (account: string) => call('POST', `/api/accounts/1/${account}/cancel`),
  signOut: (account: string) => call('POST', `/api/accounts/1/${account}/logout`),
  schedule: (text: string) => call('GET', `/api/schedule?text=${encodeURIComponent(text)}`),
  routine: (id: number, body: { state?: 'on' | 'paused'; schedule?: string; quiet?: boolean }) => call('PUT', `/api/routines/${id}`, body),
  runRoutine: (id: number) => call('POST', `/api/routines/${id}/run`),
  removeRoutine: (id: number) => call('DELETE', `/api/routines/${id}`),
  // Phones: this computer only; crewd refuses these over the phone link.
  phones: () => call('GET', '/api/phones'),
  phoneLink: () => call('GET', '/api/phones/link'),
  pairPhone: (role: 'control' | 'view' = 'control') => call('POST', '/api/phones/pair', { role }),
  refreshPhone: (message: number) => call('POST', '/api/phones/refresh', { message }),
  removePhone: (id: string) => call('DELETE', `/api/phones/${id}`),
  /** The person's yes or no for a phone that scanned the code; both screens show the same two words. */
  answerPhone: (id: number, yes: boolean, offer?: string) => call('POST', '/api/phones/answer', { id, yes, offer }),
  phonesAtHome: (on: boolean) => call('PUT', '/api/phones/lan', { on }),
  /** The relay phones reach this computer through from anywhere ('' off, null back to the default), and a one-use invitation. */
  phoneRelay: (url: string | null, enrol?: string) => call('PUT', '/api/phones/relay', { url, enrol }),
  /** Codes to type on the phone instead of scanning, through the relay. */
  phoneCode: (role: 'control' | 'view' = 'control') => call('POST', '/api/phones/code', { role }),
  connect: (app: string) => call('POST', `/api/connections/${app}`),
  connection: (app: string) => call('GET', `/api/connections/${app}`),
  disconnect: (app: string) => call('DELETE', `/api/connections/${app}`),
  answer: (ask: number, body: { answer: 'allow' | 'deny'; scope?: 'once' | 'task' | 'always'; text?: string; remind?: boolean }) => call('POST', `/api/asks/${ask}/answer`, body),
  skills: () => call('GET', '/api/skills'),
  skillSearch: (q: string) => call('GET', `/api/skills/search?q=${encodeURIComponent(q)}`),
  skillSwitch: (slug: string, on: boolean) => call('POST', `/api/skills/${slug}/${on ? 'on' : 'off'}`, {}),
};

const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

/**
 * desklink's `Signaling` for one bot's screen, over its own socket to crewd. crewd picks the display and the
 * permissions; closing the socket ends the session.
 */
export function desktopSignaling(bot: string) {
  const ws = new WebSocket(`${wsBase()}/ws/desktop/${bot}`);
  const open = new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('could not reach Crewhouse')); });
  const pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  const handlers = new Set<(e: Json) => void>();
  let next = 1;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.event) return handlers.forEach((h) => h(msg.event));
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
    else p?.resolve(msg.result);
  };
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('lost touch with Crewhouse')); pending.clear(); };
  return {
    async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
      await open;
      const id = next++;
      return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    },
    subscribe(handler: (e: Json) => void) { handlers.add(handler); return () => { handlers.delete(handler); }; },
    close() { ws.close(); },
  };
}

/** Live events; reconnects forever. Returns a stop function. */
export function subscribe(onEvent: (e: Json) => void) {
  if (demo) { let stop = () => {}; void import('./demo.ts').then((m) => { stop = m.demoLive(onEvent); }); return () => stop(); }
  let ws: WebSocket | undefined, stopped = false;
  const open = () => {
    ws = new WebSocket(`${wsBase()}/ws`);
    ws.onmessage = (m) => onEvent(JSON.parse(m.data));
    ws.onclose = () => { if (!stopped) setTimeout(open, 1500); };
    ws.onopen = () => onEvent({ kind: 'connected' });
  };
  open();
  return () => { stopped = true; ws?.close(); };
}
