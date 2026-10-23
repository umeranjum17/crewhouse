# Composio read policy

Source: `src/policy.ts` (`effectOf`, `acts`), `src/crew.ts` (engine-host gate, task completion).

## Drive

Run `node scripts/test.mjs test/composio.test.ts` under the usual isolated test wrapper. It starts real Crew instances with StubRuntime, signs the synthetic Composio connection in, and holds a Chief task while driving the public engine-host gate directly. No hosted tool is executed.

The table covers FETCH, LIST, GET, SEARCH, READ and FIND actions; every listed mutation verb; read/write mixtures in either order; compound unknown actions; substring and malformed-name lookalikes. Clear read actions pass with zero cards and no `acted` flag. Finishing the held task without `crew_outcome` ends `done`. Unknown or mixed actions ask as `send`, with no standing approval; two approved writes ask twice and still end `unsure` without an outcome. Disconnecting blocks even a read name at admission.

The Gmail routing journey in that file signs Composio in, reads Chief's actual engine-host tool offer, and checks that native Gmail, drafts/labels and sending grants are absent from its app enum. Scripted `crew_connect` calls for all three still return Composio connection-link guidance without opening a native card. Disconnecting restores the native Gmail Connect card; Calendar remains offered. Even with an older installed Chief job, the actual RunSpec prompt supplies the exact virtual schema call `return await MCP.composio.$api("COMPOSIO_MANAGE_CONNECTIONS", {schema: true});` in code-mode exec (JavaScript, not a shell), or the advertised `composio__COMPOSIO_MANAGE_CONNECTIONS` direct tool. Chief calls the function in that returned header, never reads engine files or searches node_modules. The prompt requires read-only access for reads, stopping if that cannot be requested, showing the actual returned consent link as an exception to ordinary chat's no-links rule, and waiting for consent. The native offer and stale-call result carry this same guidance. OpenClaw registers static tool schemas, so the host-offer enum alone is not model-side enforcement: the shared connect handler is the deterministic barrier against native cards, including calls from an older installed Chief job. No Composio link is fetched or Gmail read executed by this test.

Capture the regression smoke at the committed head with `CHROME_DEVTOOLS_AXI_SESSION=<task> done-done run screens`. Inspect its Home and Chief captures in both themes and widths. Retain the integration-test log separately as the routing/policy evidence. Under a no-real-model brief, run captures only: do not call the model judge, check, receipt or maintain commands. Report those checks as NOT RUN rather than claiming a sealed judge pass.

## Limits

This proves name classification and the real gate/task lifecycle, not Composio's remote implementation or message contents. Compound and unrecognized actions remain conservative asks. Live Gmail acceptance, model choice of tools, native and installed-PWA execution are not performed by this recipe and need separate authorization. Never use the owner's installed app, sign-ins or a real Composio call here.
