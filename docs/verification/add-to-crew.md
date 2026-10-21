# Add to your crew

One screen (`Apps` in `web/src/main.tsx`, route `#/apps`; the old `#/skills` lands there) for every reviewed app,
skill and plugin. Approved mock: `add-to-crew` (market-a) in `scripts/verify/mocks.tsv`. Contract:
[ui-contract.md](../ui-contract.md), "Add to your crew (today)".

## What it proves

- Sections by purpose from crewd's reviewed list (`purposes` in `src/starter-skills.json`): Mail, calendar
  and files first (Gmail, Google Calendar first in it), then Home, Code, Design; four rows, then "See all N".
- A filter chip per section that has rows, and the "N added" chip with the added rows' marks.
- Search filters the list as you type ("gmail" → Gmail, Gmail drafts & labels, Gmail sending); no local match shows
  "Nothing here by that name." with Look in the catalog, and a catalog miss says "Nothing found for “…”. Ask Chief
  instead." Search asks the skill and plugin catalogs: rows outside the reviewed set say "By <publisher>. Not reviewed
  yet" and have no Add; another publisher's skill of a reviewed name is not reviewed.
- Each starter skill wears its `maturity` tag (Production, Beta or Experimental) on its own line under the name, never
  over the Add button at 390 wide with 1.3x text (`Home` chip: Weather, Home Assistant).
- Add on a reviewed skill installs it through the engine's trust gate and the row becomes "Added ✓" with the count
  chip up by one; Add on an app opens its connect card; Herdr's row keeps its three setup states
  ([herdr-setup.md](herdr-setup.md)).

## How to drive it

The real engine is needed for Add on a skill and for catalog search (the stub answers both with "starting up" /
nothing); it needs no account, only the network for ClawHub. Start an isolated crewd as in [runbook.md](runbook.md)
without `CREWHOUSE_ENGINE=stub`, name the person Umer, wait for `crewd engine ready`.

At `390x844x3,mobile,touch`, `?day` then `?night` with a fresh query each time:

1. `#/apps`: screenshot; eval `innerWidth === scrollWidth`.
2. Click `button[aria-label="Add Weather"]`; poll until `.add-count` reads "1 added" and the row reads "Added ✓"
   (the skill appears under the lab's `state/openclaw/workspaces/*/skills/weather`).
3. Set `.add-search input` to `gmail` (native value setter + `input` event): screenshot; to `zzqxvk`, click Look in the
   catalog, wait for "Nothing found": screenshot; to `weather`, `requestSubmit()` the form, wait for "In the catalog":
   screenshot.
4. Clear the search, click the `Home` chip: screenshot.

Pair the first shot with `market-a-{light,dark}.png` (mock left). Look check:
`node scripts/verify/look-check.mjs web --out <dir> --person <key> --text 1.3 add-to-crew=$B/#/apps`, and once more
with `--then` running step 3's catalog search (long catalog summaries are cut at a word break by the adapter, never
clamped). Installed app: [pwa-shell.md](pwa-shell.md)'s real install, then `#/apps` at `win: [1440, 900]` and a
390 viewport, `matchMedia('(display-mode: standalone)').matches` true.

Known gaps against the mock: no Money section (no Stripe or other money row exists in `@byokit/connect` or the
reviewed skills), and skills without a product logo wear their initial on the neutral tile.
