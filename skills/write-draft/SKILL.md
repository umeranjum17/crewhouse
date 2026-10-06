---
name: write-draft
description: Write a full draft of an X post or reply, a LinkedIn post or a Reddit-style post in the person's own voice, checked against the place's limits before it is filed. Drafts only, never publish.
says: Write a draft of a post in your voice
---

# Write a draft

One finished message, in the person's voice, ready to edit and post. You never post; the person does.

## 0. The person's voice

If `growth/voice.md` exists in your folder, the voice is already there: read it every time you draft. If it does not
exist yet, draft anyway and ask the voice question once, at the end, in your own words: how do you write, paste three
posts you liked writing. Save what they send as `growth/voice.md` with `crew_write`, then run the voice parse (step 1).
Until they answer, `check` runs without `--voice` and covers fit and stock phrasing only.

## 1. Brief, draft, check, file — in that order

1. **Brief.** `crew_app { "tool": "write", "input": { "args": ["brief", "--kind", "post", "--platform", "<x|linkedin|reddit>", "--voice", "<the rules>"] } }`
   - `--kind reply` for a reply, `post` for a new post. `--platform` is one of `write platforms`: `x`, `linkedin`, `reddit`.
   - `<the rules>` is the `rules:` line from `crew_app { "tool": "write", "input": { "args": ["voice", "parse", "growth/voice.md"] } }`.
     No `growth/voice.md` yet: leave `--voice` off.
2. **Draft.** Write it against the brief's lines and the place's own limits: X fits one post of 280 characters,
   LinkedIn is short paragraphs, Reddit is a title plus a body that reads like a person talking to a room. Keep the
   real numbers, names and details you were given. Never invent one.
3. **Check.** Save the body (only the body) to `files/<slug>.md` with `crew_write`, then
   `crew_app { "tool": "write", "input": { "args": ["check", "--platform", "<id>", "--voice", "<the rules>", "files/<slug>.md"] } }`.
   - `result: 0 of 1 drafts pass` means it failed: every line under `issues` is one thing to fix.
   - Fix them and check again, **at most twice**. After the third failure, stop revising: file the card anyway and
     put the check's own words on it, in one line at the top of the card text (for example `Checked: 0 of 1 pass —
     too long at 312 characters`). Never check a fourth time, and never leave the person with nothing.
4. **File.** `crew_draft { "path": "files/<slug>.md", "channel": "post", "to": "<the place>" }`, where `to` names the
   venue, not a person or a job: `X launch post`, `LinkedIn founder post`, `r/selfhosted thread: <title>`.
   For a reply, `channel` is `reply`. Nothing is sent.

## Never

- Never post, publish, submit, or open a social site in a browser to send anything.
- Never write the same text into two places.
- Never ask for upvotes, stars or follows, and never run a second account.
- Never put "excited to announce", "game-changer", or an emoji wall in a draft; the check will say so anyway.
