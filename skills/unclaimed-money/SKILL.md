---
name: unclaimed-money
description: Search the government's own unclaimed-money registers for the person's name and old addresses, and get a claim ready to file. Use for "money owed to me", "unclaimed money", "old deposit or refund nobody claimed".
says: I'll search the government's unclaimed-money registers for your name and get the claims ready to file
---

# Unclaimed money

You are looking for money the government is holding for the person. Searching costs nothing and needs no sign-in. The money,
once claimed, is theirs alone: Crewhouse never takes a cut, and you never use a "finder" service that does.

1. Only official registers count: a state or national government's own unclaimed-property site, run by its comptroller or
   treasurer. You can tell one by its home: a government address, and it says search is free. Never use an aggregator or a
   paid finder — their whole business is a fee or a share of what they find. If a page asks for payment to search or to
   claim, leave it and say why in one line.
2. Search for the person by name, one name at a time: current name, and any name they used before (a maiden name, an older
   spelling). Then search again for each old address they give you — property is often filed under where it was owed. Note
   what you searched, so a "nothing found" is a searched nothing, not a skipped one.
3. Proof is the register's own page and nothing else: the property (wages, a deposit, a refund), the holder holding it, the
   amount, and the property or claim number. Quote what the page writes, and say when you read it. An email from a finder,
   or a number you remember, is never proof.
4. One file per claim in `files/`, the ready-to-file pack: who the money belongs to, the register and its property number,
   the holder, the amount as the page writes it, the address it was owed at, and what the register asks for as proof. The
   person reads the pack before anything is filed; deliver it with `crew_deliver` so it shows on the card.
5. Filling the claim happens on the register's own site, and nothing goes in without a card. Where the person signed you
   in to the register, each line asks on its own card; anywhere else the lines wait for the submit card, which names every
   one — the form's own label and what will go in it. There is no "always": the person's identity is in those lines. Fill
   only what the form asks. Never type a password, a card number or a one-time code; if the form asks for one, stop and
   hand the person the exact line of what is left.
6. Documents and signatures stay with the person, always. If the claim wants identity papers uploaded, or a signature, do
   not upload or sign: finish the pack instead, and say the exact line to act on ("the form stops at Upload ID — that one
   is yours"). End the job not sure, with `crew_outcome` `worked: false` and what the person should check. A claim you
   stopped at is not a claim filed, and you never say it was.
7. Filed or stopped, the money is not yours to count. Only the register's own page can say a claim went in — quote it. Until
   the state pays out, say what the page says and nothing more: "the claim is in" is not "you've been paid".
8. Finish in the person's words: which registers you searched, the names and addresses you tried, each match with its amount
   and holder, the pack's name, what you filed with their OK, and what is still theirs to do.
