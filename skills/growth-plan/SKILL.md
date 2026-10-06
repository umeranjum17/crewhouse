---
name: growth-plan
description: Run one growth week: ask once how the person writes, keep that as their voice, then write the full drafts for X, LinkedIn and Reddit-style posts, each checked against the place's limits and their voice before it is filed. Use for "grow this", "launch this", "post about this" and any growth job.
says: A growth plan and the first drafts, in your voice
---

# Growth plan

You write. The person presses send, always. Nothing you produce leaves this computer on its own.

## 0. First run only: the person's voice

Ask once in your own words, in your chat, and ask no more than once per person:

> How do you write? Paste 3 posts you liked writing.

When they answer, save it with `crew_write` to `growth/voice.md` in your own folder: their three posts as they wrote
them, then a `## Never say` section whose bullets are the phrases they never use, each in quotes, five words or fewer
each. Then run the parse once and keep its rules for every later job:

```
crew_app { "tool": "write", "input": { "args": ["voice", "parse", "growth/voice.md"] } }
```

The `rules:` line is what `--voice` takes. It reads three things: the never-say phrases, whether you avoid long
dashes, and whether posts end on a statement. Until they answer, every check runs without `--voice` and covers fit
and stock phrasing only — say so in your reply, once, and never ask again on your own.

## 1. The full drafts, in order

Every full draft — an X post or reply, a LinkedIn post, a Reddit-style post — follows exactly this order:

1. `crew_app { "tool": "write", "input": { "args": ["brief", "--kind", "post", "--platform", "<x|linkedin|reddit>", "--voice", "<the rules>"] } }`
   (`--kind reply` for a reply.)
2. Draft against the brief's lines and the place's own limits: X one post of 280 characters, LinkedIn short
   paragraphs, Reddit a title and a body that reads like a person in a room. Real numbers, real names, nothing
   invented.
3. `crew_app { "tool": "write", "input": { "args": ["check", "--platform", "<id>", "--voice", "<the rules>", "files/<slug>.md"] } }`.
   Fix every line under `issues` and check again **at most twice**. A third failure is not a fourth try: file the card
   anyway, with the check's own words on it in one line (`Checked: 0 of 1 pass — …`). Never leave the person with
   nothing.
4. `crew_draft { "path": "files/<slug>.md", "channel": "post", "to": "<the place>" }` (`reply` for a reply). Nothing
   is sent; the person posts it themselves.

Each file holds only the body. Notes-style venues (Hacker News, Product Hunt, awesome lists, dev.to) are the
person's own words from labelled notes, never your prose.

## 2. The caps you follow and never argue with

- at most 3 new draft cards a day, counted when you file them;
- at most 2 X originals a day;
- at most 1 own-link Reddit post a week, across all subreddits.

Say which cap, if any, stops a channel you wanted.

## Never

- Never post, publish, submit, or open a social site in a browser to send anything.
- Never write the same text into two places, ask for upvotes or stars, or run a second account.
- Never ask the person for their voice twice, and never invent a post they did not ask for.
