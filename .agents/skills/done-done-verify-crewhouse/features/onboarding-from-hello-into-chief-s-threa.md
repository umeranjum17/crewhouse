# Onboarding in Chief's chat

Part of the crewhouse verification map. Source: `docs/verification/onboard-chief-chat.md`.

## How to get to it (user POV)

First run in a fresh browser session opens Chief's chat; he asks the name there, then pitches with ideas to try (no Hello screen).

## Driving it

Harness: curl for the HTTP API; chrome-devtools-axi with its own CHROME_DEVTOOLS_AXI_SESSION for the browser UI; a shell for the lab and teardown.

1. Launch the app as SKILL.md says and wait until it is ready.
2. Run `onboard-chat` (`scripts/verify/onboard-chat.sh`): it types the name in Chief's chat, opens How does this work?, taps an idea and captures each step at 390 and 1280, day and night.
3. Capture: screenshot the resulting page to $DONE_DONE_EVIDENCE_ROOT/onboarding-from-hello-into-chief-s-threa.png, as SKILL.md's Evidence section says.
4. Stop what you started.

The drive changes no repo file: note findings in the run's report; after the drive, run done-done maintain to see what drifted, then fix the skill.
