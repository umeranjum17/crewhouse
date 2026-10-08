# Reply fold (More / Less)

A long chat reply (over 700 characters or 10 lines) folds behind **More** (`ChatText`, `web/src/parts.tsx`).
The fold cuts near 650 characters; a cut that lands inside a list item drops that item, so the folded
reply ends on whole items, never an empty or half-cut bullet.

## Drive

The stub echoes at most 60 characters, so seed the long reply after a real send: post any message to
`/api/bots/chief/messages`, wait for the `stub chief` reply, then insert one `messages` row for `chief`
with that reply's `author` and a 12+ item bullet list whose plain 650-character cut ends on a bare `-`
(one item long enough to wrap). Open `/` (Chief's thread is Home) and wait for `.chat-more`.

## Prove

- `eval` the last `li` in each folded `.chat-md`: its text is non-empty and is a whole item.
- Captures, folded and after More, dark and light, at 390 and 1440, with `.chat-more` scrolled into view
  (on the phone the thread scrolls in its own column, under the composer).
- One recording of More then Less; the second eval after Less matches the first.
