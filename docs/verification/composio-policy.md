# Composio read policy

Source: `src/policy.ts` (`effectOf`, `acts`), `src/crew.ts` (engine-host gate, task completion).

## Drive

Run `node scripts/test.mjs test/composio.test.ts` under the usual isolated test wrapper. It starts real Crew instances with StubRuntime, signs the synthetic Composio connection in, and holds a Chief task while driving the public engine-host gate directly. No hosted tool is executed.

The table covers FETCH, LIST, GET, SEARCH, READ and FIND actions; every listed mutation verb; read/write mixtures in either order; compound unknown actions; substring and malformed-name lookalikes. Clear read actions pass with zero cards and no `acted` flag. Finishing the held task without `crew_outcome` ends `done`. Unknown or mixed actions ask as `send`, with no standing approval; two approved writes ask twice and still end `unsure` without an outcome. Disconnecting blocks even a read name at admission.

Capture the regression smoke at the committed head with `CHROME_DEVTOOLS_AXI_SESSION=<task> done-done run screens`. Inspect its Home and Chief captures in both themes and widths. Seal an honestly bounded Home/Chief smoke claim; retain the integration-test log separately as the policy evidence.

## Limits

This proves name classification and the real gate/task lifecycle, not Composio's remote implementation or message contents. Compound and unrecognized actions remain conservative asks. Live Gmail acceptance, model choice of tools, native and installed-PWA execution are not performed by this recipe and need separate authorization. Never use the owner's installed app, sign-ins or a real Composio call here.
