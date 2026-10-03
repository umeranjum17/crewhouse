import type { AgentRuntime, RunEnd, RunEvent, RunSpec, ToolHost } from './runtime.ts';

function calls(text: string) {
  const found: { name: string; input: Record<string, unknown>; start: number; end: number }[] = [];
  const pattern = /\[tool (\w+) \{/g;
  for (let match; (match = pattern.exec(text));) {
    const from = match.index + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false, end = from;
    for (; end < text.length; end++) {
      const c = text[end];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) break;
    }
    found.push({ name: match[1], input: JSON.parse(text.slice(from, end + 1)), start: match.index, end: end + 1 });
    pattern.lastIndex = end + 1;
  }
  return found;
}

const GOLDEN: Record<string, string> = {
  hi: 'Hi. What would you like to work on?',
  'how do i pair my computer with you?': 'Open Add a phone on your computer and scan its code with your phone.',
  'i want to market my app': 'I can help market it. Send the site so I can see the product and audience before drafting a plan.',
  'https://trymuxr.com/': 'muxr lets developers manage coding agents from their phone. I’ll map the audience, focus on developer communities and founder posts, then ask Scout and Scribe for first drafts. Nothing will be posted.',
};

/** Fast product-rule fixture. Security/engine acceptance runs the actual pinned Gateway on the HTTP stub (src/stub.ts).
 *  All state is per instance: tests run several crews side by side with the same session keys. */
export class StubRuntime implements AgentRuntime {
  private host?: ToolHost;
  private holds = new Map<string, (reply: string) => void>();
  private cancelled = new Set<string>();
  private transcripts = new Map<string, string>();
  private specs = new Map<string, RunSpec>();
  private steered = new Map<string, string>();
  holding(key: string) { return this.holds.has(key); }
  release(key: string, reply = '') { this.holds.get(key)?.(reply); this.holds.delete(key); }
  /** What the run's tools said, in order: the run's own view of its work (tests read it; no session file exists). */
  transcript(key: string) { return this.transcripts.get(key) ?? ''; }
  /** The last RunSpec a key ran with: what the model actually saw (tests read it; no session file exists). */
  specOf(key: string) { return this.specs.get(key); }
  /** The last steer a key was given (tests read it; the engine keeps the conversation itself). */
  steerOf(key: string) { return this.steered.get(key); }
  async start(host: ToolHost) { this.host = host; }
  async stop() { this.host = undefined; this.holds.clear(); this.transcripts.clear(); this.specs.clear(); this.steered.clear(); this.cancelled.clear(); }
  // Grok stands in for an account that must be signed in first; the rest the person has.
  async signedIn(account: string) { return account !== 'grok'; }
  signIn(_account: string, via: 'browser' | 'code', on: (step: any) => void) {
    // Grok stands in for an account that must be signed in first: the code shows, then it succeeds.
    if (via === 'code') on({ waiting: true, code: 'CREW-2026', url: 'https://example.test/xai/device' });
    const timer = setTimeout(() => on({ waiting: false, done: true }), 100);
    return { paste: () => {}, cancel: () => { clearTimeout(timer); on({ waiting: false, error: 'The sign-in was cancelled.' }); } };
  }
  async signOut() {}
  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    if (!this.host) throw new Error('Stub not started');
    this.specs.set(spec.key, spec);
    const said = spec.message;
    let result = '';
    const request = said.split('\nThe person says: ').at(-1)!;
    const report = spec.bot === 'chief' && /^\[Crewhouse\] Review helper task #(\d+)/.exec(request);
    const seen = report ? [{ name: 'crew_status', input: { task: Number(report[1]), ...(/and event (\d+)/.exec(request) ? { event: Number(/and event (\d+)/.exec(request)![1]) } : {}) }, start: 0, end: 0 }] : calls(request);
    const signals = seen.reduceRight((text, c) => text.slice(0, c.start) + text.slice(c.end), request);
    if (spec.bot === 'chief' && /\[first words\]/.test(said)) on({ type: 'text', text: 'Chief will confirm the next step.' });
    for (const { name, input } of seen) {
      on({ type: 'tool', name, phase: 'start' });
      const gate = await this.host.gate(spec, name, input);
      if (!gate.allow) { result = gate.reason; continue; }
      result = await this.host.call(spec, name, input, new AbortController().signal);
      on({ type: 'tool', name, phase: 'end', ok: true });
      this.transcripts.set(spec.key, `${this.transcript(spec.key)}${name}: ${result}\n`);
    }
    if (/link is down/i.test(signals)) return { ok: false, kind: 'network', message: 'fetch failed' };
    if (/hit the limit/i.test(signals) && spec.account === 'chatgpt')
      return { ok: false, kind: 'resting', message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.', until: Date.now() + 1_800_000 };
    if (/no helpers in plan/i.test(signals) && spec.account === 'chatgpt')
      return { ok: false, kind: 'plan', message: "Your plan doesn't include this model." };
    if (/sign me out/i.test(signals)) return { ok: false, kind: 'signed-out', message: '401 Unauthorized: your sign-in has expired' };
    const last = said.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('[Crewhouse')).at(-1) ?? '';
    let text = result ? `stub ${spec.bot}: ${seen.at(-1)?.name} said ${result.slice(0, 300)}` : `stub ${spec.bot}: done with "${last.slice(0, 60)}"`;
    if (/\[two-fare-backtest\]/.test(said))
      text = 'I recommend the lower fare from Fareboard. I checked Fareboard and Narrowfare; I didn\'t check baggage fees or live inventory.';
    const asked = last.replace(/^The person says: /, '');
    const scripted = process.env.CREWHOUSE_STUB_GOLDEN && spec.bot === 'chief' ? GOLDEN[asked] : undefined;
    text = scripted ?? text;
    if (report && result) { // scripted readback, never a real model-language acceptance claim
      const r = JSON.parse(result), t = r.report;
      const files = r.files ?? [], evidence = t.result?.startsWith('stub ') ? t.state === 'done' && files.length ? 'The finished file is ready.' : 'No confirmed result was recorded.' : t.result ?? r.progress[0]?.text ?? '';
      text = `${t.state === 'unsure' ? 'Chief cannot confirm this result.' : t.state === 'failed' ? 'Chief could not complete this task.' : t.state === 'needs_you' ? 'Chief will read the information.' : 'Chief has the report.'}\nTask: “${t.title}”\n${evidence}`;
      if (t.state === 'failed' && r.routine?.state === 'on' && r.routine.next_at) text += `\nNext run: ${new Date(r.routine.next_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}.`;
    }
    if (/ask permission/i.test(signals)) {
      text = await new Promise<string>((resolve) => this.holds.set(spec.key, (reply) => resolve(reply || text)));
      if (this.cancelled.delete(spec.key)) return { ok: false, aborted: true }; // stopped on purpose, not finished
    }
    on({ type: 'usage', tokens: Math.max(1, Math.round((said.length + text.length) / 4)) });
    on({ type: 'text', text });
    return { ok: true, text };
  }
  async steer(key: string, text: string) { this.steered.set(key, text); }
  async abort(key: string) { this.cancelled.add(key); this.release(key); }
  async trail(_key: string) { return []; }
  async learned() { return []; }
  async forget(_id: string) {}
  private learningOn = true;
  async setLearning(on: boolean) { this.learningOn = on; }
  learning() { return this.learningOn; }
}
