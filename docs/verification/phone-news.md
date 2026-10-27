# News on an Android phone with the app closed

An Android phone needs no push credential: once paired it keeps its link to the computer in a foreground service, with the ongoing "Crewhouse is connected" line, and shows crewd's `news` link event itself (`mobile/src/news.ts`, `LinkService.kt`). Chief's reply, a card that needs the person's yes, a helper's finished job and something that didn't work each show as a notification, and a tap opens that chat or card. The service comes back after the phone kills the app, after a reboot and after an update, without the app being opened. The notification question is asked once, when pairing succeeds.

## Driving it

Needs an emulator of the task's own (memory gate, stopped after), a release x86_64 APK built from the head after `npx expo prebuild -p android --clean`, and a built web app (`npm run build:web`, the pairing lab serves it).

```bash
FM_MEM_GATE=~/firstmate/config/fm-mem-gate.sh bash scripts/verify/phone-news.sh <out> [apk]   # or SERIAL=<emulator> to use one already running
```

The pairing lab ([pwa-pair.md](pwa-pair.md)) runs the stub engine with its scripted replies (`LAB_GOLDEN=1`). The journey pairs by the typed relay code, captures the first-run notification question and says Allow, then sends Chief messages from the computer:

1. Backgrounded (the phone's Home screen): "hi" → Chief's reply notification; a tap opens Chief's chat.
2. Killed (the app's process killed as the phone kills it; no screen open): the service comes back by itself; "I need someone to sort out my invoices" → the hire card's notification, a tap opens the card; yes at the computer → "Invoice Ivy finished", a tap opens her chat.
3. Rebooted in dark mode, the app not opened: the ongoing line is back and "hi" → Chief's reply notification.

Stills in `<out>`: `news-permission-first-run-phone-390.png`, `news-backgrounded-chief-reply-shade.png`, `news-chief-reply-opens-chat-phone-390.png`, `news-killed-hire-card-shade.png`, `news-hire-card-opens-card-phone-390.png`, `news-helper-finished-shade.png`, `news-finished-opens-chat-phone-390.png`, `news-after-reboot-dark-shade.png`, and the step record. Exit 0 means every notification was listed by the phone and every tap opened its screen.

Not covered: news that came while the link was down (during a reboot, say) is not shown afterwards; a phone in Doze may hold the link's network for a while (FCM or UnifiedPush would spare the battery; a later ticket).
