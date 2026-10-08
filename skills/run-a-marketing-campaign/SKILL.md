---
name: run-a-marketing-campaign
description: Chief's marketing crew recipe. Read this SKILL.md at its listed path with crew_read, not native Skill or Read. Use for "help me market my bakery", "market my business", "plan a campaign" or a marketing crew request. Scout researches, Scribe writes, Reel makes visuals. Drafts only; no publishing or tracking.
says: A small campaign plan, research, written drafts and a poster or video to review
---

# Run a marketing campaign

Chief owns the plan; Scout researches, Scribe writes, Reel makes a poster or video. This is a campaign recipe for the existing crew, not a new helper. Use it instead of the generic growth handoff or marketplace import for these requests.

## Start from the person

Read **About me and my work** in your job context before planning. Every helper receives that same shared record on its own task: explicitly tell each to read it for the business, audience, offer and voice. Use the person's stated facts, not invented prices, opening hours, endorsements or results. Ask one question only if a missing fact changes the campaign; otherwise name a modest assumption and start. Do not ask for facts already in the record.

## Recruit and plan

Call `crew_roster`. Reuse suitable Scout, Scribe and Reel helpers already present, using their actual ids; recruit only missing roles with `crew_recruit` and templates `scout`, `scribe`, `reel`. Never change an existing helper's job or personality to fit this campaign. A request only to set up the marketing crew ends after recruitment: say each part and wait for a campaign request.

For a campaign, make the plan yourself before assigning: one goal, the audience, one truthful offer, one or two channels, a short timeframe and what each helper will deliver. State it in Chief's chat in at most 120 words, plain sentences and bullets; do not promise to return later. This is a proposed plan for review, not a schedule to run. No results tracker, measurements, routines or automatic follow-ups.

## Give each helper its part

Use `crew_assign` once per helper. Include the person's request, your complete brief and the instruction **Read About me and my work. Drafts only: nothing posts, sends, emails, publishes, buys or schedules.** Each assignment must stand alone; copy Scribe's file-format and single-card instructions below into its task verbatim, because it cannot read Chief's skill. Do not say another file is coming, or depend on a helper finishing first. No `crew_pass` chain or duplicate assignments. Say which information is still an assumption.

- **Scout:** Research two useful audience or local-channel opportunities relevant to this business; read public sources only. Deliver a short sourced document with links and clear uncertainties. Do not invent competitors or rewrite Chief's plan.
- **Scribe:** Write two short, distinct ready-to-edit post drafts for Chief's chosen channels, in the shared record's voice. This is a writing job, not the separate `growth-plan` workflow: no rivals-document dependency, metrics or extra campaign. Put BOTH posts in ONE new `files/campaign-<short-name>.txt` file. Each post starts with its actual channel on one plain line, then a newline and the exact ready-to-copy post, preserving paragraphs and hashtags. Separate the two sections with exactly a blank line, `---` on its own line, and a blank line. No Markdown headings, variants or planning notes. Deliver this text file with `crew_deliver`, then call `crew_draft` ONCE on that same file, `channel: "post"`, `to` naming the chosen channels, and no `link`. Never call it separately for each post. Chief carries this one approval; the app waits for the campaign parts to finish and shows the poster alongside the posts.
- **Reel:** Make one finished poster PNG by default, or one short silent video if requested. Use the shared business name, the brief and truthful supplied copy; no fabricated products or photos. If no photographs were supplied, make a simple text-led design and say so. Deliver the actual file with `crew_deliver`, not a storyboard, script or promise. Keep it in your own files; never upload or publish it.

For a small bakery campaign, a warm weekend invitation, two local-family post drafts and a simple bakery-name poster are enough. Without a stated address, price or opening time, omit it rather than guessing.

## Finish at review

After successful assignments, say who is making what and that everything is for the person to review, then finish your turn. The app shows progress and brings back each helper's files. Both finished posts and their intended channels go on ONE Needs-you card in Chief's thread, with the delivered poster; helpers do not ask for separate draft decisions. Approve marks the posts approved and offers a Copy action for each post and Save poster; it never copies automatically or posts anything. Not now closes the card and copies or sends nothing. Do not claim a draft or poster is ready before delivery. Never send, post, publish, email, buy ads, connect social accounts or promise performance. The person decides what to use outside Crewhouse.
