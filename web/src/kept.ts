// What the phone app keeps so its person can still read recent chats while the home computer is asleep: the last
// home screen and the newest lines of each chat, for a week. Read-only; it never answers anything. Framework-free,
// so the tests run it (test/unit.test.ts); mobile/src/link.ts reads and writes the file and wipes it with the grant.
import type { Json } from './api.ts';

export const WEEK = 7 * 86_400_000;
export const LINES = 50;
export type Kept = { v: 1; host: string; at: number; state: Json; chats: Record<string, { at: number; messages: Json[] }> };

export const empty = (host: string): Kept => ({ v: 1, host, at: 0, state: null, chats: {} });

/** Only what is still fresh and belongs to this computer; anything else reads as nothing kept. */
export function fresh(k: Json, host: string, now = Date.now()): Kept {
  if (k?.v !== 1 || k.host !== host) return empty(host);
  const chats = Object.fromEntries(Object.entries(k.chats as Kept['chats']).filter(([, c]) => now - c.at < WEEK)
    .map(([id, c]) => [id, { at: c.at, messages: c.messages.filter((m) => now - m.at < WEEK) }]));
  return now - k.at < WEEK ? { ...k, chats } : { ...empty(host), chats };
}

export const keepState = (k: Kept, state: Json, now = Date.now()): Kept => ({ ...k, at: now, state });
/** A chat page from the computer: only its newest lines, never its notes, files or trail. */
export const keepChat = (k: Kept, id: string, page: Json, now = Date.now()): Kept =>
  ({ ...k, chats: { ...k.chats, [id]: { at: now, messages: (page?.messages ?? []).slice(-LINES) } } });
