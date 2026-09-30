# Ecosystem-first check (ClawHub and the bundled OpenClaw 2026.8.1 catalog)

Historical investigation, 2026-09-27 (the directive recorded at that time): before retaining or building any custom tool, skill, integration or helper, check
ClawHub and the official OpenClaw ecosystem for a mature supported equivalent; prefer upstream plus the smallest
adapter. This is the bounded, inspectable record for the B2 build. Method: `openclaw skills search` and
`openclaw plugins search` on the pinned 2026.8.1 CLI (read-only; no installs, no sign-ins, isolated HOME), plus the
bundled skill list in the pinned tarball. Popularity and catalog presence were not treated as trust: only the
bundled (tarball-provenance) set and `@openclaw`-scope releases are trusted in v1 (spec §5.2).

This records what the earlier investigation actually ran, including direct OpenClaw CLI discovery; it is not an approved integration workflow. The current boundary requires BYOKit for every third-party and foundational path. Missing kit capabilities are migration debt to fix and publish upstream before deleting the raw implementation. Product policy and presentation stay here: the policy gate row below remains app-owned; its execution foundations need kits.

## Historical ecosystem adoption

| Capability | Source | Crewhouse adapter |
|---|---|---|
| Agent loop, sessions, steer/abort, history | OpenClaw core (bundled) | The runtime port (`src/runtime.ts`, `src/openclaw/`) |
| ChatGPT/Codex sign-in, refresh, cooldowns | Bundled `openai` provider, `openclaw.setup.auth.start` | The one-button card (sign-in step of this build) |
| Keyless web search + SSRF-bounded fetch | OpenClaw core `web_search`/`web_fetch` | Adopted in the ecosystem step (B4); fenced helpers keep crewd's hop-checked copy (`crew_web_*`) |
| Memory recall | Bundled `memory-core` (FTS) | Adopted in the ecosystem step; the official `@openclaw/memory-lancedb` needs paid embeddings that 429 on a subscription, so FTS stays |
| Self-learning + weekly collection review | OpenClaw Skill Workshop, `auto` | "Learned … [Forget]" surfacing, per-member workspaces (learning step, B5) |
| Media: `view_image`, `pdf`, `image_generate` | Core + bundled `openai` | Adopted in the ecosystem step |
| Clip ingredients | Bundled `video-frames`, `openai-whisper`, `summarize`, `nano-pdf`, `diagram-maker` | `allowBundled` after SKILL.md review; ffmpeg/whisper as kit tools |
| Run/tool event stream | Core protocol (`tool-events` cap) | crewd's own `run.call` record + the drawer |

## Historical bespoke decisions and remaining migration debt

| Crewhouse component | Strongest catalog/native alternative | Why the ecosystem answer loses |
|---|---|---|
| `crew_workbook` / `crew_document` | Catalog xlsx/docx skills (mirrors of Anthropic's skills, `@ivangdavila/*`, `skills-sh/*`) | All are prompt packs teaching the model to run `openpyxl`/`docx-js` itself; the trusted-scope set has none. They are "Not scanned by ClawHub" mirrors or unvetted publishers, and none deliver crewd-written, gated, previewable finished files |
| Per-bot desktop browser, wheel handoff, press cards | Catalog browser-automation skills (Puppeteer CLI packs); OpenClaw's bundled browser | Catalog entries are untrusted publishers; the bundled browser has no per-bot desktop, no Take over/Give back, no page-read press/checkout cards |
| Gmail/Calendar connections | Bundled `himalaya`, `gog`; catalog Gmail/Calendar skills | All act in the person's name with broad scopes; Crewhouse connections keep per-member OAuth, read-mostly scopes, and card gates on every write |
| `crew_verify` (sandboxed patch proof) | — | No catalog equivalent; genuinely missing |
| Routines with model-free watches | OpenClaw cron/automations | Cron runs cost model tokens on a quiet day; crewd watches read pages for free and wake the bot only on change |
| The policy gate itself | OpenClaw approval hooks | By design crewd's asks are the single authority; upstream approvals are capped at 10 minutes and would fork the trust boundary |

## Distinguishable from bundled

The 51 bundled skills in the pinned tarball were reviewed as a set (spec §5.1): the acting-in-the-person's-name ones
(`himalaya`, `gog`, `github`, `notion`, `ordercli`, `1password`, …) stay off; the developer/operator ones (`clawhub`,
`skill-creator`, `mcporter`, `tmux`, …) stay off; only the reviewed media/summarizing set is allowlisted.

## Historical maintenance reduction

Pi's in-process engine, its session plumbing, the resource-loader discovery suppression (`isolate.ts`), and
the then-used `@byokit/accounts` sign-in/refresh/resting controller were deleted in that build. This did not resolve all kit reuse: the current OpenClaw kit owns the engine and wizard, while account state/failover, usage, persistence, sandbox/browser/desktop, app connections, documents and scheduling still require upstream kit contracts. The historical bespoke table is not an exception to that boundary.
