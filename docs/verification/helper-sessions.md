# Helper sessions, personality and private notes

Automated integration: `node --test test/helper-sessions.test.ts test/restart.test.ts`.
The real HTTP recruitment/message path creates a note file at hire, saves a helper-only
preference through the policy-gated `crew_remember`, finishes a second held job on the
same key, restarts the crew/store, and checks the same key and private notes reach Scout
but not a helper hired after restart. Optional helper `IDENTITY.md` is session context.
`test/openclaw-soul.test.ts` witnesses the actual engine request: Chief's edited soul
reaches Chief only, Scout's own soul reaches Scout, and shared workspace identity is neutral.

For the installed-CLI acceptance, use the pinned kit's documented `openai-codex` backend
with the installed signed-in Codex CLI and normal HOME. Never sign in, read/copy a login,
or drive an installed Crewhouse. Launch an isolated crew/state/server from this tree,
select `openai-codex/gpt-6-luna` as its kit default, and witness
`kit.signedIn('m1', 'openai-codex')`. Crewhouse's existing account UI still labels this
proof route ChatGPT; seed its readiness only from that kit witness, not a hard-coded yes.
No agent loop, tool, persona, reply or session handling is replaced.

1. Recruit Scout. In its own chat ask for one useful answer and its name; confirm a real visible reply.
2. Tell Scout a distinctive preference about its research, explicitly private to Scout.
   Ask it to save with `crew_remember` without `everyone`. Check the durable note and tool-call event.
3. Stop the task-owned server and kit completely, then start a fresh process on the same state.
4. Ask Scout to recall the preference without repeating its value. Check the visible answer,
   persisted task session key and retained engine conversation. Recruit a second helper and ask
   what Scout was told; it must not know the value. Check its own separate key and note file.
5. Capture 390px day/night plus a short interaction recording from the real web app;
   open every capture and check words, clipping, overlap and count/status consistency.
   Check standalone/PWA display as well. Keep evidence private and uncommitted.

No legacy-history adoption, separate agent directories or separate helper engine agents.
The full OpenClaw suite and owner's unchanged-Pi gate run in CI, not on the shared host.
