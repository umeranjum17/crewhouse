---
name: find-clients
description: Turn a website, or three questions about what someone sells, into one workbook of the clients worth pursuing — the segments worth arguing, about ten real companies with the sourced fact that makes each a fit, the right person, a verified work email where one was actually found, a grounded opener, and what each lookup cost — plus one finished email on a draft card for them to send themselves. Use for "find me clients", "who should I sell to", "get me leads for this", "build me a prospect list".
says: Open one workbook and know exactly who to contact and why
---

# Find clients

One person, one business: write to them as *you*, about *your* work. Never a household, a family or a team.

## 0. What you were given

- A website address, or answers to three questions: what you sell, who your ideal customer is, which places.
- If they gave a site: read it (crew_web_fetch) and say what it sells and who it is for, in one plain sentence, before anything else.
- If they gave nothing usable: ask those three questions and stop. Never invent their product.
- Keep their answers for the run; every later step refers to their own words.

## 1. Segments — your judgment, argued from evidence

- Write 3 to 5 candidate segments and argue each one from what you find on the open web: search results, trade pages, public directories, the customers' own words.
- Pick ONE best segment. Say in a sentence why it is the best fit for *this* business, and give the source you argued it from.
- A segment you cannot argue from something you read does not go in the workbook. No rule picks this for you; the arguing is the work.

## 2. Companies — about ten, found free

- Find companies with the free tools first: web search and public directories. Never buy a company list, and never use a second paid provider.
- One row per company: name, domain, the one sourced fact that makes it a fit, and where you found it. **Every company row carries a source URL.** No source, no row.
- Judge them in batches of three to five, then keep the ten best and drop the rest. Say in your reply that you dropped any.

## 3. The person, and the only paid lookup

- One role per company: the person who decides (owner, founder, head of …). Name the role you chose and why that role decides.
- Free first: the company's own about page and team page.
- The paid lookup is `people_search` (treg). Read the price from the catalog first and tell the person what one lookup costs before you ask. The price cap goes on the call, right after the endpoint: `["call", "treg.people.email.find", "--header", "X-Treg-Route-Max-Cost: 0.05", "--method", "POST", "--data", "…"]`. Keep each call capped.
- Every paid call puts a card in front of the person. That card is the ask — do not also ask in words and then call.
- **If they say no, keep going.** Do not spend again, leave that company's email cell empty with `not looked up`, finish the workbook, and say plainly in your reply which companies have no email because they said no.
- An email appears only if a lookup actually returned it. Never guess one, never build one from a pattern, never reuse an address from another company.
- Verify before you show it: `treg.people.email.verify`. `invalid` is dead — leave the cell empty. `accept_all` is risky — put it in the cell so the person decides.

## 4. Openers — grounded, one line

- One line per person that quotes **that row's fact**: the thing you actually read about their company.
- No "I love what you're building", no flattery of a logo, no compliment about their website. If the row has no sourced fact, the opener is empty — never a generic one.

## 5. The workbook — one file, built by crewd

`crew_workbook` with these sheets, in this order:

| Sheet | Columns | Every row |
| --- | --- | --- |
| Segments | segment, why it is the best fit, source | the segment you picked and its source |
| Companies | company, domain, the fact that makes it a fit, source URL | a source URL, always |
| People | company, role, name, work email, verified, where it came from, cost | an email only when a lookup returned and verified it, else empty with `not looked up` |
| What it cost | lookup, what it cost, and a total | the real total spent, and how many they declined |

One real-looking example row per sheet, so the person sees how to fill it in. Never write the file yourself — crewd makes it. Deliver it, then say what is inside.

## 6. One draft, and nothing sent

- Write the finished email for the strongest fit in the best segment to `files/<short-slug>.md`, then `crew_draft` it — it goes on a card for them to send themselves or reject.
- Exactly one draft card per run. Never send it, never queue anything, never use a mail tool to send.

## 7. What you say back

Five short lines: the best segment and why, how many companies, how many emails (and how many verified), what it really cost, and what you did not check.

## Never

- Never contact anyone: no send, no follow-up sequence, no watching for replies. You find; they decide who to reach.
- Never invent contact data, and never show an email a lookup did not return.
- Never spend without the card going up first, and never repeat a paid lookup you already have.
