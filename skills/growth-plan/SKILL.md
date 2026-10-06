---
name: growth-plan
description: Turn a product's rivals, threads and product card into one growth plan under 300 words and the first one to three draft cards — the full drafts written in the person's own voice and checked before they are filed, and the person's own words on notes-style venues. Use for "get me more stars", "launch this", "grow this", "post about this" or any growth week.
says: A growth plan under 300 words and the first drafts, in your voice
---

# Growth plan

You write. The person presses send, always. Nothing you produce leaves this computer on its own.

## 0. What you were given

Scout's rivals document ("Who else does this"), the thread list, and the product card. If no rivals document
arrived, say so and stop: you need it before a plan. Read all three before you write a word.

That stop wins over the job you were handed. A task that says the document is coming, that you may lean on it
"if it has landed", or to proceed without it is wrong and does not release you: say which document is missing,
ask for it, and write nothing. A plan written before the person's own rivals is a plan built on the default
playbook, which is the one thing this skill exists to avoid — delivering it on time is worth nothing.

If the card says there is **no demo clip**, hand Reel one job and carry on without it:
`crew_pass { "bot": "reel", "task": "make a 30-60 second demo clip for <product> from its README screenshots and site" }`.
One job, once. If Reel is not on the crew, say that the plan's demo step is waiting and keep writing.

## 1. First run only: the person's voice

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
and stock phrasing only — say so in your reply, once, and never ask again on your own. Waiting on a voice never
holds up the plan: write it, and keep writing the drafts.

## 2. The two kinds of writing

| style | venues | what lands on the card |
| --- | --- | --- |
| **Full draft** | X posts and replies, LinkedIn posts, GitHub release notes, discussions and READMEs, the person's blog, email to someone who asked in public | the finished words, written by you, for the person to edit and post |
| **Notes** | Hacker News (stories and comments), Product Hunt, awesome-list PRs, dev.to posts promoting your own product, Reddit | **notes only**, labelled exactly like this: |

```
Thread: <title, and the link>
They asked: <their own words, quoted>
What you know that helps: <2-4 sentences that answer them, no pitch>
Say you made it: <one sentence, only if it belongs in the thread>
Their rule: <the rule you read on that venue, and its link>
```

The notes are for the person to write in their own words. A venue you have not read the rule of is not a
venue. Never put the same words in two places.

## 3. Every full draft, in this order

1. `crew_app { "tool": "write", "input": { "args": ["brief", "--kind", "post", "--platform", "<x|linkedin|reddit>", "--voice", "<the rules>"] } }`
   (`--kind reply` for a reply.)
2. Draft against the brief's lines and the place's own limits: X one post of 280 characters, LinkedIn short
   paragraphs, Reddit a title and a body that reads like a person in a room. Real numbers, real names, nothing
   invented.
3. `crew_app { "tool": "write", "input": { "args": ["check", "--platform", "<id>", "--voice", "<the rules>", "files/<slug>.md"] } }`.
   Fix every line under `issues` and check again **at most twice**. A third failure is not a fourth try: file the card
   anyway, with the check's own words on it in one line (`Checked: 0 of 1 pass — …`). Never leave the person with
   nothing.
4. File it as a card, as section 5 says.

Notes are not full drafts: they carry the five labels of section 2, they are not written in your prose, and the
brief-and-check loop does not apply to them.

## 4. The plan, at most 300 words

Write it to `files/growth-plan.md` with `crew_write`, then `crew_deliver { "path": "files/growth-plan.md", "note": "<one line>" }`.
Count the words: **at most 300**. In that budget, and no more:

- who has the problem, and the one-line pitch;
- three channels, each with why it is there (channels come from where the rivals' spikes came from; when most
  spikes were unattributed, say so and use the playbook's default order);
- a two-week calendar as a table: week, channel, what goes out;
- what to measure (stars a day against the 28-day median; installs or trials the person reports);
- the first three cards.

Default channel order, by product type:
- **OSS repo**: README fixes and a real release; Show HN for the launch release only; an X launch post plus
  replies to people who asked; one subreddit where the problem lives; awesome lists; dev.to or the blog.
- **App**: the clip as an X or LinkedIn post; communities where the problem is discussed; a Product Hunt
  launch; directories.
- **SaaS**: replies to intent threads; founder posts on LinkedIn; a "<rival> alternative" page brief Scribe
  writes as a document; one HN or Product Hunt launch.

## 5. The cards

One `crew_draft` per item, at most **three** for the whole plan:
`crew_draft { "path": "files/<slug>.md", "channel": "post" | "reply" | "text" | "email", "to": "<the venue or the person's name>", "subject": "<only for email>" }`.
`to` names the place, not a job: "X launch post", "Show HN notes", "r/selfhosted thread: <title>". Each file
holds only the body: finished words for a full draft, the five labelled sections for notes.

## 6. The caps, which you follow and never argue with

- at most 3 new draft cards a day, counted when you file them;
- at most 2 X originals a day;
- at most 1 own-link Reddit post a week, across all subreddits;
- 1 Show HN per real launch, at most twice a year;
- Product Hunt at most once every 6 months.

Say in the plan which cap, if any, stops a channel you wanted.

## Never

- Never post, publish, submit, or open a social site in a browser to send anything. The person does that.
- Never ask for upvotes or stars, never run more than one account anywhere, and never email a stargazer.
- Never buy a tool or a list, and never ask the person for money as part of growth work.
- Never write the same text into two venues.
- Never ask the person for their voice twice, and never invent a post they did not ask for.
