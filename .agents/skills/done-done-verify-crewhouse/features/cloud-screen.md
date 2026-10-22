# The phone's cloud screen

Part of the crewhouse verification map. Source: `docs/verification/where-cloud.md`.

## How to get to it (user POV)

On the phone app's first screen, In my cloud: paste a boat.dev key, then pick a computer, or make one when the account has none. The progress list says which step stopped and whether Try again is safe. A second phone on a computer another phone set up is offered Move Chief to this phone; after the confirm, the first phone loses access and this one reaches Chief.

## Driving it

1. Needs an emulator (start it through the memory gate, stop it after) and the flagged lab APK: `EXPO_PUBLIC_CREWHOUSE_CLOUD=1 EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:7411/api/v1`, Metro cache and generated bundle cleared first.
2. Run `SERIAL=<serial> bash scripts/verify/cloud-screen.sh <out> <apk>`; it starts `boat-fake-lab.mjs` with no computer in the account, drives Make, a failed install, Try again, and a second phone moving Chief to itself, and stops the lab.
3. Capture: `cloud-second-phone-{day,night}-390.png` (the offer) and the `cloud-screen` step record in the run folder; `cloud-{make,failed,ready,move-confirm,moved}-{day,night}-390.png` and the lab log in `CLOUD_OTHER` (the judge reads every capture in the run folder against one outcome). Exit 0 means every state was seen on screen.
