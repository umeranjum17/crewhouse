# ch-pm-13: real spending approval from a real shop page

Scorecard J4. `crewhouse test` runs on a scripted stub engine; this run is the same product driven by hand, against a
real shop over real HTTP, with the bot's own Chromium (playwright-axi) doing the shopping.

## What was run

An isolated `crewd` (`CREWHOUSE_ENGINE=stub`, throwaway HOME/XDG/state/crew, person **Umer**, monthly limit raised to
$50 through the app's own Settings endpoint) and `data/ch-pm-13/test-shop.mjs`: a real HTTP grocer at
`http://grocer.localhost:8099` with a server-side basket, real line items, real delivery and a real order total. Chief
hires Scout through `crew_recruit`; Scout's turn drives its own browser (rice, two milks, garlic → basket → Checkout).

Both legs ran from `leg.sh`, one fresh instance each, and every capture came out of the running app.

## What it proved

**The card is the shop's own order, not a fixture.** `card-and-shop-page-side-by-side.png` puts the shop's basket page
next to the sheet. The page says `Item total: $18.30`, `Delivery: $3.99`, `Order total: $22.29`; the card reads

```
Scout wants to place this order at grocer.localhost: Basmati rice, 10 lb x1, Whole milk, 1 gal x2, Garlic, 2 kg x1. Total $22.29.
```

with each item and its own price (`card-approve.json`). crewd read every word of that from the page's own accessibility
snapshot; the model never chose a number.

**Saying no spends nothing.** `shop-ledger-after-decline.json` is `[]`: the shop's own order ledger after the person
tapped "Don't place order". No `money.spent`, no `run.allowed`, one card opened and one answered `not now`
(`shop-ledger-before-decline.json` was `[]` too, so nothing was ordered at any point in the run). Scout's next line is
`The person said not now.`

**Saying yes buys that one order, once.** After the yes, the click that places the order on the payment page passed the
gate (`run.allowed`) and the shop's ledger shows exactly one order, `OG-1000`, `$22.29`, items as above
(`shop-ledger-after-approve.json`). One card for the purchase: `ask.opened` appears once for the whole task.

## The defect this found, and the fix

On the first approve run against `main` the person was asked **twice for one purchase**: once for the basket
(`Total $22.29`) and again on the payment page, where the second card read *"I couldn't read the total on this page"* —
the ask arrived exactly where the money actually left, carrying no amount. The one-yes rule compared the *page address*
(`origin + pathname`), so moving from `/cart` to `/checkout/payment` broke it.

`src/crew.ts` now keys that yes to the **shop**, not the page: the same task at the same origin goes through while the
total holds. A page that names no total is the same order further along **only while it lists no priced items of its own**
(`checkout.basket`), so an unpriced basket still asks. `test/routines.test.ts`'s checkout journey and one new case in
`test/family.test.ts` pin both halves. `src/` is net 0 lines.

## What is stubbed, plainly

- **The money path.** The shop's payment page is a stub: pressing its button writes the order record and a confirmation
  page and stops. No card network, no real payment, no real account, nothing charged anywhere. What is proven is that
  Crewhouse asks first, says the shop's real amount, and that the shop is asked to charge only after a yes.
- **The model.** The scripted stub engine (`src/stub-runtime.ts`) stands in for the model: it runs the tool calls
  written in the task. The browser, the shop, the gate, the card and the buttons are all real.
- **The shop is local.** `grocer.localhost` resolves to this machine's loopback. It is a real HTTP shop with real server
  state, not a page snapshot; no real merchant was involved and no real order was placed anywhere.

## Captures

| file | what |
|---|---|
| `screens/card-and-shop-page-side-by-side.png` | the shop's basket page beside the Crewhouse card, same total |
| `screens/checkout-review-{approve,decline}-{day,night}-{1440,390}.png` | the review sheet, both themes, both widths |
| `screens/shop-cart-day-{1440,390}.png` | the shop page the card was read from |
| `motion/approve.webm` | the person tapping "Place order · $22.29" |
| `motion/decline.webm` | the person tapping "Don't place order" |
| `card-*.json`, `shop-ledger-*.json`, `scout-thread-*.json`, `state-after-*.json`, `crewd.log` | the run's own records |

Media is not committed (the project never commits media); these files sit beside this README in `evidence/`.