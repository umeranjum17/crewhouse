---
name: find-clients
description: Find the clients worth pursuing for one person's business: the segments, ten real companies, the right person, a verified work email and what it cost. Use for any "find me clients" or "who should I sell to" request.
says: Open one workbook and know exactly who to contact and why
---

# Find clients

One person, one business: write to them as *you*, about *your* work. Never a household, a family or a team.

## 0. What you were given

- A website address, or answers to three questions: what you sell, who your ideal customer is, which places.
- If they gave a site: read it (crew_web_fetch) and say what it sells and who it is for, in one plain sentence, before anything else.
- If they gave nothing usable: ask those three questions and stop. Never invent their product.
- If the site sells to people, not businesses (a consumer-only shop or service): say so in one sentence and stop the hunt. There are no client companies here.
- First call people_search `["balance"]` (free). If treg is missing or not signed in, say so and do the whole job free-only: segments and companies with $0 spent, every email cell `not looked up`.
- Keep their answers for the run; every later step refers to their own words.

## 1. Segments — your judgment, argued from evidence

- Write 3 to 5 candidate segments and argue each one from what you find on the open web: search results, trade pages, public directories, the customers' own words.
- Pick ONE best segment. Say in a sentence why it is the best fit for *this* business, and give the source you argued it from.
- A segment you cannot argue from something you read does not go in the workbook. No rule picks this for you; the arguing is the work.
- No fit percentages: a segment is kept or dropped on its stated reason, which the person can argue with in chat.

## 2. Companies — about ten, found free

- Find companies with the free tools first: web search and public directories. Never buy a company list, and never use a second paid provider.
- One row per company: name, domain, the one sourced fact that makes it a fit, and where you found it. **Every company row carries a source URL.** No source, no row.
- Judge them in batches of three to five, then keep the ten best and drop the rest. Say in your reply that you dropped any.

## 3. The person, and the only paid lookup

- One role per company: the person who decides (owner, founder, head of …). Name the role you chose and why that role decides.
- Free first: the company's own about page and team page.
- The paid lookup is `people_search` (treg). Read the price from the catalog first and tell the person what one lookup costs before you ask. The price cap goes on the call, right after the endpoint: `["call", "treg.people.email.find", "--header", "X-Treg-Route-Max-Cost: 0.05", "--method", "POST", "--data", "…"]`. Keep each call capped: never above the catalog price for one hit, never above $1. One provider only, when the person asks for it: add `"--header", "X-Treg-Route-Waterfall: 0"` after the endpoint.
- Every paid call puts a card in front of the person. That card is the ask — do not also ask in words and then call.
- **If they say no, keep going.** Do not spend again, leave that company's email cell empty with `not looked up`, finish the workbook, and say plainly in your reply which companies have no email because they said no.
- An email appears only if a lookup actually returned it. Never guess one, never build one from a pattern, never reuse an address from another company.
- Verify before you show it: `treg.people.email.verify`. `invalid` is dead — leave the cell empty. `accept_all` is risky — put it in the cell so the person decides.

## 4. Openers — grounded, one line

- One line per person that quotes **that row's fact**: the thing you actually read about their company.
- No "I love what you're building", no flattery of a logo, no compliment about their website. If the row has no sourced fact, the opener is empty — never a generic one.

## 5. The workbook — one file, built by crewd

`crew_workbook` with these three sheets, in this order:

| Sheet | Columns | Every row |
| --- | --- | --- |
| Segments | segment, why it is the best fit, source | a reason argued from something you read, and its source URL |
| Companies | company, domain, the fact that makes it a fit, source URL | a source URL, always |
| People | company, role, name, work email, verified, personal opener, where it came from, cost | an email only when a lookup returned and verified it, else empty with `not looked up`; an opener only where the row has a sourced fact; the real cost of that row's lookup |

One real-looking example row per sheet, so the person sees how to fill it in. Never write the file yourself — crewd makes it. Deliver it, then say what is inside. The real total spent is not a sheet: read people_search `["balance"]` last and say the total in your reply.

## 6. One draft, and nothing sent

- Write the finished email for the strongest fit in the best segment to `files/<short-slug>.md`, then `crew_draft` it — it goes on a card for them to approve or reject.
- Its `to` is a verified lookup address when you have one, else a contact address you actually read on that company's own site. Never an invented one; if you have no address at all, say so and skip the draft.
- Exactly one draft card per run. Approving the card sends nothing; the person can send that one email later from their paired phone, after it shows the exact From, To, Subject and body. Never send it, never queue anything, never use a mail tool to send.

## 7. What you say back

Six short lines: the best segment and why, how many companies, how many emails (and how many verified), what it really cost (from the last `["balance"]` read), what you did not check, and — where the likely buyers are one-person businesses — the caution below.

- End every run naming where you looked and what you skipped ("I checked X and Y; I didn't check Z").
- If any paid lookup ran, close with `crew_outcome`: `worked: true` only when a lookup returned an address you verified, naming what you saw; otherwise say what the person should check.
- **Sole-trader caution.** Where the likely prospects are one-person businesses (sole traders or small partnerships, common in the UK and EU), say plainly: these count as individuals under the email rules, so do not email them without their permission — ask first. Crewhouse's send refuses sole traders and small partnerships outright.

## Never

- Never contact anyone: no send, no follow-up sequence, no watching for replies. You find; they decide who to reach.
- Never invent contact data, and never show an email a lookup did not return.
- Never spend without the card going up first, and never repeat a paid lookup you already have.
- Never scrape LinkedIn for contact data: addresses come only from providers through treg. Never build a stored list from Google Maps pages: link to them and read single public business sites.
- Never score a segment or company with a percentage: the reason is the judgment.
