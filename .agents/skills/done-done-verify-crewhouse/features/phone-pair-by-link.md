# Pairing a phone with one link

Part of the crewhouse verification map. Source: `docs/verification/phone-pairing.md` ("One link").

## How to get to it (user POV)

On the computer, `./crewhouse link` prints one link (Settings › Phones and the desktop app's "Add a phone" card show the
same link beside the QR, with Copy). The link opens a page crewd serves on the tailnet: "Add this phone to Crewhouse"
and one big button, **Open Crewhouse and join**. The button hands the app a ticket minted when the page was opened. If
the app is not on the phone, the page then says so and offers **Download the app**; after installing, tapping the same
button again opens the app, which asks the computer, and the person says yes to the two words there. The app's first
screen also has **Paste a link**, which takes the same text. The link keeps working for the person's own devices;
`./crewhouse link new` replaces it and the old one stops opening.

## Driving it

1. An emulator (start it through the memory gate, stop it after; Play image so it has Chrome) and a release APK built
   from the commit under proof (`phone-first-run.md` step 1).
2. A lab whose link listens on the Tailscale address too: `LAB=<lab> LAB_LINK_HOST= bash scripts/verify/pair-lab.sh up <repo>`.
3. `LAB=<lab> node scripts/verify/phone-pair-link.mjs --serial <emulator> --apk <apk> --out <dir>`: opens the link in
   the emulator's browser with the app absent (install branch), installs, taps the link (app opens and pairs), clears
   the app, pastes the same link on the first screen (pairs). It takes shots only before a pairing starts and after it
   lands, so no pairing words reach a file.
4. Capture the desktop card (`#/settings` Phones, or the app's Add a phone) at 390 and 1440, day and night, and the page at 390.

## Pitfalls

- A preview APK built before this change ignores the link (its handler ran only in dev builds); build the candidate.
- Anyone holding the link can ask to join; nothing joins until the person at the computer says yes.
- Tickets never go in a file, a log or a shot; the page, `/ticket` and the intent carry them only to the phone.
