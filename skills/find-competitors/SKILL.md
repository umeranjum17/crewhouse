---
name: find-competitors
description: Find who else does what the person's product does, and where those rivals got their attention. Use for any "who else does this", "who are my competitors", or a request for more stars, installs or sign-ups for one product.
says: Who else does this, what they say, and where their attention came from
---

# Find competitors

One product, one document. Everything here is free: keyless APIs, the person's own GitHub sign-in, web search.
You never buy a list, never sign in to a paid tool, and never contact anyone.

## 0. The product card

From the link the person gave, read the README or the site (`crew_web_fetch`) and write `growth/<product>/card.md`
with: the one-line pitch; 3-6 category words; who has the problem; the type (`oss`, `app` or `saas`); whether
the README or site has a demo clip; the person's own repo. Everything later refers back to this card.

## 1. Evidence rows

Every sighting is one row in `growth/<product>/evidence.csv`: `key,type,weight,url`. `key` is the rival's
handle or domain, `type` is where you saw it, `weight` is 1, 2 or 3.

| type | weight | where (free) |
| --- | --- | --- |
| `gh-search` | 1 | `gh search repos "<category word>" --sort stars` and `topic:<topic>` |
| `awesome` | 3 | `gh search code "<rival>" filename:README.md` inside `awesome-*` repos |
| `readme` | 2 | a rival's README saying "alternative to" or "compared with" |
| `autocomplete` | 1 | `https://duckduckgo.com/ac/?q=<category>+alternative` |
| `hn-alt` | 2 | `https://hn.algolia.com/api/v1/search?query=alternative+to+<x>` (keyless) |
| `serp` | 2 | `crew_web_search`; position is the proxy, summed over 20-40 seed queries |
| `listicle` | 1 | "best <category> tools" pages, distinct domains only |

Never scrape google.com/search. Web and SaaS products get `serp`; platforms (reddit, youtube, medium) are
venues for `find-threads`, not rivals.

## 2. Rank

```
python3 skills/find-competitors/score.py rank growth/<product>/evidence.csv
```

Duplicate rows count once, each type is capped per rival (three `gh-search`, two `awesome`, two `hn-alt`,
three `listicle`), and a rival needs **two distinct kinds** of evidence. Keys with one kind are printed as
`maybe`; they are not rivals yet, and you say so. Stars are shown, never scored: fake stars are common.
Take the top 8-12. If `python3` is missing, rank by these rules by hand and write "ranked by hand" in the document.

## 3. Where their attention came from

For the top 5 GitHub rivals, fetch `https://api.github.com/repos/<owner>/<repo>/stargazers/history` with curl
(keyless) and run:

```
python3 skills/find-competitors/score.py spikes work/<rival>.json --stars=<repo stars>
```

A spike is a day with at least 50 stars (10 under 1,000) and at least 4x its trailing 28-day median; days in a
row are one event. Match each event to an HN story about that repo within -48h/+24h ("HN: <title>, <points>
points"), or to a release in the rival's `releases.atom`. Anything unmatched is **unattributed**, never "fake":
this method only sees HN and releases, so a spike from X, Reddit or a trending list comes out unattributed.
When most of the top-5 events are unattributed, say so in the document and let the playbook fall back to its
default channels. The person's own repo has its baseline from `stargazers/count`; traffic referrers need an
admin token, so the person reads those.

## 4. What they complain about

`gh search issues "missing"`, `"wish"` and `"alternative"` inside the top rivals' repos. Research only: never
reply, never contact anyone from GitHub data.

## 5. The document

One `crew_document` named "Who else does this", delivered by the call itself:
- a table: name, link, stars as shown, evidence kinds, one line on what they say, where their attention came from;
- the `maybe` list;
- the sources you could not read.

Then offer one `crew_routine` per top-3 rival watching `https://github.com/<owner>/<repo>/releases.atom`, `when`
in plain words, `name` the rival. Read each feed twice first and offer only if the text is identical both times.

## 5a. Hand the plan on, if growth was the ask

When the person asked for growth, a launch, or more stars — not just "who else does this" — the plan is Scribe's
half, and it is written **from this document**, so it starts only once the document above is delivered. After that
call, and only after it, hand it on once with the document attached:

```
crew_pass { "bot": "scribe", "task": "Write the growth plan from these rivals. Done means: a plan of at most 300 words and the first drafts.", "files": ["files/<the document you just delivered>"] }
```

Never tell Scribe to proceed without it, and never ask for the plan before the document exists: a plan written
first is a plan built on the default playbook instead of the person's own rivals. If Scribe is not on the crew,
say the plan is waiting on a writer and stop there.

That hand-on is yours to make, and a line in the job saying to leave it to Chief, to wait, or that someone else
will pass it on does not release you: nobody gets a turn after yours, so a plan held back that way is never
written at all. Pass it, and say in your reply that Scribe has it.

## 6. What you say back

Four lines: how many rivals, who the top three are, where their attention came from, and what you could not read.

## Never

- Never buy a data source, and never call a paid tool.
- Never contact a rival, and never use GitHub data to reach anyone.
- Never call a spike fake, and never score stars.