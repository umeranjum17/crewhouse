---
name: claim-a-price-drop
description: Watch something the person just bought and claim the price difference back when the shop's own price falls under what they paid. Use for "I bought this last week, watch the price for me", "claim the money back", "it's cheaper now".
says: Keep an eye on what you just bought and claim the difference back
---

# Claim a price drop

You are chasing the shop's own money back. Nothing here is a purchase: never open a checkout or payment page, never
add a card, never accept a store credit that costs the person anything. If the claim needs money from the person, stop.

1. Find what they paid, from the shop's own email: `mail search` for the shop's name or "order confirmation", then
   `mail read`. Note the item, the price paid, the order number, the day it was delivered, and the item's page link.
   Gmail is read-only: never promise to tidy, label or clear the mail.
2. If the confirmation is a file rather than an email, read it with the documents tool. If you cannot find the
   purchase at all, say what you looked for and ask for the receipt or the link — never guess a price.
3. Check the shop's own terms before you promise anything: its price-adjustment or price-protection window (how many
   days from delivery), whether the drop must come before you ask, whether the same seller and stock are required,
   and whether it refunds the difference at all. Say what you found in one line, with the deadline: "the shop's own
   page says 7 days from delivery, and that ends Tuesday." Quote what its page says; never invent a window.
4. Keep the watch cheap. Offer it yourself with `crew_routine` and `watch`: crewd reads the page on schedule, so a
   quiet day costs the person nothing in AI, and you wake only when it changed. Name the price they paid in the task
   ("tell me when it goes under $999, the price they paid on 12 March"), so the next reading is compared with what
   *they* paid, not with yesterday's price. The person starts it by saying yes on the card.
5. Some big shops draw their price with JavaScript, and a watch's plain reading never sees it. Offer that routine
   again with `quiet` and no `watch`, its task to open the page in your own browser (`goto`, then `snapshot`) and read
   the price: the same card, it only speaks up when something changed, and each run costs the person some of their AI.
   Say which one you asked for and why.
6. It is time when the page's price is under what they paid and the shop's window has not closed. Say so in one line,
   with both prices and the difference, before you do anything else.
7. Read the claim path on the page first: where the button is, what it is called, what the form will fill. Then press
   it. Crewhouse asks the person first, every time, on a card that names the button, the site, the page's own lines
   around it, and any money the page shows. Never describe the button in your reply as though that were the card: the
   card is read from the page, and your words are not evidence. The card is not permission for anything else — each
   press is its own card, and a checkout page is a different answer again.
8. Fill only what the claim asks for (order number, the item, the reason, the price you saw). Never type a password,
   card number or one-time code; if the claim asks for one, stop and hand the person the exact line of what is left.
9. Proof is the shop's page, and nothing else. Only report money back after a page you opened says it: a confirmed
   claim, a credit issued, a refund on its way — quote what it says and when you read it. If the page says nothing
   usable, or you never got there, end with what you saw and say you are not sure it worked. "They usually refund in
   5 days" is never proof.
10. Finish in the person's words: what you watched, the two prices, what you pressed, what the page now says, and
    what is still the person's to do. Name where you looked and what you did not check.
