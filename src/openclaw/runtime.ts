// The BYOKit engine port: accounts, runs, tools and Crewhouse's learned-skill capture.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenClawKit, stateWords, type KitOptions, type KitState, type ToolSpec, type RunSpec as KitRunSpec } from '@byokit/openclaw';
import { osKeyringSeal } from '@byokit/secrets';
import { PROVIDERS } from '../accounts.ts';
import { commit } from '../bots.ts';
import { CALLBACK_PORT } from '../callback-port.ts';
import { appDir, loadConfig } from '../config.ts';
import { PARAMETERS } from '../engine.ts';
import type { AgentRuntime, RunEnd, RunEvent, RunRef, RunSpec, SignInStep, ToolHost } from '../runtime.ts';

export { ENGINE_VERSION } from '@byokit/openclaw';

const repo = appDir;
/** Crewhouse account key → OpenClaw provider id, one per account the sign-in card offers. Claude is its CLI: the kit names it claude-cli, never anthropic. */
const PROVIDER_OF: Record<string, string> = { chatgpt: 'openai', grok: 'xai', copilot: 'github-copilot', openrouter: 'openrouter', minimax: 'minimax', claude: 'claude-cli', 'opencode-go': 'opencode-go' };
/** The engine's own sign-in route per account (the pin's wizard choices). */
const AUTH_CHOICE: Record<string, string> = {
  chatgpt: 'openai', grok: 'xai-oauth', copilot: 'github-copilot', openrouter: 'openrouter-oauth', minimax: 'minimax-global-api', claude: 'anthropic-cli', 'opencode-go': 'opencode-go',
}, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), ME = 'm1';
/** The engine-side name of a Crewhouse tool and back: only the shell differs. */
const crewName = (tool: string) => tool === 'shell' ? 'bash' : tool, MAX_LEGS = 24, LEGWORK = new Set(['web_search', 'web_fetch']); // Chief's spawned lookups: at most MAX_LEGS a job, web reads only
/** Why the engine failed, in the person's words: the kit's typed refusal and, for an install, its retained diagnosis (README: engine-install-drift.json). */
function failedWords(e: unknown, s: KitState, diagnosis: string, since: number) {
  const cause = (e as { cause?: string })?.cause, d = cause === 'write' && existsSync(diagnosis) ? JSON.parse(readFileSync(diagnosis, 'utf8')) : null, fresh = d && Date.parse(d.at) >= since;
  if (cause === 'drift-after-build') return "The download didn't match what Crewhouse trusts, so it wasn't used. Try again.";
  if (fresh && !d.npm?.version) return "Crewhouse needs npm, which comes with Node.js, to set up your crew, and this computer doesn't have it. Install Node.js, then try again.";
  if (fresh && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|network/.test(d.npmStderrTail)) return "Crewhouse couldn't download what your crew needs. Check that this computer is online, then try again.";
  return s.why === 'engine-already-running' || s.why?.startsWith('auth-store') ? stateWords(s) : "Your crew couldn't start on this computer. Try again.";
}

const ABOUT: Record<string, string> = {
  shell: 'Run a shell command in your sandbox; only your folder is writable. Long output is cut to its last lines.', crew_profile: 'Save person facts.', crew_signin: 'Ask for a sign-in',
  browser: 'Your own browser (playwright-axi): goto <url>, snapshot, find <text>, click <ref>, fill <ref> <text>, press <key>, go-back.',
  calendar: "The person's own Google Calendar: see what is next, the day or week, free time, add, move, cancel, as `args`.",
  mail: "The person's own Gmail: new mail, search, read, save an attachment, draft a reply, label it, as `args`; it cannot send mail.",
  crew_app: "Use one of the person's connected apps' tools: `tool` names it (the run's prompt lists them) and `input` carries its arguments.",
  crew_remember: 'Save a lasting preference: pass {text: "one short line"}; optionally replaces and everyone. Do not save how to address the person.',
  crew_document: 'Write and deliver a document: pass {name: "title", blocks: [...]}. Crewhouse writes the file; do not make it yourself.',
};
export const TOOLS: ToolSpec[] = Object.entries(PARAMETERS).map(([name, parameters]) => ({ name, description: ABOUT[name] ?? `Crewhouse ${name.slice(5).replaceAll('_', ' ')}. The person sees the result in their crew.`, parameters }));

const CONFIG = {
  // An empty allow list: the engine otherwise narrows to its model map, and the person's other providers vanish.
  agents: { defaults: { sandbox: { mode: 'off' }, modelPolicy: { allow: [] }, compaction: { memoryFlush: { enabled: false } }, heartbeat: { every: '0m' }, subagents: { maxSpawnDepth: 1, maxChildrenPerAgent: 8, maxConcurrent: 8, runTimeoutSeconds: 900 } } },
  tools: { profile: 'coding', alsoAllow: [...TOOLS.map((t) => t.name), 'computer', 'sessions_send', 'sessions_spawn'], deny: ['group:fs', 'group:runtime', 'group:automation', 'group:messaging', 'nodes', 'group:ui', 'conversations_send', 'conversations_turn', 'subagents', 'code_execution', 'gateway', 'openclaw', 'plugins', 'cron', 'ask_user', 'suggest_task'], fs: { workspaceOnly: true }, exec: { security: 'deny', ask: 'always' }, elevated: { enabled: false }, agentToAgent: { enabled: false }, sessions: { visibility: 'agent' } },
  // A bot's computer is OpenClaw's own node host on its display (`computer`); of a node host's commands only the screen's two pass.
  gateway: { nodes: { pluginTools: { enabled: false }, allowSkills: false, commands: { deny: ['browser.proxy', 'browser.proxy.upload.v1', 'fs.listDir', 'mcp.tools.call.v1', 'ollama.chat', 'ollama.models', 'system.execApprovals.get', 'system.execApprovals.set', 'system.notify', 'system.run', 'system.run.prepare', 'system.which', 'terminal.upload'] } } },
  plugins: { load: { paths: [] }, allow: ['crewhouse', 'memory-core', 'openai', 'opencode-go', 'cua-computer'], entries: {
    'memory-core': { config: { dreaming: { enabled: false } } }, 'cua-computer': { enabled: true },
    codex: { enabled: false },
  } },
  skills: { allowBundled: ['video-frames', 'openai-whisper', 'summarize', 'nano-pdf', 'diagram-maker'], workshop: { approvalPolicy: 'auto' } },
};

export class OpenClawRuntime implements AgentRuntime {
  readonly kit: OpenClawKit;
  readonly stateDir: string;
  private host?: ToolHost; private keyChecks = new Set<string>();
  private runs = new Map<string, RunRef & { account?: string; keyLane?: boolean }>(); private personas = new Set<string>(); // neutral workspace files; each session supplies its own persona
  private targets = new Map<string, Map<string, { bot: string; run?: RunRef }>>(); private legs = new Map<string, number>(); // a native job's spawned-lookup count
  private failed = ''; private nodes = new Map<string, { display: string; child: ChildProcess }>();
  onEngine?: () => void; // every phase change, so Hello's getting-ready screen follows the kit
  constructor(stateDir: string, crewDir = '', o: Partial<KitOptions> = {}) {
    this.stateDir = stateDir;
    this.kit = new OpenClawKit({
      stateDir, offered: [...new Set([...Object.values(PROVIDER_OF), 'openai-codex'])], engineDir: loadConfig().engineDir, onState: () => this.onEngine?.(), plugin: { id: 'crewhouse' }, tools: TOOLS, config: CONFIG, enginePath: (process.env.PATH ?? '').split(':').filter((d) => d && ['claude', 'codex'].some((cli) => existsSync(join(d, cli)))), // only installed CLI directories enter the engine's otherwise /usr/bin:/bin PATH
      authSeal: 'authSeal' in o ? o.authSeal : osKeyringSeal({ service: 'crewhouse-engine', dualWrap: true }),
      permitted: (tool) => tool.startsWith('crew_'), callbackPort: CALLBACK_PORT,
      installPolicy: { trustedSkills: join(appDir, 'src/openclaw/trusted-skills.json'), ownRoots: [repo, crewDir].filter(Boolean) },
      host: {
        // A key the kit passes that Crewhouse never registered is the armed curation window's one call (allowOnce).
        gate: async (ref, tool, input) => {
          const run = this.runOf(ref.sessionKey), leg = !run && ref.parent && !ref.helper && ref.root ? this.runOf(ref.root.sessionKey) : undefined; // legwork: a child Chief's run spawned
          if (!run) return leg ? this.host && LEGWORK.has(tool) ? this.host.gate(leg, crewName(tool), input) : { allow: false, reason: 'This legwork only reads the web. Report what you found.' } : ref.parent || ref.helper ? { allow: false, reason: 'This helper’s task is no longer active.' } : { allow: true };
          if (!this.host) return { allow: false, reason: 'Crewhouse could not check this call.' };
          if (tool === 'sessions_yield') return this.legs.get(run.key) ? { allow: true } : { allow: false, reason: 'There is nothing to wait for.' };
          if (tool === 'sessions_spawn') {
            const own = /^agent:([^:]+):/.exec(ref.sessionKey)?.[1], n = this.legs.get(run.key) ?? MAX_LEGS;
            if (n >= MAX_LEGS || input.agentId !== own || typeof input.task !== 'string' || !input.task.trim() || Object.keys(input).some((k) => !['task', 'label', 'agentId'].includes(k))) return { allow: false, reason: `Pass only task (one thing to look up), optional label, and agentId "${own}", up to ${MAX_LEGS} lookups in Chief's own job; do the rest in a later job.` };
            return this.legs.set(run.key, n + 1) && { allow: true };
          }
          if (tool === 'sessions_send') {
            const target = this.targets.get(run.key)?.get(String(input.sessionKey));
            if (!target || input.timeoutSeconds !== 0 || input.label !== undefined || !this.host.delegate) return { allow: false, reason: 'Use an available helper session from this job, with timeoutSeconds 0.' };
            try {
              target.run = await this.host.delegate(run, target.bot, String(input.sessionKey), typeof input.message === 'string' ? input.message : '');
              this.runs.set(String(input.sessionKey), target.run);
              return { allow: true };
            } catch (e) { return { allow: false, reason: (e as Error).message }; }
          }
          const decision = await this.host.gate(run, crewName(tool), input);
          return decision.allow ? decision : { allow: false, reason: decision.reason };
        },
        call: async (ref, tool, input, signal) => {
          const run = this.runOf(ref.sessionKey);
          if (!run || !this.host) throw new Error('Unknown run');
          return this.host.call(run, crewName(tool), input, signal);
        },
      },
      ...o,
    });
  }
  /** The run behind a callback: a key-lane run's engine key is the member's own under the kit's key-agent prefix. */
  private runOf(sessionKey: string) { return this.runs.get(sessionKey) ?? this.runs.get(sessionKey.replace(/^agent:byokit-key-/, 'agent:')); }
  async start(host: ToolHost) { this.host = host; this.failed = ''; const since = Date.now(); await this.kit.start().catch((e: unknown) => { this.failed = failedWords(e, this.kit.state, join(this.stateDir, 'logs', 'engine-install-drift.json'), since); this.onEngine?.(); throw e; }); }
  /** The engine as the app's first screen shows it: the kit's real phase and its words, or why the last start failed. */
  engine() { return this.failed ? { phase: 'failed', words: this.failed } : { phase: this.kit.state.phase, words: stateWords(this.kit.state) }; }
  async stop() { for (const n of this.nodes.values()) n.child.kill(); this.nodes.clear(); await this.kit.stop(); }
  /** `openclaw node run` with its bundled cua-computer on the bot's display, its own state and an env built from nothing;
   *  crewd approves its command surface (docs/nodes/computer-use.md). ponytail: a node outlives an idle-swept desktop
   *  until the next desktop replaces it; the kit should supervise node hosts (findings.md). */
  async computer(bot: string, screen: { DISPLAY: string; XAUTHORITY: string }) {
    const name = `crewhouse-${bot}`, had = this.nodes.get(bot);
    if (had?.display === screen.DISPLAY && had.child.exitCode === null) return name;
    had?.child.kill();
    const { entry, env } = this.kit.doctorContext(), dir = join(this.stateDir, 'nodes', bot), port = readFileSync(join(this.stateDir, 'openclaw', 'port'), 'utf8').trim();
    mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'openclaw.json'), JSON.stringify({ plugins: { entries: { 'cua-computer': { enabled: true } } } }));
    const child = spawn(process.execPath, [entry, 'node', 'run', '--host', '127.0.0.1', '--port', port, '--no-tls', '--display-name', name], { cwd: dir, stdio: 'ignore', env: {
      PATH: env.PATH, LANG: env.LANG, HOME: dir, TMPDIR: dir, OPENCLAW_STATE_DIR: dir, OPENCLAW_CONFIG_PATH: join(dir, 'openclaw.json'), OPENCLAW_GATEWAY_TOKEN: env.OPENCLAW_GATEWAY_TOKEN,
      OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DISABLE_BONJOUR: '1', XDG_SESSION_TYPE: 'x11', ...screen } });
    this.nodes.set(bot, { display: screen.DISPLAY, child });
    for (let i = 0; i < 90 && child.exitCode === null; i++, await sleep(1000)) {
      const up = await this.kit.call('node.list', {}) as { nodes?: { displayName?: string; connected?: boolean; commands?: string[] }[] };
      if (up.nodes?.some((n) => n.displayName === name && n.connected && n.commands?.includes('computer.act'))) return name;
      const { pending } = await this.kit.call('node.pair.list', {}) as { pending?: { requestId: string; displayName?: string }[] }, ask = pending?.find((p) => p.displayName === name);
      if (ask) await this.kit.call('node.pair.approve', { requestId: ask.requestId });
    }
    child.kill(); this.nodes.delete(bot);
    throw new Error("the bot's computer did not start");
  }
  signInRecovery() { return this.kit.state.phase === 'locked' || this.kit.state.why === 'engine-already-running' || this.kit.state.why === 'auth-store-unreadable' ? stateWords(this.kit.state) : ''; }
  memoryLimited() { return this.kit.memoryLimited(ME); }

  // ---- accounts: the engine owns credentials; the kit drives its wizard and reads its status ----

  private async routeOf(account: string) { if (account !== 'chatgpt') return PROVIDER_OF[account]; if (process.env.CREWHOUSE_CODEX_CLI_ONLY === '1') return 'openai-codex'; const signed = await this.kit.providerStatus(ME).catch(() => undefined) ?? []; return signed.includes('openai-codex') && !signed.includes('openai') ? 'openai-codex' : 'openai'; }
  async signedIn(account: string) { const provider = await this.routeOf(account); return provider ? await this.kit.signedIn(ME, provider) : false; }

  signIn(account: string, via: 'browser' | 'code' | 'key', told: (step: SignInStep) => void): { paste(text: string): Promise<unknown> | void; cancel(): void; done?: Promise<unknown> } {
    const on = (step: SignInStep) => { if (step.done) { this.listed = undefined; void this.catalog().catch(() => {}); } told(step); }; // read the new catalog while the first run is being set up
    if (this.signInRecovery()) {
      let cancelled = false;
      void this.kit.start().then(async () => { if (!cancelled) on({ waiting: false, ...(await this.signedIn(account) ? { done: true } : { error: this.signInRecovery() || 'Please try again.' }) }); })
        .catch(() => { if (!cancelled) on({ waiting: false, error: 'Please try again.' }); });
      return { paste() {}, cancel() { cancelled = true; } };
    }
    const cliOnly = process.env.CREWHOUSE_CODEX_CLI_ONLY === '1' && account === 'chatgpt', authChoice = cliOnly ? undefined : via === 'code' && account === 'chatgpt' ? 'openai-device-code' : AUTH_CHOICE[account];
    if (!authChoice) {
      queueMicrotask(() => on({ waiting: false, error: cliOnly ? 'Sign in to Codex CLI on this computer, then try again.' : `Sign-in for ${account} is not connected yet` }));
      return { paste() {}, cancel() {} };
    }
    if (via === 'key') return this.keyIn(account, authChoice, on);
    const name = PROVIDERS[account]?.name ?? account;
    return this.kit.signIn(ME, { authChoice, via }, (v) => {
      if (v.state === 'waiting') on({ waiting: true, ...(v.url ? { url: v.url } : {}), ...(v.code ? { code: v.code } : {}), ...(v.error ? { error: v.error } : {}) });
      else if (v.state === 'done') on({ waiting: false, done: true });
      else if (v.why === 'busy') on({ waiting: false, error: 'Another sign-in is already in progress. Finish or cancel it, then try again.' });
      else if (v.why === 'expired') on({ waiting: false, error: `The sign-in took too long. Tap Sign in with ${name} to start again.` });
      else if (v.why !== 'declined') on({ waiting: false, error: v.error ?? 'Sign-in failed', ...(v.cause ? { cliLogin: { signIn: v.cause.signIn } } : {}) });
    });
  }

  /** A plan-key account (OpenCode Go): the wizard has no page for it, so the pasted key goes to the kit's own choice;
   *  a login acting for several workspaces names one first (one is used unasked, several wait for the person's pick). */
  keyIn(account: string, authChoice: string, on: (step: SignInStep) => void) {
    const busy = 'Still checking the last key. Wait for it to finish, then paste again.';
    let cancelled = false, key = '', chosen = '', listed: { id: string; name: string }[] = [], pending: { cancel(): void } | undefined;
    const step = ({ status, message }: { status: string; message?: string }): void => void (cancelled || (status === 'ok' ? on({ waiting: false, done: true }) : status === 'not_included' ? on({ waiting: false, notIncluded: true }) : status === 'retry' ? on({ waiting: false, error: message ?? `That didn't go through. Tap Sign in with ${PROVIDERS[account]?.name ?? account} to try again.` }) : on({ waiting: true, error: `That key didn't work. Check it and paste it again.` }))), add = () => { const h = this.kit.addKey(ME, { authChoice, apiKey: key, ...(chosen ? { orgId: chosen } : {}) }); pending = h; this.keyChecks.add(account); const release = () => { if (pending === h) { pending = undefined; this.keyChecks.delete(account); } }; return h.then((r) => { release(); if (cancelled) return; if (r.status === 'needs_workspace') { listed = r.workspaces; on({ waiting: true, workspaces: r.workspaces }); } else step(r); }).catch(() => { release(); step({ status: 'retry' }); }); };
    return {
      paste: (text: string) => { if (this.keyChecks.has(account)) throw new Error(busy); key = text.trim(); chosen = ''; listed = []; if (!cancelled) return add(); },
      pick: (id: string) => { if (this.keyChecks.has(account)) throw new Error(busy); if (!cancelled && listed.some((w) => w.id === id)) { chosen = id; return add(); } },
      cancel: () => { cancelled = true; pending?.cancel(); pending = undefined; this.keyChecks.delete(account); on({ waiting: false, error: 'The sign-in was cancelled.' }); },
    };
  }

  async signOut(account: string) { this.listed = undefined; const provider = await this.routeOf(account); if (!provider) throw new Error('no such AI account'); await this.kit.signOut(ME, provider); }

  private listed?: Promise<{ models?: any[] }>; // the catalog, read once for the picker, a MiniMax key's default and each run's thinking check (slow under load); a sign-in or sign-out reads it again
  private catalog() { return this.listed ??= this.kit.ensureMember(ME).then(({ agentId }) => this.kit.call('models.list', { agentId, view: 'all' }, { timeoutMs: 20_000 })).catch((e) => { this.listed = undefined; throw e; }); } // 'all' is the kit's account read (default lists nothing)
  /** A plan key (OpenCode Go) offers none: the kit does not yet honour a run's model on a key run, so it runs its saved one. */
  async models(account: string) {
    const provider = await this.routeOf(account), signed = ['openai-codex', 'minimax'].includes(provider) && await this.kit.signedIn(ME, provider), r = await this.catalog(), live = provider === 'openrouter' && await this.kit.signedIn(ME, provider) ? await this.kit.models(ME, { authChoice: 'openrouter-api-key' }).catch(() => []) : []; // an OpenRouter key lists its vendor's live catalog (ids may carry a `:free` tag); the Codex CLI owns its login and a MiniMax key sits outside the catalog's own check, so both read unavailable until signed in
    return (live.length ? live.map((m) => ({ ...m, provider, available: true })) : r.models ?? []).filter((m) => provider !== 'opencode-go' && m.provider === provider && (m.available !== false || signed)).map((m) => ({ id: m.id.replace(`${provider}/`, ''), name: m.name }));
  }
  /** Low thinking goes only to a model whose catalog lists it; MiniMax M3 and Flash list off and adaptive, and refuse off, so they run on their default. */
  private async thinks(provider: string, model: string | undefined, level: string) {
    const levels = (await this.catalog().catch(() => undefined))?.models?.find((m) => m.provider === provider && (model ? m.id.replace(`${provider}/`, '') === model : m.tags?.includes('default')))?.thinkingLevels;
    return !levels || levels.some((l: { id: string }) => l.id === level);
  }
  /** Stage offline through the kit; confirmation removes the verified source without a plaintext archive. */
  async migrate(legacyAuthPath: string) { return await this.kit.migrateRetainedLogin(ME, { path: legacyAuthPath }) === 'staged'; }
  confirm(legacyAuthPath: string) { return this.kit.confirmRetainedLogin(ME, { path: legacyAuthPath }); }

  /** Set the custom OpenAI-compatible provider and primary model (the tests' scripted model). */
  async configureModelProvider(baseUrl: string, apiKey: string, modelRef = 'crewhouse-stub/test') {
    await this.kit.patchConfig({
      models: { providers: { 'crewhouse-stub': {
        baseUrl, apiKey, api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: true, input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: ['off', 'low', 'medium', 'high'] } }],
      } } },
      agents: { defaults: { model: { primary: modelRef } } },
    });
  }

  async setLearning(on: boolean) { await this.kit.patchConfig({ skills: { workshop: { autonomous: { mode: on ? 'auto' : 'off' } } } }); }

  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    const provider = await this.routeOf(spec.account), model = spec.model ?? (provider === 'claude-cli' ? 'claude-opus-5' : provider === 'minimax' ? (await this.catalog().catch(() => undefined))?.models?.find((m) => m.provider === provider && /flash/i.test(m.id))?.id.replace(`${provider}/`, '') : undefined); // the run's own account is the one called and billed; bare Claude runs the CLI's default, never the engine's (ChatGPT's); a plan-key account runs the model the run names, else the kit's saved default
    const keyLane = !!provider && !(await this.kit.providers(ME)).includes(provider) && await this.kit.signedIn(ME, provider); this.runs.set(spec.key, { ...spec, keyLane: keyLane && !spec.key.startsWith('agent:byokit-key-') }); // an account signed in only by its saved key runs on the key lane; a member sign-in wins
    try {
      const lane = keyLane ? `byokit-key-${ME}` : (await this.kit.ensureMember(ME)).agentId;
      if (!this.personas.has(lane)) { for (const [name, content] of [['SOUL.md', 'Follow the persona and job supplied for this session.\n'], ['IDENTITY.md', 'Use the identity supplied for this session.\n']]) await this.kit.call('agents.files.set', { agentId: lane, name, content }); this.personas.add(lane); }
      const helper = /^agent:(?:m1|byokit-key-m1):h-([^:]+):/.exec(spec.key)?.[1];
      if (helper) await this.kit.ensureHelper(ME, helper, { account: `${provider}${keyLane ? '.key' : ''}`, persona: spec.system });
      const request: KitRunSpec = { sessionKey: helper ? spec.key.replace(/^agent:byokit-key-m1:/, 'agent:m1:') : spec.key, member: ME, message: spec.message, ...(helper ? { helper, account: `${provider}${keyLane ? '.key' : ''}` } : { system: spec.system }),
        ...(keyLane && !helper ? { auth: 'apiKey' as const } : {}), ...(model && provider ? { model: `${provider}/${model}` } : {}), ...(spec.images?.length ? { images: spec.images } : {}), ...(spec.thinking && await this.thinks(provider, model, spec.thinking) ? { thinking: spec.thinking } : {}) };
      return spec.team ? await this.nativeRun(spec, request, lane, on) : await this.kit.run(request,
        (e) => { if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e); });
    } catch (error) { return { ok: false, kind: 'other', message: String(error) }; }
    finally { this.runs.delete(spec.key); }
  }
  /** Native dispatch owns execution; this adapter only prepares the target's host context and projects its events. */
  private async nativeRun(spec: RunSpec, request: KitRunSpec, lane: string, on: (event: RunEvent) => void): Promise<RunEnd> {
    const targets = new Map<string, { bot: string; run?: RunRef }>(), helpers: Record<string, string[]> = {}, texts = new Map<string, string>(), admitted = new Set<string>(), accounts = await this.kit.accounts(ME), provider = await this.routeOf(spec.account), account = accounts.find((a) => a.id === `${provider}${lane.startsWith('byokit-key-') ? '.key' : ''}`)?.id;
    if (!account) return this.kit.run(request, (e) => { if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e); });
    for (const member of spec.team!) {
      if (member.system.length > 8192) return { ok: false, kind: 'handoff', message: 'A helper’s instructions and notes are too long. Shorten them before handing it this job.' };
      const helper = `b${createHash('sha256').update(member.bot).digest('hex').slice(0, 15)}`, key = `agent:${lane}:h-${helper}:crewhouse:${member.bot}`;
      await this.kit.ensureHelper(ME, helper, { account, persona: member.system });
      const adopted = await this.kit.adoptHelperSession({ member: ME, sessionKey: `agent:${ME}:crewhouse:${member.bot}` }, helper);
      if (!adopted.ok && adopted.code !== 'unsupported') throw new Error(`A helper's earlier conversation could not move: ${adopted.message}`);
      await this.kit.call('sessions.create', { agentId: lane, key, ...(request.model ? { model: request.model } : {}) });
      helpers[helper] = member.tools.map((t) => t === 'bash' ? 'shell' : t).filter((t) => TOOLS.some((spec) => spec.name === t));
      targets.set(key, { bot: member.bot });
    }
    this.targets.set(spec.key, targets); this.legs.set(spec.key, 0);
    let finish!: (end: RunEnd) => void, timer: NodeJS.Timeout | undefined, dispatched = false;
    const returned = new Promise<RunEnd>((resolve) => { finish = resolve; }), id = randomUUID(), rootKey = spec.key.replace(`agent:${ME}:`, `agent:${lane}:`);
    const offChild = this.kit.onEvent('byokit.delegated', (e) => {
      if (e.run.root.sessionKey !== rootKey || e.run.root.runId !== id) return;
      const target = targets.get(e.run.sessionKey), run = target ? target.run : this.runs.get(spec.key); // a spawned lookup has no job of its own: it is Chief's
      if (!run) return;
      if (e.type === 'admitted') { clearTimeout(timer); dispatched = true; admitted.add(e.run.runId); this.host?.event?.(run, { type: 'delegated', id: e.run.runId, parent: e.run.parent.runId, root: id }); }
      if (target && e.event?.stream === 'assistant' && typeof e.event.data?.text === 'string') { texts.set(e.run.runId, e.event.data.text); this.host?.event?.(run, { type: 'text', text: e.event.data.text }); }
      if (e.type === 'ended') {
        admitted.delete(e.run.runId);
        if (target) { this.host?.end?.(run, e.reason === 'terminal' ? { ok: true, text: texts.get(e.run.runId) ?? '' } : { ok: false, kind: 'other', message: e.message || 'The helper stopped before its result could be confirmed.' }); this.runs.delete(e.run.sessionKey); target.run = undefined; if (e.reason !== 'terminal') return finish({ ok: false, kind: 'other', message: e.message || 'The helper stopped before reporting back. Check its job before trying again.' }); }
        if (!admitted.size) timer = setTimeout(() => finish({ ok: false, kind: 'handoff', message: target ? 'The helper finished, but Chief did not get its report. Check the helper’s chat.' : 'The lookups finished, but Chief did not get their reports. Try again.' }), 120_000);
      }
    });
    const offReturn = this.kit.onEvent('agent', (e) => {
      if (!dispatched || !('sessionKey' in e) || e.sessionKey !== rootKey || e.runId === id) return; // display only; the kit admits every tool call by exact run identity
      if (e.stream === 'assistant' && typeof e.data?.text === 'string') on({ type: 'text', text: e.data.text });
      if (e.stream === 'lifecycle' && e.data?.phase === 'end' && !admitted.size) {
        const reply = e.data.terminalReply as { disposition?: string; text?: string } | undefined;
        finish(e.data.aborted ? { ok: false, aborted: true } : { ok: true, text: reply?.disposition === 'visible' ? reply.text ?? '' : '' });
      }
    });
    try {
      const end = await this.kit.run({ ...request, idempotencyKey: id, delegates: { [lane]: [] }, helperDelegates: helpers, system: `${spec.system}${targets.size ? `\nNative hand-off: use sessions_send with an exact sessionKey below, message with the job and done means, timeoutSeconds: 0. Admission is not completion. Your helper reports back natively; do not invent its result.\n${[...targets].map(([key, t]) => `${t.bot}: ${key}`).join('\n')}` : ''}\nLegwork: for plain web lookups, call sessions_spawn with agentId "${lane}", task (one thing to look up and what to report) and label, up to ${MAX_LEGS} in a job. Each only reads the web and reports back. Then call sessions_yield with how to answer (tone, format) and answer when the reports arrive, never in their place.` }, (e) => {
        if (e.type !== 'account') on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e);
        if (e.type === 'tool' && e.name === 'sessions_send' && e.phase === 'end' && e.error) for (const [key, t] of targets) if (t.run && ![...this.kit.delegatedRuns()].some((r) => r.sessionKey === key)) { this.host?.end?.(t.run, { ok: false, kind: 'handoff', message: 'The job could not be handed to the helper. Try again.' }); this.runs.delete(key); t.run = undefined; }
      });
      return end.ok && dispatched ? await returned : end;
    } finally {
      clearTimeout(timer); offChild(); offReturn(); this.targets.delete(spec.key); this.legs.delete(spec.key); if (admitted.size) await this.abort(spec.key).catch(() => {});
      for (const [key, t] of targets) if (t.run) { await this.kit.abort(key); this.host?.end?.(t.run, { ok: false, kind: 'handoff', message: 'The hand-off stopped before its result was confirmed.' }); this.runs.delete(key); }
    }
  }
  steer(key: string, text: string) { return this.kit.steer(key, text, this.runs.get(key)?.keyLane ? { auth: 'apiKey' as const } : undefined); }
  abort(key: string) { return this.kit.abort(key, this.runs.get(key)?.keyLane ? { auth: 'apiKey' as const } : undefined); }
  /** The workshop's pending and loaded skills on every lane that learns them: the member agent and, once a plan key
   *  made it, its key agent (`byokit-key-<member>`, the kit's README), each with its own proposals and skills root
   *  from the engine's roster. Newest first; a forgotten one has left its skills root, so it is gone here too. */
  private async proposals() {
    const { agentId } = await this.kit.ensureMember(ME), roster = await this.kit.call('agents.list', {}, { timeoutMs: 20_000 }).catch(() => undefined), lanes = (roster?.agents ?? []).filter((a) => (a.id === agentId || a.id === `byokit-key-${ME}`) && a.workspace).map((a) => ({ agentId: a.id, skills: join(a.workspace!, 'skills') })), rows = (await Promise.all(lanes.map(async (lane) => ((await this.kit.call('skills.proposals.list', { agentId: lane.agentId }, { timeoutMs: 20_000 }).catch(() => undefined))?.proposals ?? [])
      .map((p) => ({ id: String(p.id ?? ''), skill: String(p.skillName ?? p.title ?? ''), key: String(p.skillKey ?? ''), at: Date.parse(p.updatedAt ?? p.createdAt ?? '') || 0, state: p.status, lane }))))).flat();
    return rows.filter((p) => p.id && p.key && (p.state === 'pending' || (p.state === 'applied' && existsSync(join(p.lane.skills, p.key, 'SKILL.md'))))).sort((a, b) => b.at - a.at);
  }
  /** What the person sees learned: one row per skill name, whichever lane learned it; the newest copy wins. */
  composioBegin() { return this.kit.beginComposioSignIn(); }
  composioDone() { return this.kit.completeComposioSignIn(); }
  composioSignOut() { return this.kit.signOutComposio(); }
  async learned() {
    const rows = await this.proposals();
    return rows.filter((p, i) => rows.findIndex((q) => q.skill === p.skill) === i).map(({ id, skill, at, state }) => ({ id, skill, at, state }));
  }

  /** The member lane's learned-skills folder, and a lane's pre-change capture: crewhouse's own git versioning. A
   *  capture that cannot be verified throws, and the caller must refuse the change — the data stays. */
  workspaceOf() { return join(this.stateDir, 'openclaw/workspaces', ME, 'skills'); }
  captureLearned(dir = this.workspaceOf(), why = 'Before the skill collection review'): string {
    if (!existsSync(join(dir, '.git'))) mkdirSync(dir, { recursive: true });
    const hash = commit(dir, ['.'], why, true);
    if (!hash) throw new Error('the learned-skills capture failed; nothing was changed');
    return hash;
  }
  /** Bring one learned skill back from the capture history, even after later edits or reviews. The target is the
   *  real workspace layout the engine reads: workspaceOf() is the skills root itself, so the skill sits directly
   *  inside it (`<name>/SKILL.md`, never `skills/<name>/SKILL.md`). The capture is read before anything is written —
   *  a restore that cannot be verified throws and leaves the workspace untouched. The blob is written as raw bytes,
   *  so the restore is byte-for-byte: leading and trailing whitespace and the final newline all survive. */
  restoreLearned(name: string, hash?: string, dir = this.workspaceOf()) {
    const git = (argv: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', ...argv], { cwd: dir, stdio: 'pipe' }), at = (hash ?? git(['rev-parse', '--short', 'HEAD'])).toString().trim();
    let body: Buffer;
    try { body = git(['show', `${at}:${name}/SKILL.md`]); }
    catch { throw new Error(`no learned-skill capture holds "${name}"; nothing was restored`); }
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'SKILL.md'), body);
    commit(dir, ['.'], `Restored ${name} from ${at}`);
    return at;
  }

  /** The workshop window for the person's own collection review: its reconcile only, one call wide. The engine mints
   *  the reviewer's session key fresh per run (`incognito-<uuid>`), so the first qualifying call is the captured one. */
  armCuration(ms = 10 * 60_000) {
    this.kit.allowOnce({ keyPrefix: `agent:${ME}:skill-collection-review:`, tool: 'skill_workshop', input: (i) => i.action === 'reconcile' }, ms);
  }

  /** The collection review, on crewhouse's own boundary: capture first (refusing everything on failure), open the
   *  workshop window only for the person's own reviewer and its reconcile — one call wide — run the review, close
   *  it, and report kept/rewritten/dropped. */
  async runCollectionReview() {
    const capture = this.captureLearned(), jobs = await this.kit.call('cron.list', { limit: 100 }, { timeoutMs: 20_000 }) as { jobs?: { id: string; name: string; enabled: boolean }[] }, job = jobs.jobs?.find((j) => j.name === `skill-collection-review-${ME}`);
    if (!job?.enabled) throw new Error('the collection review is not enabled');
    this.armCuration();
    try {
      const kicked = await this.kit.call('cron.run', { id: job.id, mode: 'force' } as { id: string }, { timeoutMs: 30_000 }) as { runId?: string };
      for (const end = Date.now() + 240_000; Date.now() < end;) {
        await sleep(2000);
        const runs = await this.kit.call('cron.runs', { id: job.id }, { timeoutMs: 20_000 }).catch(() => undefined) as { entries?: { runId: string; status: string }[] } | undefined;
        if (runs?.entries?.some((e) => e.runId === kicked.runId && e.status === 'ok')) break;
      }
      const curator = await this.kit.call('skills.curator.status', {}, { timeoutMs: 20_000 }).catch(() => undefined) as any, outcome = curator?.collectionReview ?? {}, names = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.name ?? x?.skill ?? x).filter(Boolean) : [];
      return { capture, kept: names(outcome.kept), written: names(outcome.written), dropped: names(outcome.dropped) };
    } finally { this.kit.disallowOnce(); }
  }

  /** The reviewed ClawHub starter set (starter-skills.json): what each one does, what it needs, and whether
   *  the engine already holds it in the workspace. Listing only — installs go through the engine's own gate. */
  starterSkills() {
    return (JSON.parse(readFileSync(join(appDir, 'src/openclaw/starter-skills.json'), 'utf8')).approved as any[]).map((s) => ({ slug: String(s.slug), name: String(s.name ?? s.slug), owner: String(s.owner), version: String(s.version), maturity: String(s.maturity),
      summary: String(s.summary), why: String(s.why), needs: (s.needs ?? []).map(String),
      on: existsSync(join(this.workspaceOf(), String(s.slug))) }));
  }
  /** Switch one starter skill on or off the engine's own way: turning on installs it through the trust gate,
   *  turning off disables it. Anything outside the reviewed set is refused in plain words. */
  async setStarter(slug: string, on: boolean) {
    const found = this.starterSkills().find((s) => s.slug === slug);
    if (!found) throw new Error(`“${slug}” is not one of the reviewed starter skills, so the crew leaves it alone.`);
    const { agentId } = await this.kit.ensureMember(ME);
    if (on) await this.kit.call('skills.install', { agentId, source: 'clawhub', slug: `@${found.owner}/${found.slug}`, version: found.version }, { timeoutMs: 120_000 });
    else await this.kit.call('skills.update', { skillKey: found.slug, enabled: false }, { timeoutMs: 60_000 });
  }
  /** Search the public skill and plugin catalogs the engine's own way; while the engine is still starting this answers
   *  empty. A plugin is never one of the reviewed rows, so it only ever shows as not reviewed. */
  async searchSkills(query: string) {
    const [r, p] = await Promise.all([this.kit.call('skills.search', { query, limit: 10 }, { timeoutMs: 30_000 }).catch(() => undefined) as any, this.kit.call('plugins.search', { query, limit: 10 }, { timeoutMs: 30_000 }).catch(() => undefined)]), items = Array.isArray(r?.items) ? r.items : Array.isArray(r?.results) ? r.results : [], starter = this.starterSkills();
    // Reviewed means this publisher's skill: another owner's skill of the same name is not the one that was read.
    return [...items.slice(0, 10).map((i: any) => ({ slug: String(i.slug ?? ''), owner: String(i.ownerHandle ?? i.owner ?? ''), summary: String(i.summary ?? i.description ?? ''), version: String(i.version ?? i.latestVersion ?? '') }))
      .map((i: any) => ({ ...i, reviewed: starter.some((s) => s.slug === i.slug && s.owner === i.owner), on: starter.some((s) => s.on && s.slug === i.slug && s.owner === i.owner) })),
    ...(p?.results ?? []).map((i) => ({ slug: i.package.name, name: i.package.displayName, kind: 'plugin', summary: i.package.summary ?? '', version: i.package.latestVersion ?? '', reviewed: false, on: false }))].filter((i: any) => i.slug);
  }
  /** Forget one learned skill on every lane that holds it. A pending proposal is rejected in its own agent; a loaded
   *  one is captured, then put away in its lane's skills/.archive (the engine skips dot folders and its watcher drops
   *  it), so restoreLearned brings it back byte for byte and nothing is deleted. The engine has no single-skill
   *  removal of an applied skill; this stands in until it does. */
  async forget(id: string, skill = '') {
    const rows = await this.proposals(), name = rows.find((p) => p.id === id)?.skill ?? skill, copies = rows.filter((p) => p.id === id || (name && p.skill === name));
    if (!copies.length) throw Object.assign(new Error(`"${skill || id}" is no longer a learned skill; nothing was forgotten`), { status: 404 });
    for (const p of copies) {
      const at = { agentId: p.lane.agentId, proposalId: p.id }, timeoutMs = 20_000;
      if (p.state === 'pending') { await this.kit.call('skills.proposals.reject', { ...at, expectedRevisionHash: (await this.kit.call('skills.proposals.inspect', at, { timeoutMs })).revisionHash ?? '' }, { timeoutMs }); continue; }
      const capture = this.captureLearned(p.lane.skills, `Before forgetting ${p.key}`);
      mkdirSync(join(p.lane.skills, '.archive'), { recursive: true });
      renameSync(join(p.lane.skills, p.key), join(p.lane.skills, '.archive', `${p.key}-${Date.now()}`));
      commit(p.lane.skills, ['.'], `Forgot ${p.key}; restore from ${capture}`);
    }
  }
}
