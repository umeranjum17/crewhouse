# Phone-only chat kept on the phone, on the real app

Phone-only mode keeps Chief's chat in app storage (`mobile/src/phone-only.ts`: `phone-chat.jsonl`, the
request index `phone-requests.jsonl`, and `phone-meta.json` for the last-heard time, all in the app's own
document dir). A turn's `you` line is written before the send and its `chief` line after, so a turn with
no end comes back **Stopped.** with **Try again**; a document effect journalled `started` and never
closed comes back **Interrupted. Retry?**; a message written with no connection shows **Queued, not sent
yet** and goes once, by itself, when the phone hears the provider again. Nothing reruns on its own.

`scripts/verify/phone-chat-keep.mjs` drives the release APK on a task-owned emulator (google_apis image, so
`adb root` can seed and read the app's files) with the OpenRouter test key (pushed and typed on the
device, never in argv or logs, erased at the end):

```bash
node scripts/verify/phone-chat-keep.mjs --serial <emulator> --ev "$EV" \
  --key-file /home/umer/.config/openrouter/api_key --apk mobile/android/app/build/outputs/apk/release/app-release.apk \
  --interrupted --offline --seed-turns 52
```

It proves, with a screenshot each under `$EV/screens/`: a real turn and a document card, force-stop and
relaunch with the chat (and the card's Read) intact; a kill mid-turn leaves Stopped + Try again, and Try
again answers; the state a kill inside `crew_document` leaves (seeded: the write between the `started`
journal line and `done` is too short to hit with a kill) reopens as Interrupted + Retry and Retry keeps
exactly one file; offline (wifi and data off) shows the pinned banner with the last-heard time, an inert
Try again, a send shown "Queued, not sent yet", and the queued turn answered once after the network
returns with no relaunch; 52 seeded turns load and scroll, and 1.3x text at 360 dp; "Use a computer"
keeps the chat, the confirmed Sign out deletes it and every document Chief made here.

When the OpenRouter balance is empty (HTTP 402; the kit shows it as the plain "check internet" error),
pass `--no-answers`: the kill leg then kills on the turn's start marker, the real-answer and document legs
are not proven (say so), and persistence is proven with the turns you have.

The approval sheet (`AskSheet`, the paired app) shows the exact outgoing text in full (no preview cut),
two answer buttons, and Edit / Read all / a standing answer only as small links; nothing answers on a
timer. `scripts/verify/phone-asksheet.mjs` proves it on a paired emulator (`phone-pairing.md`, the lab from
`pair-lab.sh`), paired by the typed code: a Reel file-write ask reaches the sheet through Office -> Reel's
desk -> Review (the phone has no Needs you pin for a helper's ask) and stays up 30 s unanswered; a Reel
`crew_draft` email lands in Chief's thread with the body exactly as written, whole:

```bash
LAB=<lab> node scripts/verify/phone-asksheet.mjs --serial <emulator> --ev "$EV" --apk <apk>
```
