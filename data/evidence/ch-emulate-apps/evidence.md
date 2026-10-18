# Google emulator app-journey evidence

- `npm run check` - PASS (TypeScript check, exit 0).
- `node --test test/line-budget.test.ts test/google-emulator.test.ts` - PASS (source line budget and Gmail/Calendar end-to-end emulator journey, 2 tests, 0 failures).
- The journey connects Gmail, Gmail drafts/labels, and Calendar through Crewhouse, reads the seeded inbox and events, creates a draft and label, and verifies emulator state reports zero sent messages.
- CI already runs this test in the `app` group through `npm test -- --group=app` in `.github/workflows/ci.yml`.
- `emulate` is exactly pinned to 0.12.2; `@byokit/connect` is exactly pinned to 0.7.0.
- Limitations: the direct Gmail/Calendar API calls retain the existing emulator API-base route until Composio tools replace them. BYOKit 0.7.0 endpoint settings do not recognize the distinct `gmailwrite` provider ID, so its OAuth URLs retain the existing test-only override. No GitHub, Drive, or real-account journey is included.
- CI's first app-group run found the source line budget exceeded by one line; the endpoint configuration was compressed and the line-budget test now passes.
- Full captured command output after that correction: `validation.log`.
