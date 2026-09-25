---
name: find-leads
description: Find people, work emails or phone numbers for a role, company or named person with treg. Use for any "find leads", "who runs X at Y", "get me the email/phone of" request.
says: Find the right people at a company, with a work email or phone number
---

# Find leads

## 0. Setup check (free)
Call people_search with `["balance"]`. If it is missing or not signed in, stop and tell the person exactly this:
1. Install: `curl -fsSL https://treg.to/install.sh | sh` (needs Python 3.12 or 3.13).
2. In their own terminal: `treg login`. New accounts get $1 of credit.
3. Optional: their own provider keys (`treg secret add`, or the treg dashboard). Those are used first and treg never bills them.
Until then you can still price a job: `https://treg.to/catalog/search?q=<job>` is public (web_fetch).

## 1. Price it (free)
- people_search `["catalog", "search", "<the job in plain words>"]`, then `["catalog", "get", "<id>"]` for inputs and price.
- Prefer the routed endpoints: `treg.people.search`, `treg.people.email.find`, `treg.people.phone.find`, `treg.people.email.verify`. They run a waterfall across providers (your own keys first, then cheapest per hit) and honour a hard price cap.
- Match the inputs you actually hold (name + domain, or a LinkedIn URL) before comparing price.

## 2. Ask, with the price on the call
Every paid call asks the person first, and the card shows its cap, so the cap goes right after the id:

```
["call", "treg.people.phone.find", "--header", "X-Treg-Route-Max-Cost: 0.05", "--method", "POST", "--data", "{\"full_name\":\"Jane Doe\",\"domain\":\"example.com\"}"]
```

- The cap is the most this one call may spend, in USD. Set it from the catalog price, never above $1.
- For a list, give one total estimate (leads × price per hit) in your reply before the first call, and keep each call capped.
- A 402 `route_max_cost` means nothing was charged; ask before raising the cap. A 402 out of balance means stop and tell the person.

## 3. Verify, then deliver
- A found email is not a confirmed one. Run `treg.people.email.verify` on each before marking `verified=yes`; `invalid` is dead, `accept_all` is risky.
- CSV columns: name, title, company, domain, email, phone, verified, source (the provider that served), cost_usd.
- Finish with people_search `["balance"]` and report the real total spent.
