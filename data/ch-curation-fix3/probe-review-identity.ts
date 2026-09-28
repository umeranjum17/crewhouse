// Investigation probe for the curation capability question (round 3): does the pinned engine
// (2026.8.1) expose the collection review's exact session identity EARLY enough for crewd to bind
// the workshop window to the CURRENT review before its first skill_workshop call claims the window?
//
// Method: boot the real stack exactly like production (OpenClawRuntime: gateway child, crewhouse
// plugin, bridge socket), on a scripted loopback model so no account or network is touched. Run the
// engine's own `skill-collection-review-m1` cron job while
//   - polling `sessions.list` every 100ms and stamping when the review's incognito session key
//     first appears (and when it disappears),
//   - stamping every `skill_workshop` gate frame the reviewer actually sends over the bridge socket,
//   - recording every gateway event and the full cron run entry.
// The bridge is armed exactly like `runCollectionReview` does (captured member/review/action), so the
// reviewer's one reconcile passes and the run completes. Then:
//   keySeenBeforeFirstFrame  — crewd could have bound the exact key BEFORE the first claim, and
//   framesKeyEqualsObservedKey — the observed key is the frame key (binding is not a substitution).
//
// Run: node data/ch-curation-fix3/probe-review-identity.ts   (writes probe-results.json next to it)
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawRuntime } from '../../src/openclaw/runtime.ts';

// A loopback OpenAI-compatible SSE stub: any completion request whose last user message mentions the
// collection review gets one scripted skill_workshop action=reconcile tool call, then a plain reply.
function startReviewStub(): Promise<number> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const words = (m: any) => typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((c: any) => c.text ?? '').join('') : '';
      const messages: any[] = body.messages ?? [];
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
      const toolResults = messages.slice(messages.findLastIndex((m: any) => m.role === 'user') + 1).filter((m: any) => m.role === 'tool');
      const id = `probe-${Date.now()}`;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: object, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      if (/collection review/i.test(words(lastUser)) && !toolResults.length) {
        send({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: 'skill_workshop', arguments: '{"action":"reconcile","collection":[]}' } }] });
        send({}, 'tool_calls');
      } else {
        send({ role: 'assistant', content: 'review done' });
        send({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    })().catch(() => { try { res.writeHead(500).end(); } catch {} });
  });
  return new Promise((yes) => server.listen(0, '127.0.0.1', () => yes((server.address() as any).port)));
}

const results: any = { events: [], sessionsSeen: [], sessionsGone: [], frames: [], cron: {} };
const main = async () => {
  const stubPort = await startReviewStub();
  const state = mkdtempSync(join(tmpdir(), 'crewhouse-probe-'));
  const runtime = new OpenClawRuntime(state);
  const t0 = () => Date.now();
  let kickAt = 0;
  try {
    const host = { tools: () => [], gate: async () => ({ allow: false, reason: 'probe: no crew runs' }), call: async () => '' };
    await runtime.start(host);
    await runtime.configureModelProvider(`http://127.0.0.1:${stubPort}/v1`, 'probe-key');
    await runtime.setLearning(true); // workshop autonomous mode auto
    await runtime.learning(); // also creates agent m1 (the review job is per existing agent)
    const client = (runtime as any).client;
    (runtime as any).gateway.onEvent((event: any) => {
      results.events.push({ t: t0() - kickAt, event: event.event, runId: event.payload?.runId, sessionKey: event.payload?.sessionKey ?? event.payload?.key, stream: event.payload?.stream });
    });

    // Stamp the reviewer's gate frames: shadow the private curationAllowed on this instance (the
    // socket handler calls it with exactly the frame's key/tool/input).
    const bridge = runtime.bridge!;
    const inner = (bridge as any).curationAllowed;
    (bridge as any).curationAllowed = function (this: any, key: unknown, tool: string, input: any) {
      results.frames.push({ t: t0() - kickAt, key, tool, input });
      return inner.call(this, key, tool, input);
    };

    // The production arming: same captured member/review/action as runCollectionReview.
    bridge.armCuration({ member: 1, review: 'skill-collection-review', action: 'reconcile' }, 10 * 60_000);

    let job: { id: string; name: string; enabled: boolean } | undefined;
    for (const end = Date.now() + 15_000; Date.now() < end && !job?.enabled;) {
      const jobs = await client.request<{ jobs: { id: string; name: string; enabled: boolean }[] }>('cron.list', { limit: 100 });
      job = jobs.jobs?.find((j) => j.name === 'skill-collection-review-m1');
      if (!job?.enabled) { results.cron.jobsSeen = jobs.jobs?.map((j: any) => `${j.name}(${j.enabled})`); await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!job?.enabled) throw new Error('the collection review job is missing or disabled');
    // A workspace skill at the real layout so the review has a collection to review.
    const skillDir = join(runtime.workspaceOf(1), 'probe-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: probe-skill\ndescription: A probe skill for the identity probe.\n---\n\nDoes a thing.\n');
    kickAt = t0();
    const kicked = await client.request<{ runId: string }>('cron.run', { id: job.id, mode: 'force' });
    results.cron.kickedRunId = kicked.runId;

    const reviewKey = (row: any) => typeof row?.key === 'string' && row.key.includes('skill-collection-review');
    let done = false;
    for (const end = Date.now() + 180_000; Date.now() < end && !done;) {
      const list = await client.request<any>('sessions.list', { agentId: 'm1' }, { timeoutMs: 10_000 }).catch(() => undefined);
      const rows: any[] = (list?.sessions ?? []);
      for (const row of rows) if (reviewKey(row)) {
        const stamp = { t: t0() - kickAt, key: row.key, fields: Object.keys(row), hasActiveRun: row.hasActiveRun, status: row.status };
        if (!results.sessionsSeen.some((s: any) => s.key === row.key)) results.sessionsSeen.push(stamp);
      }
      await new Promise((r) => setTimeout(r, 100));
      const runs = await client.request<any>('cron.runs', { id: job.id }, { timeoutMs: 10_000 }).catch(() => undefined);
      const entry = runs?.entries?.find((e: any) => e.runId === kicked.runId);
      if (entry?.action === 'finished') { results.cron.entry = entry; done = entry.status === 'ok'; }
    }
    // After the run: does the incognito session row disappear (process-only lifecycle)?
    await new Promise((r) => setTimeout(r, 1500));
    const after = await client.request<any>('sessions.list', { agentId: 'm1' }, { timeoutMs: 10_000 }).catch(() => undefined);
    results.sessionsGone = (after?.sessions ?? []).filter(reviewKey);

    const firstFrame = results.frames[0];
    const identity = results.events.filter((e: any) => typeof e.sessionKey === 'string' && e.sessionKey.includes('skill-collection-review') && e.stream === 'lifecycle');
    results.verdict = {
      framesArrived: results.frames.length,
      identityEventBeforeFirstFrame: !!firstFrame && !!identity[0] && identity[0].t < firstFrame.t,
      identityEventKeyEqualsFrameKey: !!firstFrame && !!identity[0] && identity[0].sessionKey === firstFrame.key,
      sessionsListEverExposedKey: results.sessionsSeen.length > 0,
      observedKeys: results.sessionsSeen.map((s: any) => s.key),
      frameKeys: results.frames.map((f: any) => f.key),
    };
    writeFileSync(join(import.meta.dirname, 'probe-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.verdict, null, 2));
    console.log('first identity event:', JSON.stringify(results.events.filter((e: any) => e.sessionKey)?.[0]));
    console.log('firstFrame:', JSON.stringify(firstFrame));
  } finally {
    bridgeDisarm(runtime);
    await runtime.stop().catch(() => {});
    rmSync(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
};
const bridgeDisarm = (runtime: OpenClawRuntime) => runtime.bridge?.disarmCuration();
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
