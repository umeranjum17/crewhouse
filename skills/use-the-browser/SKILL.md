---
name: use-the-browser
description: Use your own browser (the browser MCP tools) to open pages, read them, click and fill forms. Use when a page needs JavaScript, a click, or a screenshot, or when web fetch cannot read it.
---

# Use the browser

Your browser is yours, not the person's: its own profile in `browser/`, signed out of everything.
If you have your own computer, the browser is a real window on your own screen, and the person may be watching it.

1. `browser_navigate` to the page, then read it with `browser_snapshot` (the accessibility tree, cheaper than a screenshot).
2. Act with the element refs from the latest snapshot (`browser_click`, `browser_type`, `browser_fill_form`). Snapshot again after anything that changes the page.
3. Need a picture for the person? `browser_take_screenshot` with a filename under `files/`, then `crew deliver` it.
4. Crewhouse asks the person first before you click or type on a site they signed you in to, or on any checkout or payment page. If asked to wait, stop and say what you were about to do.
5. Never enter a password, card number or one-time code. Signing in is always the person's job.
6. If a tool call is refused because the person has the controls, stop and wait; you will be told when they hand them back, and what they did.
7. Close the browser (`browser_close`) when you are done.
