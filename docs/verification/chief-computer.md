# Settings › Chief's computer

Release-default on phone and web (explicit `EXPO_PUBLIC_CREWHOUSE_CLOUD=0` / `CREWHOUSE_CLOUD=0` opts out).
Approved `computer` mock: `scripts/verify/mocks.tsv`. The provider key stays only on the phone that set up the
computer. Boat forbids browser management (CORS), so the web/PWA page names the phone requirement and disables
provider actions; it never pretends an action succeeded.

## Phone controls

`mobile/App.tsx` calls `web/src/cloud.ts` `computerCall` through the pinned `@byokit/cloud` 0.6.1:

- Read the bound machine's real disk usage and latest snapshot. Normal is below 80%, Getting full below 95%,
  Full otherwise. No snapshot time or update status is invented. The secure record's host must match this phone's
  paired host; a retained key from another cloud computer cannot manage the current pairing.
- Update computer installs the latest release archive with the recipe's `update` argv, then the kit restarts the
  host. The download is unpacked and validated before replacing the old release; a failed download leaves it intact.
- Save a snapshot calls `snapshot({keep:7})`. Retention failure says the snapshot was saved but pruning failed.
- Reset computer is disabled until there is a snapshot. Its warning names the exact snapshot time and the lost
  chats/files. Cancel changes nothing. Confirm calls `restore` with that displayed snapshot's ID, not a newly
  chosen copy. The kit persists the replacement machine; its new relay address is saved to the phone's grant
  before subsequent metadata reads. The snapshot restores the sign-ins and phone access it held at that time.
- Daily snapshots and Undo update say **Not available yet** and are disabled. The kit's scheduler only runs while
  the app runs; it is not an always-on backup service. No app timer or provider key on crewd substitutes for it.
- Delete asks explicitly and uses the kit's remove; Forget key removes the provider record from this phone.
- Every request has busy protection, failure words and Refresh computer; no unconditional-success placeholder.

## Drive and evidence

No real model or provider spend is needed. First run:

```
node scripts/test.mjs test/cloud-connect.test.ts test/cloud-install.test.ts
```

This extends the existing real headless-host / HTTP-provider journey through the actual management dispatcher:
wrong-host refusal, disk, reset-before-save refusal, update/service restart, save, changed file, reset back to
that file's saved bytes and the replacement's relay address. The on-disk release journey also executes the
recipe's update shell on a read-only download and checks failed-download preservation.

For native captures, build the release APK through the fleet memory gate, with **no cloud-enable variable**;
only `EXPO_PUBLIC_CREWHOUSE_BOAT_API` points to the task's fake-Boat API. Use the owned/private emulator recipe in
[where-cloud.md](where-cloud.md). Start `boat-fake-lab.mjs` with private HOME/XDG and a task-owned `LAB_DIR`, and
script its `df` response from a synthetic disk (the live machine path is covered by the kit dispatcher journey).
Walk Cloud → Sign in to boat.dev with a code (or Other ways (advanced) → Paste a boat.dev key) → Use this computer → Ready. The computer's binding is written by real crewd. Pair to that same
lab through its typed relay code without clearing the app's secure store, then Settings → Chief's computer.
Capture disk, Save a snapshot, Reset warning/Cancel, unavailable Daily snapshots and Undo, and Refresh error/retry.
Never point a fixture build at a real provider or use real keys. The fake provider cannot route its public
`boat.test` URL; don't call that a real-cloud round trip.

For web/PWA, use [runbook.md](runbook.md) and the installed shell [pwa-pair.md](pwa-pair.md): capture the page at
390 and 1440 in day/night. Controls are disabled and say to use the owner phone; Daily/Undo say Not available yet.
For the chooser, use [where-cloud.md](where-cloud.md). Open every retained shot and compare it beside its approved
mock; approved automatic backups remain an explicit limitation, not a visual-match claim.

Seal the exact-head real-product capture with `done-done run --open`, capture into its printed folder, write a
steps.json describing only witnessed behavior, then `done-done run --close <id>`. A sealed run is not a judge PASS;
request the bounded check/receipt separately and report any unperformed native/provider acceptance honestly.
