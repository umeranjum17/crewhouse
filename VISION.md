# Vision

In the owner's words (product names left out):

> "For crewhouse the vision is […] alternative opensource works as well on cloud as it does on someone elses computer your own ai packages your own cloud systems all the usecases done that other bots have executed even better than others"

## Who it is for

One person who wants a personal assistant that does real jobs. You do not need to be technical. After one short setup, you ask in plain words, on your phone or your computer.

## The problem

Your to-do list is full of small jobs that each take an afternoon: a refund to chase, flights to compare, dinners to plan, a thank-you note to write. AI can do them now, but only if it can act. You do not want it to send or buy on its own.

Hosted assistant bots are easy to start, but they run on someone else's computer and you rent them. Open-source agents run on your own machine, but setup can take hours. In the owner's words: "I don't expect user to spend 5 hours, 10 hours to set up."

## Where we are going

- **OpenClaw with batteries included.** It is set up for you, with good UX on top, so it feels like a managed service. But it runs on your own phone, computer and cloud, with your own AI accounts.
- **One assistant, a crew of helpers.** Chief gives each job to the right helper, watches the work and tells you the result. Each helper has its own memory, skills and files. Chief is the default, and you can also talk to any helper.
- **Your cloud or your computer, same assistant.** It works as well on a cloud computer you rent as on the computer in front of you. You can start with only the phone, then add a cloud computer or your own computer.
- **Every job those bots do, done better.** Each use case that hosted bots cover is covered here and improved, until Crewhouse is the assistant you use every day.

## Principles and quality bar

- **Fast to a useful answer.** From download to Chief doing a real job in under 10 minutes, with no terminal, no config files and no OpenClaw know-how. Each start (phone only, phone and a cloud computer, phone and your own computer) takes under 5 minutes.
- **Asks only for musts.** Chief decides what it safely can. It asks you only about money, sends, sign-ins, deletions and true taste calls, and gives a recommendation each time. Spending asks every time.
- **Drafts, not sends.** Anything written in your name comes to you as a draft. Crewhouse does not post to social media for you.
- **Show the plan, not the clicks.** Chief shows a short to-do list of plan steps: to do, doing, done. It does not show every small tool call. After you send, there is never a silent gap.
- **Honest results.** If Crewhouse is not sure that a job worked, it says so. It never reports a success that it did not check.
- **Plain words.** Short sentences and everyday words. Chief talks about results, not mechanics.
- **Your AI, your choice.** Every provider and subscription that OpenClaw supports works, through BYOKit. You pick one model for each account. Crewhouse never changes to a different AI by surprise.
- **Zero cost to the maker.** No server, relay or account that the maker runs or pays for. You bring your own accounts, machines and keys. Crewhouse gives the glue and the experience.
- **OpenClaw first.** Use what OpenClaw already has. Build only thin glue for what it does not have. Stay close to each new OpenClaw stable release.
- **Top-notch design.** Every screen feels premium, in dark mode and light mode, on phone and desktop. The installed web app is first-class, as close to native as possible.
- **Core loop first.** Ask, watch the plan, get a useful answer. This loop must be excellent before new features.

## What Crewhouse is not

- **Not a new OpenClaw.** It does not rebuild the agent loop, tools, sessions or providers.
- **Not a hosted service.** There is no Crewhouse server and no telemetry.
- **Not a household or family assistant.** One install is one person's assistant.
- **Not tied to one AI provider.** No single account is the product.
- **Not an assistant that acts alone.** It does not send, post, spend or delete without your yes.

## Next milestones

Each release is on the [releases page](https://github.com/umeranjum17/crewhouse/releases).

1. **Cloud and Linux release (cloud-v0.1.2 and linux-v0.1.3).** A cloud computer is ready faster after you press start.
2. **Phone preview .24.** You speak to Chief on the phone and your words land in the message box.
3. **OpenClaw extended-stable with its own learning.** The crew learns from how you work through the engine's own learning, and you can still forget what it learned. A long job given to a helper shows as still working, never as a false failure.
