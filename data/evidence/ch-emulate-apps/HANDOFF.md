# Emulate app-connect handoff

## Useful work committed

- `emulate` is already exactly pinned to `0.12.2` in `package.json` and `package-lock.json`.
- `test/google-emulator.test.ts` already proves a real Crewhouse Gmail and Calendar journey against Vercel's stateful Google emulator, including OAuth connect, inbox read, draft, label, calendar read, and emulator-witnessed empty Sent.
- Extracted startup and Umer/invoice-style demo seed data into `test/emulate-google.ts`; `startGoogleEmulator(callbackPort)` binds the emulator to an OS-assigned loopback port and returns an awaitable `close()` handle.
- Existing CI `npm test -- --group=app` includes `test/google-emulator.test.ts`.

## Validation

- `npm run check` passed.
- `node scripts/test.mjs test/google-emulator.test.ts` passed: one Gmail/Calendar end-to-end journey, zero failures.

## Remaining blocker

The test currently overrides OAuth URLs on `crew.connections.apps[app]` and routes Crewhouse Gmail/Calendar API calls through `CREWHOUSE_GOOGLE_EMULATOR`. BYOKit `@byokit/connect@0.5.0` does not expose kit-owned base URL configuration for OAuth, token, Gmail, Calendar, Drive, or GitHub endpoints. The exact needed kit capability is an options/env seam owned by BYOKit that maps these endpoint bases to local emulator URLs. Firstmate has filed this request in the BYOKit home as `ext-byokit-connect-endpoints`.

After that seam lands, remove the Crewhouse-side endpoint overrides, migrate the other real sign-in app journeys that use the kit, add the explicit opt-in real-account test and release note, then run and capture the emulator journeys in CI. No GitHub/Drive journey or real-account test is claimed by this handoff.