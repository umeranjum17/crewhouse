# Chief waits for the helper's report

Chief hands a job to a helper natively and waits: the helper's report comes back in Chief's next turn, and Chief
answers the person from it there. While the helper has the job, Chief does no work of its own, so a model that does
not wait cannot go after the helper's file, send the job twice, or park the person's job on a question.

## Drive and witness

`CHROME_DEVTOOLS_AXI_SESSION=<task-name> scripts/verify/chief-wait.sh <out-dir>` (the done-done journey
`chief-wait`). It boots one isolated lab on the real engine (OpenClaw through the BYOKit kit) with a scripted model
and one helper on the crew, asks Chief to get the helper to read a file and bring back its reference, and waits,
bounded, for Chief's job. It spends nothing: no account, no network, no model call.

Exit 0 only when the job ended `done`, its answer carries the helper's report, no question reached the person, and
Chief made no call of its own while the helper had the job; the job's own record and the crew's events land in
`thread.json`, `state.json` and `events.json`.

The same drive on the old code ends in the drift: Chief works past the hand-off (it reads the helper's file, which
is not there) instead of waiting for the report.

## Capture

`chief-wait/screens/chief-{night,day}-{390,1440}.png`: Chief's thread on the real app with the answer his helper's
report brought, in both themes at phone and desktop width.

## Limits

The model is scripted, so this proves the crew's own behaviour (the hand-off, the wait, the answer) and not a live
model's choice to wait; a live Flash run needs the person's spend approval. The installed PWA and the phone are not
part of this drive.
