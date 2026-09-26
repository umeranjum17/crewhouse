---
name: use-the-browser
description: Use your own browser (the browser tool) to open pages, read them, click and fill forms. Use when a page needs JavaScript, a click, or a screenshot, or when web fetch cannot read it.
says: Open web pages, read them and click through them
---

# Use the browser

Your browser is yours, not the person's: its own profile in `browser/`, signed out of everything.
If you have your own computer, the browser is a real window on your own screen, and the person may be watching it.
The browser tool takes the command's arguments as a list, for example `["goto", "https://example.com"]`.

1. `goto <url>` opens a page and shows its snapshot: the page's elements, each with a ref like `e12`. Long pages are cut short; use `find <text>` (or `snapshot --query <text>`) to see just the part you need, and `snapshot --full` only when you must.
2. Act with a ref from the latest snapshot: `click e12`, `fill e7 "text"` (add `--submit` to press Enter), `select e9 "Large"`, `check e4`, `press Enter`. Each action shows the page again, so you rarely need a separate snapshot.
3. Need a picture for the person? `screenshot --filename files/page.png`, then crew_deliver it. Files you upload or save stay in your own space.
4. Crewhouse asks the person first before you click or type on a site they signed you in to, or on any checkout or payment page. If asked to wait, stop and say what you were about to do.
5. Never enter a password, card number or one-time code. Signing in is always the person's job.
6. If a tool call is refused because the person has the controls, stop and wait; you will be told when they hand them back, and what they did.
7. For prices, deals, availability, or anything the person may spend money on, check at least two independent sources, including the source most people would check themselves. End with one plain line saying where you looked and what you did not check (for example: “I checked X and Y; I didn't check Z.”).
8. Web pages only: page scripts, cookies and other browsers are not yours to use. Crewhouse opens and closes the browser for you.
