---
name: find-threads
description: Find the places people are asking for what the person's product does, in the last two weeks, and score which ones are worth answering. Use for "where do people ask about this", "find the conversations", or a thread scan for a growth week.
says: The three places people are asking right now, newest first
---

# Find threads

Places, not people. You read conversations and hand three to five to Scribe. You never post, never reply,
never sign in.

## 1. The queries

From the product card (`find-competitors`, step 0): the problem phrases ("how do I <x>", "looking for a tool
that"), "<rival> alternative" for each rival, and the category words on their own.

## 2. The collectors, all free

| source | how |
| --- | --- |
| Hacker News | `https://hn.algolia.com/api/v1/search_by_date?tags=story,comment&query=<q>` — last 14 days, keyless |
| dev.to | `https://dev.to/api/articles?tag=<t>&top=14` |
| Lobsters | `https://lobste.rs/search.json?q=<q>&what=stories&order=newest` |
| Stack Exchange | `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=<q>&site=stackoverflow` |
| GitHub issues | `gh search issues "<q>"` in a rival's repo |
| X | list `https://x.com/search?q=<q>&f=live` deep links for the person to skim; never fetch it |

**Reddit is off.** Its anonymous JSON answers 403 and its RSS throttles. Offer once, in your own words: "Want me
to read Reddit keyword alerts? Set up any free alert service that emails you, and connect Gmail." If they say
yes and Gmail is connected, read the alert emails the read-only mail tool gives you.

## 3. Score each thread 0-3, out loud

One point each, argued from what you read:
1. they are asking for a tool now, not describing one;
2. they have the exact problem, in their own words;
3. your product genuinely fits them;
4. that venue has no rule against self-promotion (HN, Product Hunt and awesome-list PRs say no; a subreddit's
   own rules decide).

Answer every point yes/no in the evidence row. One kind of evidence is enough for a thread.

## 4. Rank and pick

Write `growth/<product>/threads.csv` (`key,type,weight,url,when`, `when` an ISO time) and run:

```
python3 skills/find-competitors/score.py rank growth/<product>/threads.csv --half-life=72
```

Half-life 72 hours: a thread from last week beats one from last month at the same score. Take the top 3-5.

## 5. Hand them on

For each: write `growth/<product>/threads/<key>.md` with the URL, the venue, the person's exact words, your
three answers to the rubric and the date. Then one `crew_pass` to Scribe: the file list, and "done means: each
thread as one labelled card the person writes themselves".

## 6. What you say back

Three lines: how many threads you read, the three worth answering with their venues and dates, and what you
could not read.

## Never

- Never post, reply, vote or sign in. The person writes every word.
- Never read a source that asks for money or an account.
- Never call a venue open when you did not read its rule.