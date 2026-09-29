// A shortcut or control on the phone (targets/actions) opens crewhouse://ask?to=<helper template>&text=<words>.
// The words go in that helper's box, never sent; with no such helper in the crew they go in Chief's.
export type Ask = { chat: string; text: string };

export function askOf(url: string, crew: { id: string; template?: string }[]): Ask | null {
  const m = /^crewhouse:\/\/ask\/?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const q = Object.fromEntries((m[1] ?? '').split('&').filter(Boolean).map((kv) => {
    const i = kv.includes('=') ? kv.indexOf('=') : kv.length;
    try { return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; } catch { return [kv.slice(0, i), '']; }
  }));
  const h = crew.find((c) => c.template === q.to);
  return { chat: h?.id ?? 'chief', text: q.text ?? '' };
}
