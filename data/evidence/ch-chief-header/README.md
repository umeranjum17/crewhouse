# Chief header, one compact row — proof

Branch `fm/ch-chief-header`. The Chief screen header is rebuilt as one centred
row (avatar, name, the single status, gear) with the Chief | Office switch as
its own full-width row under it, on both surfaces. The avatar art is unchanged.

## What a person can now do

See who Chief is, whether he is at work, and switch to Office in one compact
header that no longer eats a third of the screen before the first message.

## How the proof was taken

The web surfaces come from a **real crewd on the stub engine** (`CREWHOUSE_ENGINE=stub`),
throwaway HOME/XDG, person **Umer**, driven at 390x844 and 1440x900, day (`?day`)
and night (`?night`). The phone surfaces are the native Expo app on an Android
emulator and the installed PWA. `capture.sh` captures the browser pair;
`pwa-capture.mjs` pins `display-mode: standalone` (what an installed home-screen
app reports) for the PWA pair.

## Files

- `screens/before-*` / `screens/after-*` — web at 1440 and 390, night and day.
- `screens/android-before-*` / `screens/android-after-*` — the native app, night and day.
- `screens/pwa-before-*` / `screens/pwa-after-*` — the PWA (standalone) at 1440 and 390, night and day.
- `screens/pwa-android-*` — the installed PWA on the Android emulator.
- `motion/chat-office-switch.webm` — the Chat | Office switch interaction.
- `geometry-header.json` — the header geometry at 390: one row, a single status
  element, the switch full-width below the row, the avatar centred on the name.

## Faults fixed (from `geometry-header.json` and the before shots)

1. The switch was nested in the avatar's right text column; now it is its own row below.
2. Two status lines said the same thing ("At work" and "All quiet."); now exactly one.
3. The tall avatar was not centred on the title and the gear floated apart; the
   row centres them (`artCenteredOnNameDeltaPx: 0`).
4. The header is compact (103px of an 844px phone viewport).

Note: the 1440 day views are byte-identical before/after — the desk rail keeps its
own header; the change is phone-width only, applied to both the native and web surfaces.
