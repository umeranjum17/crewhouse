# Plain words

Every word a person reads is copy: the name and role beside a helper, a card's title and buttons, Chief's replies, a routine's words, an error, a permission ask. Crewhouse is for people who are not technical, so its copy is written the way you would explain something to a friend. This file is the one rule for all of it. `test/plain-words.test.ts` holds it.

## The rule

1. **One idea per sentence.** Keep a sentence to 20 words or fewer, and never more than 30. Split a long thought into two sentences.
2. **Everyday words.** If a twelve-year-old would not know a word, use a plainer one. The table below says which.
3. **Active voice, and say who does what.** "Scout checks the lists", not "the lists are checked". A person should know who is doing the thing.
4. **Say what happens and what the person gets.** Name the result, not the machinery: "your report, with its sources", not "a sourced deliverable".
5. **No machinery.** No commands, file paths, tool names, engine or model names, or usage numbers. `docs/ui-contract.md` owns the two exact exceptions (the terminal-command approval, and the model names an account's own catalogue offers).
6. **One word for one thing, everywhere.** A helper is a helper on every screen; the same action keeps the same name on every card.

A role line is a good test: it has to say, in a few words, what the helper does for the person and what the person has to do themselves.

## Banned words, and what to write instead

| Do not write | Write |
|---|---|
| utilise, utilize, utilisation | use |
| assist, assistance | help |
| commence | start |
| terminate, termination | stop, end |
| obtain | get |
| require, requirement | need |
| ensure | make sure |
| leverage | use |
| functionality | what it does |
| demonstrate | show |
| additional | more, extra |
| approximately | about |
| sufficient | enough |
| personnel | people |
| initiate | start |
| subsequently | then |
| prior to | before |
| in order to | to |
| whilst, amongst | while, among |
| peruse | read |
| endeavour | try |
| elucidate | explain |
| cognizant | aware |
| terminal, terminal agent | the programs you run, a coding helper |
| pane | screen, window |
| sourced (a report) | with its sources |
| drafts only | you send it yourself |
| leads | possible customers |

Two more things the check reads: a sentence longer than 30 words fails, and a proper noun or product name (Herdr, Tailscale, Reddit, GitHub, ChatGPT) is fine — it is a name the person meets, not machinery.

## Before and after, from real strings

A helper's role (`templates/*/bot.json`):

| Before | After |
|---|---|
| Watches your terminal agents in Herdr and gets them moving | Keeps the coding helpers on your computer working |
| Researches a question into a sourced report | Looks into a question and writes a report with its sources |
| Drafts posts, emails and copy (drafts only); makes documents and spreadsheets you can use | Writes posts, emails and documents for you to check, and makes spreadsheets. You send them. |
| Finds leads: people, work emails and phone numbers, paid per result | Finds possible customers: work emails and phone numbers. You pay for each result. |
| Support desk for a product: reads its public issues, drafts replies, proves fixes in a copy (drafts only) | Reads a product's bug reports, drafts replies, and checks fixes in a copy. You send them. |

Cards, rows and errors:

| Before | After |
|---|---|
| Shall I take on Echo? | Bring Echo onto the crew? |
| CTO wants to look at your terminal agents. | CTO wants to look at the coding helpers on your computer. |
| CTO wants to drive your terminal agents: ["pane","send-text",…] | CTO wants to send a command to a coding helper on your computer: ["pane","send-text",…] |
| On · your terminal agents answer here | On · Herdr is answering |
| Install Herdr from https://herdr.dev, then open Herdr once, in your own terminal | Install Herdr from https://herdr.dev, then open it once on this computer |

## Where this lives

- `test/plain-words.test.ts` reads the same strings a person does — the adapter's view models (which the web app and the phone both render), the screens' own literal copy, each template's role, and the exact words crewd writes on an approval card in `src/policy.ts` — and fails on a banned word or a sentence past the bound. Its exception list is short and each entry names why.
- `docs/ui-contract.md` is the contract for the fields themselves; this file is the contract for the words inside them.
- A model that writes to the person (Chief, a helper) is told to follow this file from its `soul.md` and `AGENTS.md`.
