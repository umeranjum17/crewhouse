# Onboard and chat with Chief

Part of the crewhouse verification map. Source: `docs/verification/runbook.md`.

## How to get to it (user POV)

Open the app's first screen (Hello), or call the API directly after a fresh lab starts.

## Driving it

Harness: curl for the HTTP API; chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Launch the app as SKILL.md says and wait until it is ready.
2. Curl -X POST with the person's authority to /api/onboard with {"address":"Sir"}; then POST {"text":"I need a demo video"} to /api/bots/chief/messages; poll GET /api/bots/chief until the reply 'stub chief: done with "The person says: I need a demo video"' appears.
3. Capture: save the output and exit status to $DONE_DONE_EVIDENCE_ROOT/onboard-and-chat-with-chief.txt, as SKILL.md's Evidence section says.
4. Stop what you started.

The drive changes no repo file: note findings in the run's report; after the drive, run done-done maintain to see what drifted, then fix the skill.
