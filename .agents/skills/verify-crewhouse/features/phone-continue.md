# Continue on your computer, on the real app

A phone that ran Chief alone (`features/phone-only-signout.md`, `features/phone-chat-keep.md`) keeps that chat in
app storage. Once the phone is paired, pairing wins, so the chat would otherwise stay behind. Home (and Hello, before
onboarding) then shows one card, **Your chat from this phone**, with **Continue on your computer** and **Not now**
(`ContinueOffer` in `mobile/App.tsx`). It shows only while the phone can act, the kept chat has a turn, and no
message is still queued.

Continue sends the whole chat as one message to Chief (`POST /api/bots/chief/messages {text, move}`,
`docs/ui-contract.md`): one opening line, then one list item per turn, `- You:` / `- Chief:`, a phone document as its title with "The file stays on
my phone", the oldest turns left out past 40,000 characters with "(Earlier turns left out.)". crewd makes it one Chief
task with no routing (so a transcript that says "pair a computer" never turns into a pairing card) and keys it on
`move`, the chat's last request id, so a resend stores nothing twice. The phone erases `phone-chat.jsonl` and
`phone-requests.jsonl` only after crewd answers; the `chief-*.docx` files stay. A failure, or 30 s with no answer (the
link's `notValidAfter`, so a computer that wakes later never starts it), keeps the copy and says "… Your chat is
still on this phone." Not now hides the card until the app opens again or pairs again.

`scripts/phone-continue.mjs` drives it on a task-owned google_apis emulator against the pairing lab
(`scripts/pair-lab.sh up`, stub engine), paired by the typed code:

```bash
LAB=<lab> node .agents/skills/verify-crewhouse/scripts/phone-continue.mjs --serial <emulator> --ev "$EV" \
  --apk mobile/android/app/build/outputs/apk/release/app-release.apk --key-file /home/umer/.config/openrouter/api_key
```

It writes `$EV/screens/01-phone-only-chat.png` (a real chat; with no OpenRouter credit the plain error lines are the
chat, and its log says so), `02-offer.png`, `03-moved-phone.png` (the paired Chief thread with the moved message),
`04`-`06` (a seeded 52-turn chat with one very long answer: Not now keeps it, the offer is back on the next open),
`07-failed-send.png` (crewd frozen with SIGSTOP: the plain line, the copy kept), `08-moved-after-retry.png` (SIGCONT,
Continue again: stored once, trimmed with the note) and `09`/`10` (the offer and the thread at 360 dp and 1.3x text,
night and day), plus `phone-continue.log` (message counts from crewd's own API, the phone's files before and after),
`moved-message.txt` and `moved-long-message.txt`.

The computer's half is the ordinary Chief thread: capture it with `scripts/screens.sh "$EV/screens" chief-moved
"http://127.0.0.1:$PORT/"` after opening the launcher URL once (four files: night and day, 1440 and 390), and check the
moved message reads as a list, one turn per item (the web thread is Markdown: plain lines would run together).
