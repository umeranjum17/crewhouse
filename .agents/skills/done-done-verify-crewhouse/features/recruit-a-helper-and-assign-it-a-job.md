# Recruit a helper and assign it a job

Part of the crewhouse verification map. Source: `docs/verification/recruit-assign.md`.

## How to get to it (user POV)

Send a message to Chief that carries a crew_recruit tool call, then post a job in the new helper's own thread.

## Driving it

Harness: curl for the HTTP API; chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Launch the app as SKILL.md says and wait until it is ready.
2. POST {"text":"[tool crew_recruit {\"template\":\"reel\",\"name\":\"Reel\"}]"} to /api/bots/chief/messages, then POST {"text":"Make a 10 second demo"} to /api/bots/reel/messages; poll /api/bots/reel until that task is done and check the Reel helper appears in /api/state.
3. Capture: save the output and exit status to $DONE_DONE_EVIDENCE_ROOT/recruit-a-helper-and-assign-it-a-job.txt, as SKILL.md's Evidence section says.
4. Stop what you started.

The drive changes no repo file: note findings in the run's report; after the drive, run done-done maintain to see what drifted, then fix the skill.
