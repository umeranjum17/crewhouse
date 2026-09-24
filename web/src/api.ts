// The whole client contract with crewd. Framework-free so the Expo app can reuse it.
export type Json = any;

async function call(method: string, path: string, body?: Json) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-crewhouse': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

export const api = {
  state: () => call('GET', '/api/state'),
  bot: (id: string) => call('GET', `/api/bots/${id}`),
  post: (id: string, text: string) => call('POST', `/api/bots/${id}/messages`, { text }),
  onboard: (address: string) => call('POST', '/api/onboard', { address }),
  recruit: (template: string, name: string) => call('POST', '/api/recruit', { template, name }),
  notes: (id: string, text: string) => call('PUT', `/api/bots/${id}/notes`, { text }),
  tools: (id: string, tools: string[]) => call('PUT', `/api/bots/${id}/tools`, { tools }),
  install: (tool: string) => call('POST', `/api/tools/${tool}/install`),
  models: (id: string, models: string[]) => call('PUT', `/api/bots/${id}/models`, { models }),
  reset: (id: string) => call('POST', `/api/bots/${id}/reset`),
  takeOver: (id: string) => call('POST', `/api/bots/${id}/takeover`),
  giveBack: (id: string, note: string) => call('POST', `/api/bots/${id}/giveback`, { note }),
  answer: (ask: number, body: { answer?: string; keys?: string[]; text?: string }) => call('POST', `/api/asks/${ask}/answer`, body),
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
