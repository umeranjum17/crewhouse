import type { AgentRuntime, RunEnd, RunEvent, RunSpec, ToolHost } from './runtime.ts';

const holds = new Map<string, (reply: string) => void>();
export const holding = (key: string) => holds.has(key);
export const release = (key: string, reply = '') => { holds.get(key)?.(reply); holds.delete(key); };

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

/** Fast product-rule fixture. Security/engine acceptance runs the actual pinned Gateway on the HTTP stub. */
export class StubRuntime implements AgentRuntime {
  private host?: ToolHost;
  async start(host: ToolHost) { this.host = host; }
  async stop() { this.host = undefined; holds.clear(); }
  async signedIn(_member: number, account: string) { return account === 'chatgpt'; }
  signIn(_member: number, _account: string, _via: 'browser' | 'code', on: (step: any) => void) {
    on({ waiting: false, done: true }); return { paste: () => {}, cancel: () => {} };
  }
  async signOut() {}
  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    if (!this.host) throw new Error('Stub not started');
    const said = spec.message;
    let result = '';
    for (const { name, input } of calls(said)) {
      on({ type: 'tool', name, phase: 'start' });
      const gate = await this.host.gate(spec, name, input);
      if (!gate.allow) { result = gate.reason; continue; }
      result = await this.host.call(spec, name, input, new AbortController().signal);
      on({ type: 'tool', name, phase: 'end', ok: true });
    }
    if (/hit the limit/i.test(said)) return { ok: false, kind: 'resting', message: 'You have hit your ChatGPT usage limit', until: Date.now() + 1_800_000 };
    if (/no helpers in plan/i.test(said)) return { ok: false, kind: 'plan', message: 'Your plan does not include helpers' };
    if (/sign me out/i.test(said)) return { ok: false, kind: 'signed-out', message: 'Your sign-in has expired' };
    const last = said.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('[Crewhouse')).at(-1) ?? '';
    let text = result ? `stub ${spec.bot}: ${calls(said).at(-1)?.name} said ${result.slice(0, 300)}` : `stub ${spec.bot}: done with "${last.slice(0, 60)}"`;
    if (/ask permission/i.test(said)) text = await new Promise<string>((resolve) => holds.set(spec.key, (reply) => resolve(reply || text)));
    on({ type: 'text', text });
    return { ok: true, text };
  }
  async steer(_key: string, _text: string) {}
  async abort(key: string) { release(key); }
  async trail(_key: string) { return []; }
  async ask(_member: number, prompt: string) {
    const options = [...prompt.matchAll(/^- ([a-z0-9-]+):/gm)].map((match) => match[1]);
    const pick = /\[route ([a-z0-9-]+|\?)\]/.exec(prompt)?.[1] ?? 'chief';
    return JSON.stringify(Object.fromEntries(options.map((option) => [option, pick === '?' ? 1 / options.length : option === pick ? 0.9 : 0.1 / (options.length - 1)])));
  }
  async learned(_member: number) { return []; }
  async forget(_member: number, _id: string) {}
}
