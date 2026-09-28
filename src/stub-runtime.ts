import type { AgentRuntime, RunEnd, RunEvent, RunSpec, ToolHost } from './runtime.ts';

function calls(text: string) {
  const found: { name: string; input: Record<string, unknown> }[] = [];
  for (const match of text.matchAll(/\[tool (\w+) \{/g)) {
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
    found.push({ name: match[1], input: JSON.parse(text.slice(from, end + 1)) });
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
  // Grok stands in for an account that must be signed in first; the rest the member has.
  async signedIn(_member: number, account: string) { return account !== 'grok'; }
  signIn(_member: number, _account: string, via: 'browser' | 'code', on: (step: any) => void) {
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
    const seen = calls(said);
    if (spec.bot === 'chief' && /\[first words\]/.test(said)) on({ type: 'text', text: 'I’ll start by checking the next step.' });
    for (const { name, input } of seen) {
      on({ type: 'tool', name, phase: 'start' });
      const gate = await this.host.gate(spec, name, input);
      if (!gate.allow) { result = gate.reason; continue; }
      result = await this.host.call(spec, name, input, new AbortController().signal);
      on({ type: 'tool', name, phase: 'end', ok: true });
      this.transcripts.set(spec.key, `${this.transcript(spec.key)}${name}: ${result}\n`);
    }
    if (/hit the limit/i.test(said) && spec.account === 'chatgpt')
      return { ok: false, kind: 'resting', message: 'You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.', until: Date.now() + 1_800_000 };
    if (/no helpers in plan/i.test(said) && spec.account === 'chatgpt')
      return { ok: false, kind: 'plan', message: "Your plan doesn't include this model." };
    if (/sign me out/i.test(said)) return { ok: false, kind: 'signed-out', message: '401 Unauthorized: your sign-in has expired' };
    const last = said.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('[Crewhouse')).at(-1) ?? '';
    let text = result ? `stub ${spec.bot}: ${seen.at(-1)?.name} said ${result.slice(0, 300)}` : `stub ${spec.bot}: done with "${last.slice(0, 60)}"`;
    if (/\[two-fare-backtest\]/.test(said))
      text = 'I recommend the lower fare from Fareboard. I checked Fareboard and Narrowfare; I didn\'t check baggage fees or live inventory.';
    const asked = last.replace(/^The person says: /, '');
    const scripted = process.env.CREWHOUSE_STUB_GOLDEN && spec.bot === 'chief' ? GOLDEN[asked] : undefined;
    text = scripted ?? text;
    if (/ask permission/i.test(said)) {
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
  async ask(_member: number, prompt: string) {
    const options = [...prompt.matchAll(/^- ([a-z0-9-]+):/gm)].map((match) => match[1]);
    const pick = /\[route ([a-z0-9-]+|\?)\]/.exec(prompt)?.[1] ?? 'chief';
    return JSON.stringify(Object.fromEntries(options.map((option) => [option, pick === '?' ? 1 / options.length : option === pick ? 0.9 : 0.1 / (options.length - 1)])));
  }
  async learned(_member: number) { return []; }
  async forget(_member: number, _id: string) {}
  private learningOn = true;
  async setLearning(on: boolean) { this.learningOn = on; }
  learning() { return this.learningOn; }
}
