// A shortcut or control on the phone (targets/actions) opens crewhouse://ask?to=<helper template>&text=<words>.
// The words go in Chief's box, never sent: he is the only one the person talks to. A named helper leads the words
// ("Scout: …"), so Chief hands them on to that helper once the person sends them.
export type Ask = { chat: 'chief'; text: string };

export function askOf(url: string, crew: { id: string; template?: string; name?: string }[]): Ask | null {
  const m = /^crewhouse:\/\/ask\/?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const q = Object.fromEntries((m[1] ?? '').split('&').filter(Boolean).map((kv) => {
    const i = kv.includes('=') ? kv.indexOf('=') : kv.length;
    try { return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))]; } catch { return [kv.slice(0, i), '']; }
  }));
  const h = crew.find((c) => c.template === q.to);
  return { chat: 'chief', text: h?.name ? `${h.name}: ${q.text ?? ''}` : q.text ?? '' };
}

/** Text picked in another app ("Ask Crewhouse", modules/crewhouse-net AskActivity) opens crewhouse://share?text=<words>:
 *  the share screen, words in its box, for Chief. */
export function sharedOf(url: string): string | null {
  const m = /^crewhouse:\/\/share\/?\?text=([^&]*)$/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
