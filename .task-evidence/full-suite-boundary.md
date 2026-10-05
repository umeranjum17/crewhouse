# Full suite boundary — unrun

`./crewhouse test` was NOT run in this recovery. A source check of the already-installed kit found normal engine shutdown group signals:
- node_modules/@byokit/openclaw/dist/engine.js:293 spawns detached:true.
- :351 process.kill(-child.pid, 'SIGTERM').
- :358 process.kill(-child.pid, 'SIGKILL').

This is outside the Office/teach-only source safety slice. No installed dependency or product source was changed. Executing the whole suite's real engine journeys would violate the current no-group-termination boundary. The original frozen packets remain untouched/unrun. Full-suite qualification needs a separately authorized safe kit/packet; targeted Office/teach proof and isolated TypeScript check do not establish full-suite stability or whole-owner equality.
