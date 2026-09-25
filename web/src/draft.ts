// The unsent words each chat holds on to: a failed send or a stray tap never throws away what someone typed.
// Framework-free, so the web and phone composers share it (mobile/App.tsx imports it like adapter.ts).
export type Hold = { text: string };

const kept = new Map<string, Hold>();

/** What this chat is holding unsent: the box starts from this. */
export const draftOf = (chat: string): Hold => kept.get(chat) ?? { text: '' };

/** The box changed: the chat keeps exactly what's in it now ('' clears the hold). */
export const keepDraft = (chat: string, text: string) => { text ? kept.set(chat, { text }) : kept.delete(chat); };

/** One send try: it went out, or it didn't. Only a sent message empties the hold. */
export function sent(chat: string, ok: boolean, text: string) {
  if (ok) kept.delete(chat);
  else keepDraft(chat, text);
}
