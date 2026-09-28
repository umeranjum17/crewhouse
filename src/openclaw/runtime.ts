import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { commit } from './bots_git.ts';
import { dirname, join } from 'node:path';
import { GatewayClient } from '@openclaw/gateway-client';
import type { AgentRuntime, Member, RunEnd, RunEvent, RunSpec, SignInStep, ToolHost } from '../runtime.ts';
import { OpenClawGateway } from './gateway.ts';
import { ToolBridge } from './bridge.ts';

/** Crewhouse account key → OpenClaw provider id. ChatGPT is the one front door; the rest are quiet options. */
const PROVIDER_OF: Record<string, string> = { chatgpt: 'openai', grok: 'xai', copilot: 'github-copilot', openrouter: 'openrouter', minimax: 'minimax', claude: 'anthropic' };
/** The engine's own sign-in route per account (the pin's wizard choices). A CLI prerequisite is labelled where it exists. */
const AUTH_CHOICE: Record<string, string> = {
  chatgpt: 'openai', grok: 'xai-oauth', copilot: 'github-copilot', openrouter: 'openrouter-oauth', minimax: 'minimax-global-oauth', claude: 'anthropic-cli',
};
const CODE_CHOICE: Record<string, string> = {
  chatgpt: 'openai-device-code', grok: 'xai-device-code', openrouter: 'openrouter-oauth', minimax: 'minimax-global-oauth',
};
/** Accounts whose sign-in needs a tool installed and logged in on this computer (said plainly on the card). */
export const CLI_PREREQUISITE: Record<string, string> = { claude: 'the Claude CLI, signed in inside the engine\'s own folder' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenClawRuntime implements AgentRuntime {
  private gateway: OpenClawGateway;
  bridge?: ToolBridge;
  private client?: GatewayClient;
  private agents = new Set<number>();
  readonly stateDir: string;
  constructor(stateDir: string) { this.stateDir = stateDir; this.gateway = new OpenClawGateway(stateDir); }
  /** The crew folder, for the install policy's own-content roots. Set before start(). */
  crewDir = '';
  async start(host: ToolHost) {
    this.gateway.crewDir = this.crewDir;
    this.bridge = new ToolBridge(this.stateDir, host);
    await this.bridge.start();
    try { this.client = await this.gateway.start(); }
    catch (error) { this.bridge.stop(); throw error; }
    return this.client;
  }
  async stop() { await this.gateway.stop(); this.bridge?.stop(); this.client = undefined; }
  private connected() { if (!this.client) throw new Error('Crewhouse engine is not ready'); return this.client; }
  private async agent(member: number) {
    if (this.agents.has(member)) return `m${member}`;
    const id = `m${member}`;
    const client = this.connected();
    const existing = await client.request<{ agents: { id: string }[] }>('agents.list');
    if (!existing.agents?.some((agent) => agent.id === id))
      await client.request('agents.create', { name: id, workspace: join(this.stateDir, 'openclaw/workspaces', id) });
    this.agents.add(member);
    return id;
  }

  // ---- accounts: the engine owns credentials; crewd drives its wizard and reads its status ----

  async signedIn(member: number, account: string) {
    const provider = PROVIDER_OF[account];
    if (!provider) return false;
    const id = await this.agent(member);
    const status = await this.connected().request<{ providers?: unknown[] }>('models.authStatus', { agentId: id }, { timeoutMs: 20_000 }).catch(() => undefined);
    return (status?.providers ?? []).some((p: any) => (typeof p === 'string' ? p : p?.provider) === provider);
  }

  /** Drive the engine's provider-owned login and tell the person's card what to show. ChatGPT: the redirect lands on
   *  crewd's own 1455 listener and crewd pastes the address into the wizard (the engine cannot bind it first); the
   *  device code covers the phone and the no-browser path. Other providers' wizards are wired as they are reviewed. */
  signIn(member: number, account: string, via: 'browser' | 'code', on: (step: SignInStep) => void): { paste(text: string): void; cancel(): void } {
    const controller = new AbortController();
    const signal = controller.signal;
    let pasteIn: ((text: string) => void) | undefined;
    const paste = (text: string) => pasteIn?.(text);
    const cancel = () => controller.abort();
    let sessionId = '';
    void (async () => {
      try {
        const client = this.connected();
        const agentId = await this.agent(member);
        const authChoice = via === 'code' ? CODE_CHOICE[account] ?? AUTH_CHOICE[account] : AUTH_CHOICE[account];
        if (!authChoice) throw new Error(`Sign-in for ${account} is not connected yet`);
        const say = (s: Omit<SignInStep, 'waiting'> & { waiting?: boolean }) => on({ waiting: true, ...s });
        const started = await client.request<{ sessionId: string; done?: boolean; step?: any }>('openclaw.setup.auth.start',
          { sessionId: `crewhouse-${randomUUID()}`, agentId, authChoice }, { timeoutMs: 60_000, signal: controller.signal });
        // The wizard hands over steps only when pulled with wizard.next (the engine's own Control UI drives it the
        // same way); wizard.status answers {status, error} and never carries a step. A session left running holds the
        // engine's single setup admission, so every exit short of done cancels this session (never another's).
        sessionId = started.sessionId;
        const release = () => client.request('wizard.cancel', { sessionId }, { timeoutMs: 10_000 }).catch(() => {});
        let step: any, terminal: any, done = !!started.done;
        for (let turns = 0; !done && !signal.aborted && turns < 200; turns++) {
          if (!step) {
            const n = await client.request<{ done?: boolean; step?: any; error?: string }>('wizard.next', { sessionId }, { timeoutMs: 120_000, signal: controller.signal }).catch(() => undefined);
            if (!n) { await sleep(500); continue; }
            if (n.done) { terminal = n; done = true; break; }
            step = n.step;
            continue;
          }
          const st = step;
          step = undefined;
          if (st.deviceCode) {
            say({ code: st.deviceCode.code, url: st.externalUrl });
            // The engine polls the provider itself once the shown code is acknowledged.
            const n = await client.request<{ done?: boolean; step?: any; error?: string }>('wizard.next', { sessionId, answer: { stepId: st.id } }, { timeoutMs: 120_000, signal: controller.signal }).catch(() => undefined);
            if (n) {
              if (n.done) { terminal = n; done = true; break; }
              step = n.step;
            }
            continue;
          }
          if (st.type === 'text' && !st.sensitive) {
            // The paste step: the person's browser came back to crewd's own page; crewd hands the address over.
            say({});
            const value = await new Promise<string | undefined>((resolve) => {
              pasteIn = resolve;
              const giveUp = setTimeout(() => { pasteIn = undefined; resolve(undefined); }, 15 * 60_000);
              signal.addEventListener('abort', () => { clearTimeout(giveUp); pasteIn = undefined; resolve(undefined); }, { once: true });
            });
            if (value === undefined) break;
            const n = await client.request<{ done?: boolean; step?: any; error?: string }>('wizard.next', { sessionId, answer: { stepId: st.id, value } }, { timeoutMs: 120_000, signal: controller.signal });
            if (n.done) { terminal = n; done = true; break; }
            step = n.step;
            if (n.error) say({ error: n.error });
            continue;
          }
          if (st.type === 'note' || st.type === 'confirm' || st.type === 'select' || st.type === 'action') {
            if (st.externalUrl) say({ url: st.externalUrl });
            say({}); // the card says what to do while the engine drives
            const n = await client.request<{ done?: boolean; step?: any; error?: string }>('wizard.next', { sessionId, answer: { stepId: st.id } }, { timeoutMs: 120_000, signal: controller.signal });
            if (n.done) { terminal = n; done = true; break; }
            step = n.step;
            if (n.error) say({ error: n.error });
            continue;
          }
          // progress and anything gateway-driven: it advances by itself
          const n = await client.request<{ done?: boolean; step?: any; error?: string }>('wizard.next', { sessionId }, { timeoutMs: 120_000, signal: controller.signal }).catch(() => undefined);
          if (!n) { await sleep(500); continue; }
          if (n.done) { terminal = n; done = true; break; }
          step = n.step;
        }
        if (signal.aborted) { await release(); return; }
        const failed = done && terminal ? String(terminal.error ?? (terminal.status === 'error' ? 'Sign-in failed' : '')) : '';
        if (!done) { await release(); on({ waiting: false, error: 'The sign-in took too long. Tap Sign in with ChatGPT to start again.' }); }
        else if (failed) { await release(); on({ waiting: false, error: failed.slice(0, 200) }); }
        else on({ waiting: false, done: true });
      } catch (e: any) {
        if (sessionId) void this.client?.request('wizard.cancel', { sessionId }, { timeoutMs: 10_000 }).catch(() => {});
        on({ waiting: false, error: String(e?.message ?? e).slice(0, 200) });
      }
    })();
    return { paste, cancel };
  }

  async signOut(member: number, account: string) {
    const provider = PROVIDER_OF[account];
    if (!provider) throw new Error(`no such AI account`);
    const id = await this.agent(member);
    await this.connected().request('models.authLogout', { provider, agentId: id }, { timeoutMs: 20_000 });
  }

  /** One-time per member (spec §6): place the member's old engine sign-in where the engine's doctor imports it, run
   *  doctor once against the isolated state, and retire crewhouse's copy. Never run while the gateway is up. */
  async migrate(member: Member, legacyAuthPath: string) {
    const moved = `${legacyAuthPath}.moved-to-engine`;
    if (!existsSync(legacyAuthPath) || existsSync(moved)) return false;
    const agentDir = join(this.gateway.root, 'state', 'agents', `m${member}`, 'agent');
    mkdirSync(agentDir, { recursive: true });
    const staged = join(agentDir, 'auth.json');
    if (!existsSync(staged)) copyFileSync(legacyAuthPath, staged);
    const { entry, env } = this.gateway.doctorContext();
    spawnSync(process.execPath, [entry, 'doctor', '--fix', '--yes', '--non-interactive'], { env, cwd: env.HOME as string, timeout: 120_000, stdio: 'pipe' });
    renameSync(legacyAuthPath, moved);
    return true;
  }

  /** Point this engine at a custom OpenAI-compatible provider (the tests' scripted model; a self-hosted gateway later).
   *  Sets the provider and makes it every agent's primary model. */
  async configureModelProvider(baseUrl: string, apiKey: string, modelRef = 'crewhouse-stub/test') {
    const client = this.connected();
    const cur = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: cur.hash, raw: JSON.stringify({
      models: { providers: { 'crewhouse-stub': {
        baseUrl, apiKey, api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: true, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: ['off', 'low', 'medium', 'high'] } }],
      } } },
      agents: { defaults: { model: { primary: modelRef } } },
    }) });
  }

  async setLearning(on: boolean) {
    const client = this.connected();
    const cur = await client.request<{ hash: string }>('config.get');
    await client.request('config.patch', { baseHash: cur.hash, raw: JSON.stringify({ skills: { workshop: { autonomous: { mode: on ? 'auto' : 'off' } } } }) });
  }
  async learning() {
    const id = await this.agent(1).catch(() => '');
    const s = await this.connected().request<{ config?: any }>('config.get', id ? { agentId: id } : {}, { timeoutMs: 20_000 }).catch(() => undefined);
    return s?.config?.skills?.workshop?.autonomous?.mode !== 'off';
  }
  async run(spec: RunSpec, on: (event: RunEvent) => void, opts?: { register?: boolean }): Promise<RunEnd> {
    const client = this.connected();
    const agentId = await this.agent(spec.member);
    if (opts?.register !== false) this.bridge?.register(spec);
    let runId: string | undefined;
    let text = '';
    const unsubscribe = this.gateway.onEvent((event) => {
      const payload = event.payload;
      if (event.event !== 'agent' || !runId || payload?.runId !== runId) return;
      if (payload.stream === 'assistant' && typeof payload.data?.text === 'string') {
        text = payload.data.text;
        on({ type: 'text', text });
      } else if (payload.stream === 'tool' && typeof payload.data?.name === 'string') {
        on({ type: 'tool', name: payload.data.name, phase: payload.data.phase === 'end' ? 'end' : 'start' });
      }
    });
    try {
      const started = await client.request<{ runId: string }>('agent', {
        agentId, sessionKey: spec.key, message: spec.message,
        extraSystemPrompt: spec.system, idempotencyKey: randomUUID(),
        ...(spec.images?.length ? { attachments: spec.images.map((image) => ({ type: 'image', mimeType: image.mimeType, content: image.data })) } : {}),
        ...(spec.thinking ? { thinking: spec.thinking } : {}),
      });
      runId = started.runId;
      const done = await client.request<any>('agent.wait', { runId, timeoutMs: 3_600_000 }, { timeoutMs: 3_610_000 });
      text = String(done.terminalReply?.text ?? text);
      if (done.status === 'ok') { on({ type: 'text', text }); return { ok: true, text }; }
      if (done.stopReason === 'aborted') return { ok: false, aborted: true };
      return { ok: false, kind: 'other', message: String(done.error ?? done.status ?? 'Engine stopped') };
    } catch (error) { return { ok: false, kind: 'other', message: String(error) }; }
    finally { unsubscribe(); this.bridge?.unregister(spec.key); }
  }
  async steer(key: string, text: string) { await this.connected().request('sessions.steer', { sessionKey: key, message: text }); }
  async abort(key: string) { await this.connected().request('chat.abort', { sessionKey: key }); }
  async trail(_key: string) { return []; }
  async ask(member: number, prompt: string) {
    const end = await this.run({ key: `agent:m${member}:crewhouse:route:${randomUUID()}`, member, bot: 'chief', task: 0, account: 'chatgpt',
      cwd: '', system: 'You route requests in a family\'s crew of helpers. Answer with one JSON object and nothing else.', message: prompt, builtins: [] }, () => {});
    if (!end.ok) throw new Error('Routing unavailable');
    return end.text;
  }
  /** The member's applied learned skills (the workshop's proposals, applied state last). */
  async learned(member: number) {
    const id = await this.agent(member);
    const list = await this.connected().request<{ proposals?: any[] }>('skills.proposals.list', { agentId: id }, { timeoutMs: 20_000 }).catch(() => undefined);
    return (list?.proposals ?? []).map((p) => ({
      id: String(p.id ?? ''),
      skill: String(p.skillName ?? p.title ?? ''),
      at: Date.parse(p.updatedAt ?? p.createdAt ?? '') || 0,
      state: String(p.status ?? ''),
    })).filter((p) => p.id);
  }

  /** The member's learned-skills folder, and its pre-change capture: crewhouse's own git versioning. A capture that
   *  cannot be verified throws, and the caller must refuse the review — the data stays. */
  workspaceOf(member: number) { return join(this.stateDir, 'openclaw/workspaces', `m${member}`, 'skills'); }
  captureLearned(member: number): string {
    const dir = this.workspaceOf(member);
    if (!existsSync(join(dir, '.git'))) mkdirSync(dir, { recursive: true });
    const hash = commit(dir, ['.'], 'Before the skill collection review');
    if (!hash) throw new Error('the learned-skills capture failed; the review was refused');
    return hash;
  }
  /** Bring one learned skill back from the capture history, even after later edits or reviews. The target is the
   *  real workspace layout the engine reads: workspaceOf() is the skills root itself, so the skill sits directly
   *  inside it (`<name>/SKILL.md`, never `skills/<name>/SKILL.md`). The capture is read before anything is written —
   *  a restore that cannot be verified throws and leaves the workspace untouched. The blob is written as raw bytes,
   *  so the restore is byte-for-byte: leading and trailing whitespace and the final newline all survive. */
  restoreLearned(member: number, name: string, hash?: string) {
    const dir = this.workspaceOf(member);
    const git = (args: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', ...args], { cwd: dir, stdio: 'pipe' });
    const at = (hash ?? git(['rev-parse', '--short', 'HEAD'])).toString().trim();
    let body: Buffer;
    try { body = git(['show', `${at}:${name}/SKILL.md`]); }
    catch { throw new Error(`no learned-skill capture holds "${name}"; nothing was restored`); }
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), body);
    commit(dir, ['.'], `Restored ${name} from ${at}`);
    return at;
  }

  /** The collection review, on crewhouse's own boundary: capture first (refusing everything on failure), open the
   *  workshop window only for the engine's reviewer, run the review, close it, and report kept/rewritten/dropped. */
  async runCollectionReview(member: number) {
    const agentId = await this.agent(member);
    const capture = this.captureLearned(member);
    const jobs = await this.connected().request<{ jobs: { id: string; name: string; enabled: boolean }[] }>('cron.list', { limit: 100 }, { timeoutMs: 20_000 });
    const job = jobs.jobs?.find((j) => j.name === `skill-collection-review-m${member}`);
    if (!job?.enabled) throw new Error('the collection review is not enabled');
    this.bridge?.armCuration({ member, review: 'skill-collection-review', action: 'reconcile' }, 10 * 60_000);
    try {
      const kicked = await this.connected().request<{ runId: string }>('cron.run', { id: job.id, mode: 'force' }, { timeoutMs: 30_000 });
      for (const end = Date.now() + 240_000; Date.now() < end;) {
        await sleep(2000);
        const runs = await this.connected().request<{ entries: { runId: string; status: string }[] }>('cron.runs', { id: job.id }, { timeoutMs: 20_000 }).catch(() => undefined);
        if (runs?.entries?.some((e) => e.runId === kicked.runId && e.status === 'ok')) break;
      }
      const curator = await this.connected().request<any>('skills.curator.status', {}, { timeoutMs: 20_000 }).catch(() => undefined);
      const outcome = curator?.collectionReview ?? {};
      const names = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.name ?? x?.skill ?? x).filter(Boolean) : [];
      return { capture, kept: names(outcome.kept), written: names(outcome.written), dropped: names(outcome.dropped) };
    } finally { this.bridge?.disarmCuration(); }
  }

  /** Forget one learned skill. Pending proposals are rejected directly; an applied one is restored by a one-shot
   *  turn whose only possible tool is the workshop's own restore (spec §5.4) — no other tool can run on it. */
  async forget(member: number, id: string, skill = '') {
    const agentId = await this.agent(member);
    const client = this.connected();
    for (const method of ['skills.proposals.reject', 'skills.proposals.quarantine']) {
      const ok = await client.request(method, { agentId, proposalId: id }, { timeoutMs: 20_000 }).then(() => true).catch(() => false);
      if (ok) return;
    }
    // Applied: a one-shot turn, unregistered (so the gate allows only the workshop's restore), then forgotten for good.
    const end = await this.run({ key: `agent:m${member}:crewhouse:forget:${randomUUID()}`, member, bot: 'chief', task: 0, account: 'chatgpt',
      cwd: '', system: 'You are the crew\'s own workshop assistant. Use skill_workshop with action "restore_collection" and nothing else.', message: `Forget the learned skill "${skill}" (proposal ${id}): use skill_workshop with action "restore_collection" and nothing else.`, builtins: [] }, () => {}, { register: false });
    if (!end.ok) throw new Error('Forget failed');
  }
}
