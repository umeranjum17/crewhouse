# PWA demo boot

The published static shell (`web/dist`) has no backend of its own. With no query its `start_url` `/`
opens Chief's first question, "Where should I work?" ([where-cloud.md](where-cloud.md)); `?demo` boots the
in-bundle demo (`web/src/demo.ts`). The desktop's own pages stay real. The decision lives in
`web/src/api.ts` (`demo`), and it is runtime state, not a second build.

## What it proves

- A page served from a **public static origin** (not crewd's loopback) with **no query
  parameter** shows "Where should I work?" (`.where`), with no `/api` request. With `?demo` it shows the
  app in demo: the header tag reads "Demo" and the crew and their jobs come from `web/src/demo.ts`.
- The same bytes served by **crewd on its loopback** load the real app (or the Hello screen
  before onboarding): no "Demo" tag.
- `?demo` forces demo anywhere, `?real` forces a backend even on the public shell.
- A pairing grant stored in the browser boots the public shell paired instead (see [pwa-pair.md](pwa-pair.md)).

## How to drive it

Serve the built shell from a public-style origin. crewd answers only loopback
(`src/server.ts`), so a `*.localhost` host is loopback to the browser but not a loopback
name to the app — exactly the published shell's situation:

```bash
node scripts/build-web.mjs
node scripts/verify/serve-web.mjs web/dist   # prints http://crewhouse.localhost:<port>/
```

Open the printed `http://crewhouse.localhost:<port>/` in the task's browser (a non-loopback
hostname). Then drive the real app from crewd's own loopback (`http://127.0.0.1:$PORT/#person=…`, see
[Drive](runbook.md#drive)) and confirm no "Demo" tag.

## Read it

```js
({ demo: !!document.querySelector('.demo-tag'), where: !!document.querySelector('.where'), title: document.title })
```

- Public origin, no params: `where: true`, `demo: false`, title `Crewhouse`.
- Public origin, `?demo`: `demo: true`.
- crewd loopback, no params: `demo: false` (Hello or the person's crew).
- `?real` on the public origin: `demo: false` (the request fails, as expected with no backend).
- `?demo` on crewd loopback: `demo: true`.

## Evidence

The Review evidence set from [`runbook.md`](runbook.md): the boot screen in dark and light
at 390 and 1440 from the real running shell. For the installed PWA (the captain's PWA-first
bar), install the deployed `*.pages.dev` shell and capture its first launch, which lands on
this same first question.
