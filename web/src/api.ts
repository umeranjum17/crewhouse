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
  reset: (id: string) => call('POST', `/api/bots/${id}/reset`),
  answer: (ask: number, body: { answer?: string; keys?: string[]; text?: string }) => call('POST', `/api/asks/${ask}/answer`, body),
};

/** Live events; reconnects forever. Returns a stop function. */
export function subscribe(onEvent: (e: Json) => void) {
  let ws: WebSocket | undefined, stopped = false;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (m) => onEvent(JSON.parse(m.data));
    ws.onclose = () => { if (!stopped) setTimeout(open, 1500); };
    ws.onopen = () => onEvent({ kind: 'connected' });
  };
  open();
  return () => { stopped = true; ws?.close(); };
}
