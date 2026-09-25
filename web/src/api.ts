// The whole client contract with crewd. Framework-free so the Expo app can reuse it.
export type Json = any;

/** Which household member is using this screen: picks whose threads, questions and accounts crewd returns. */
let member = 1;
export const setMember = (id: number) => { member = id; };

/** `?demo` runs the screens on a made-up household (web/src/demo.ts): for design review and screenshots. */
export const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

async function call(method: string, path: string, body?: Json) {
  if (demo) return (await import('./demo.ts')).demoCall(method, path, body);
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-crewhouse': '1', 'x-crewhouse-member': String(member) },
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
  bot: (id: string) => call('GET', `/api/bots/${id}`),
  post: (id: string, text: string) => call('POST', `/api/bots/${id}/messages`, { text }),
  onboard: (address: string) => call('POST', '/api/onboard', { address }),
  recruit: (template: string, name: string) => call('POST', '/api/recruit', { template, name }),
  notes: (id: string, text: string) => call('PUT', `/api/bots/${id}/notes`, { text }),
  settings: (id: string, body: { allow?: string[]; memory?: boolean }) => call('PUT', `/api/bots/${id}/settings`, body),
  reset: (id: string) => call('POST', `/api/bots/${id}/reset`),
  undoMemory: (id: string, seq: number) => call('POST', `/api/bots/${id}/memory/${seq}/undo`),
  takeOver: (id: string) => call('POST', `/api/bots/${id}/takeover`),
  giveBack: (id: string, note: string) => call('POST', `/api/bots/${id}/giveback`, { note }),
  people: () => call('GET', '/api/people'),
  addPerson: (name: string) => call('POST', '/api/people', { name }),
  person: (id: number, body: { name?: string; address?: string; quiet?: string | null }) => call('PUT', `/api/people/${id}`, body),
  accounts: () => call('GET', '/api/accounts'),
  /** "Sign in with ChatGPT": a one-time code to type on its page, which works from any phone or computer. */
  signIn: (member: number, account: string) => call('POST', `/api/accounts/${member}/${account}/login`, { via: 'code' }),
  signInCancel: (member: number, account: string) => call('POST', `/api/accounts/${member}/${account}/cancel`),
  signOut: (member: number, account: string) => call('POST', `/api/accounts/${member}/${account}/logout`),
  schedule: (text: string) => call('GET', `/api/schedule?text=${encodeURIComponent(text)}`),
  addRoutine: (body: { bot: string; schedule: string; task: string; model?: string; name?: string }) => call('POST', '/api/routines', body),
  routine: (id: number, body: { state?: 'on' | 'paused'; schedule?: string }) => call('PUT', `/api/routines/${id}`, body),
  runRoutine: (id: number) => call('POST', `/api/routines/${id}/run`),
  removeRoutine: (id: number) => call('DELETE', `/api/routines/${id}`),
  // Phones are still wanted (docs/ui-contract.md); the screens show "coming soon" until crewd answers them.
  phones: () => call('GET', '/api/phones'),
  pairPhone: () => call('POST', '/api/phones/pair'),
  connect: (app: string) => call('POST', `/api/connections/${app}`),
  connection: (app: string) => call('GET', `/api/connections/${app}`),
  disconnect: (app: string) => call('DELETE', `/api/connections/${app}`),
  answer: (ask: number, body: { answer: 'allow' | 'deny'; scope?: 'once' | 'task' | 'always' }) => call('POST', `/api/asks/${ask}/answer`, body),
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
  if (demo) return () => {};
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
