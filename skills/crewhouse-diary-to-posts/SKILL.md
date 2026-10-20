---
name: crewhouse-diary-to-posts
description: Split a diary entry into X posts that each stand alone, and lay the week's posts into a Monday-to-Sunday plan. Use for "turn this into posts", "split my diary entry", "plan this week's posts" or any X week.
says: Your diary entry as posts that each stand alone, plus the week's plan
---

# Diary to posts

One diary entry in, posts out that each stand alone. You never post; the person publishes every word.

## 0. The person's voice

If `growth/voice.md` exists in your folder, read it every time you draft. If it does not exist yet, draft anyway and ask
the voice question once, at the end, in your own words: how do you write, paste three posts you liked writing. Save
what they send as `growth/voice.md` with `crew_write`, then run the voice parse from the `crewhouse-growth-plan` skill (section
1). Until they answer, `check` runs without `--voice` and covers fit and stock phrasing only.

## 1. Split the entry

Read the whole entry first. Each post is one idea, and each post stands alone: it names its own subject, needs no
earlier post to make sense, and carries no "as I said" or part numbers unless the person asked for a thread. Keep the
real numbers, names and details you were given. Never invent one.

## 2. The week's plan

Write `files/x-plan.md` with `crew_write`: the follower goal and today's count in one line, then a Monday-to-Sunday
table (day, post, reply target). Deliver it with `crew_deliver { "path": "files/x-plan.md", "note": "<one line>" }`.

## 3. Every post, in this order

1. **Brief.** `crew_app { "tool": "write", "input": { "args": ["brief", "--kind", "post", "--platform", "x", "--voice", "<the rules>"] } }`
   - `<the rules>` is the `rules:` line from the voice parse. No `growth/voice.md` yet: leave `--voice` off.
2. **Draft.** One post of 280 characters, against the brief's lines.
3. **Check.** Save the body (only the body) to `files/<slug>.md` with `crew_write`, then
   `crew_app { "tool": "write", "input": { "args": ["check", "--platform", "x", "--voice", "<the rules>", "files/<slug>.md"] } }`.
   Fix every line under `issues` and check again, **at most twice**. After the third failure, stop revising: file the
   card anyway and put the check's own words on it, in one line at the top (for example `Checked: 0 of 1 pass — too
   long at 312 characters`). Never check a fourth time, and never leave the person with nothing.
4. **File.** `crew_draft { "path": "files/<slug>.md", "channel": "post", "to": "X post <n>" }`, where `<n>` counts up
   from 1 across the entry. For a reply suggestion, `channel` is `reply` and `to` names the account
   (`X reply to @<handle>`). Each file holds only the body.

## 4. The caps, which you follow and never argue with

- at most 3 new draft cards a day, counted when you file them;
- at most 2 X originals a day.

Say in your reply which cap, if any, held a post back.

## Never

- Never post, publish, submit, or open a social site in a browser to send anything.
- Never write the same text into two places.
- Never ask for follows, upvotes or stars, and never run a second account.
- Never ask the person for their voice twice, and never invent a post they did not ask for.
