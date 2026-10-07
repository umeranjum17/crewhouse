// The BYOKit engine port: accounts, runs, tools and Crewhouse's learned-skill capture.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenClawKit, stateWords, type KitOptions, type ToolSpec } from '@byokit/openclaw';
import { osKeyringSeal } from '@byokit/secrets';
import { PROVIDERS } from '../accounts.ts';
import { commit } from '../bots.ts';
import { CALLBACK_PORT } from '../callback-port.ts';
import type { AgentRuntime, RunEnd, RunEvent, RunRef, RunSpec, SignInStep, ToolHost } from '../runtime.ts';

export { ENGINE_VERSION } from '@byokit/openclaw';

const repo = resolve(import.meta.dirname, '../..');
/** Crewhouse account key → OpenClaw provider id, one per account the sign-in card offers. Claude is its CLI: the kit names it claude-cli, never anthropic. */
const PROVIDER_OF: Record<string, string> = { chatgpt: 'openai', grok: 'xai', copilot: 'github-copilot', openrouter: 'openrouter', minimax: 'minimax', claude: 'claude-cli' };
/** The engine's own sign-in route per account (the pin's wizard choices). */
const AUTH_CHOICE: Record<string, string> = {
  chatgpt: 'openai', grok: 'xai-oauth', copilot: 'github-copilot', openrouter: 'openrouter-oauth', minimax: 'minimax-global-oauth', claude: 'anthropic-cli',
};
const CODE_CHOICE: Record<string, string> = {
  chatgpt: 'openai-device-code', grok: 'xai-device-code', openrouter: 'openrouter-oauth', minimax: 'minimax-global-oauth',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ME = 'm1';
/** The engine-side name of a Crewhouse tool and back: only the shell differs. */
const crewName = (tool: string) => tool === 'shell' ? 'bash' : tool;

const args = { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false };
const SCHEMAS: Record<string, object> = {
  crew_import: { type: 'object', properties: { list: { type: 'boolean', description: 'List published Grok categories and Claude skills without importing.' }, slug: { type: 'string', description: 'Grok template handle or published address.' }, skill: { type: 'string', description: 'Claude skill name or owner/repo:skills/name.' }, name: { type: 'string' }, source: { type: 'string' } }, additionalProperties: false },
  shell: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
  browser: args, calendar: args, mail: args,
  crew_app: { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'object', additionalProperties: true } }, required: ['tool'], additionalProperties: false },
  crew_remember: { type: 'object', properties: { text: { type: 'string', description: 'One short line stating the lasting preference to save.' }, replaces: { type: 'string', description: 'Words of an old note this corrects, if any.' }, everyone: { type: 'boolean', description: 'True if every helper should know it; otherwise it stays in your notes.' } }, required: ['text'], additionalProperties: false },
  crew_document: { type: 'object', properties: { name: { type: 'string', description: 'Title of the finished document.' }, blocks: { type: 'array', description: 'Document content in order: {heading}, {text}, {bullets: [strings]} or {table: {head: [cells], rows: [[cells]]}}.', items: { type: 'object', additionalProperties: true }, minItems: 1 } }, required: ['name', 'blocks'], additionalProperties: false },
  crew_create: { type: 'object', properties: { bot: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, job: { type: 'object', properties: Object.fromEntries(['does', 'aim', 'gets', 'how', 'great'].map((k) => [k, { type: 'string', minLength: 1, maxLength: 600 }])), required: ['does', 'aim', 'gets', 'how', 'great'], additionalProperties: false }, personality: { type: 'string' }, first: { type: 'string' } }, required: ['role', 'job'], additionalProperties: false },
  crew_outcome: { type: 'object', properties: { worked: { type: 'boolean' }, seen: { type: 'string' } }, required: ['worked', 'seen'], additionalProperties: false },
  crew_workbook: { type: 'object', properties: { name: { type: 'string' }, sheets: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, columns: { type: 'array', items: { type: 'object', properties: { header: { type: 'string' }, width: { type: 'number' }, options: { type: 'array', items: { type: 'string' } } }, required: ['header'], additionalProperties: false } }, rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } } } }, required: ['name', 'columns'], additionalProperties: false } } }, required: ['name', 'sheets'], additionalProperties: false },
  crew_verify: { type: 'object', properties: { repo: { type: 'string' }, base: { type: 'string' }, patch: { type: 'string' }, tests: { type: 'array', items: { type: 'string' } }, command: { type: 'string' } }, required: ['repo', 'base', 'patch', 'tests', 'command'], additionalProperties: false },
  crew_pass: { type: 'object', properties: { bot: { type: 'string' }, task: { type: 'string' }, files: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } }, required: ['bot', 'task'], additionalProperties: false },
  crew_assign: { type: 'object', properties: { bot: { type: 'string' }, task: { type: 'string' }, title: { type: 'string' }, account: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['bot', 'task'], additionalProperties: false },
  crew_routine: { type: 'object', properties: { bot: { type: 'string' }, when: { type: 'string' }, on: { type: 'string' }, task: { type: 'string' }, name: { type: 'string' }, account: { type: 'string' }, quiet: { type: 'boolean' }, watch: { type: 'string' }, once: { type: 'boolean' } }, required: ['task'], additionalProperties: false },
  crew_report: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  crew_draft: { type: 'object', properties: { path: { type: 'string' }, channel: { type: 'string', enum: ['email', 'message', 'post'] }, to: { type: 'string' }, subject: { type: 'string' }, why: { type: 'string' }, link: { type: 'string' } }, required: ['path', 'channel', 'to'], additionalProperties: false },
  crew_batch: { type: 'object', properties: { question: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['question', 'items'], additionalProperties: false },
};
const ABOUT: Record<string, string> = {
  shell: 'Run a shell command in your own space (a sandbox: your folder is the only writable part of the disk). Long output is cut to the last lines.',
  browser: 'Your own browser (playwright-axi): goto <url>, snapshot, find <text>, click <ref>, fill <ref> <text>, press <key>, go-back.',
  calendar: "The person's own Google Calendar: see what is next, the day or week, free time, add, move, cancel, as `args`.",
  mail: "The person's own Gmail, read-only: what is new, search it, read a conversation, as `args`. It cannot send or change mail.",
  crew_app: "Use one of the person's connected apps' tools: `tool` names it (the run's prompt lists them) and `input` carries its arguments.",
  crew_remember: 'Save a lasting preference: pass {text: "one short line"}; optionally replaces and everyone. Do not save how to address the person.',
  crew_batch: 'Research several items at once against one question, then merge the answers into your spreadsheet.',
  crew_document: 'Write and deliver an editable document: pass {name: "title", blocks: [{heading: "Title"}, {text: "Paragraph"}, {bullets: ["Item"]}]}. Crewhouse writes the file; do not make it yourself.',
};
export const TOOLS: ToolSpec[] = ['shell', 'browser', 'calendar', 'mail', 'crew_app', 'crew_web_fetch', 'crew_web_search', 'crew_read', 'crew_write',
  'crew_edit', 'crew_ls', 'crew_grep', 'crew_find', 'crew_connect', 'crew_outcome', 'crew_report', 'crew_batch', 'crew_deliver', 'crew_workbook', 'crew_document',
  'crew_copy', 'crew_remember', 'crew_draft', 'crew_verify', 'crew_learn', 'crew_routine', 'crew_pass', 'crew_add_phone', 'crew_roster',
  'crew_recruit', 'crew_assign', 'crew_routines', 'crew_status', 'crew_suggest', 'crew_create', 'crew_import', 'crew_call_me',
].map((name) => ({ name, description: ABOUT[name] ?? `Crewhouse ${name.slice(5).replaceAll('_', ' ')}. The person sees the result in their crew.`,
  parameters: SCHEMAS[name] ?? { type: 'object', additionalProperties: true } }));

const CONFIG = {
  // An empty allow list: the engine otherwise narrows to its model map, and the person's other providers vanish.
  agents: { defaults: { sandbox: { mode: 'off' }, modelPolicy: { allow: [] }, compaction: { memoryFlush: { enabled: false } }, heartbeat: { every: '0m' } } },
  tools: { profile: 'coding', alsoAllow: TOOLS.map((t) => t.name), deny: ['group:fs', 'group:runtime', 'group:automation', 'group:messaging', 'group:nodes', 'group:ui', 'sessions_send', 'sessions_spawn', 'conversations_send', 'conversations_turn', 'subagents', 'code_execution', 'gateway', 'openclaw', 'plugins', 'cron', 'ask_user', 'suggest_task'], fs: { workspaceOnly: true }, exec: { security: 'deny', ask: 'always' }, elevated: { enabled: false }, agentToAgent: { enabled: false }, sessions: { visibility: 'agent' } },
  plugins: { load: { paths: [] }, allow: ['crewhouse', 'memory-core', 'openai'], entries: {
    'memory-core': { config: { dreaming: { enabled: false } } },
    codex: { enabled: false },
  } },
  skills: { allowBundled: ['video-frames', 'openai-whisper', 'summarize', 'nano-pdf', 'diagram-maker'], workshop: { approvalPolicy: 'auto' } },
};

export class OpenClawRuntime implements AgentRuntime {
  readonly kit: OpenClawKit;
  readonly stateDir: string;
  private host?: ToolHost;
  private runs = new Map<string, RunRef>();
  constructor(stateDir: string, crewDir = '', o: Partial<KitOptions> = {}) {
    this.stateDir = stateDir;
    this.kit = new OpenClawKit({
      stateDir, engineDir: join(repo, 'runtime/openclaw'), plugin: { id: 'crewhouse' }, tools: TOOLS, config: CONFIG, enginePath: (process.env.PATH ?? '').split(':').filter((d) => d && existsSync(join(d, 'claude'))), // the Claude route drives the `claude` CLI: the engine's own PATH is /usr/bin:/bin only
      authSeal: 'authSeal' in o ? o.authSeal : osKeyringSeal({ service: 'crewhouse-engine', dualWrap: true }),
      permitted: (tool) => tool.startsWith('crew_'), callbackPort: CALLBACK_PORT,
      installPolicy: { trustedSkills: join(import.meta.dirname, 'trusted-skills.json'), ownRoots: [repo, crewDir].filter(Boolean) },
      host: {
        // A key the kit passes that Crewhouse never registered is the armed curation window's one call (allowOnce).
        gate: async (ref, tool, input) => {
          const run = this.runs.get(ref.sessionKey);
          if (!run) return { allow: true };
          if (!this.host) return { allow: false, reason: 'Crewhouse could not check this call.' };
          const decision = await this.host.gate(run, crewName(tool), input);
          return decision.allow ? decision : { allow: false, reason: decision.reason };
        },
        call: async (ref, tool, input, signal) => {
          const run = this.runs.get(ref.sessionKey);
          if (!run || !this.host) throw new Error('Unknown run');
          return this.host.call(run, crewName(tool), input, signal);
        },
      },
      ...o,
    });
  }
  async start(host: ToolHost) { this.host = host; await this.kit.start(); }
  async stop() { await this.kit.stop(); }
  signInRecovery() { return this.kit.state.phase === 'locked' || this.kit.state.why === 'engine-already-running' ? stateWords(this.kit.state) : ''; }
  memoryLimited() { return this.kit.memoryLimited(ME); }

  // ---- accounts: the engine owns credentials; the kit drives its wizard and reads its status ----

  async signedIn(account: string) {
    const provider = PROVIDER_OF[account];
    return provider ? this.kit.signedIn(ME, provider) : false;
  }

  signIn(account: string, via: 'browser' | 'code', on: (step: SignInStep) => void): { paste(text: string): void; cancel(): void; done?: Promise<unknown> } {
    if (this.signInRecovery()) {
      let cancelled = false;
      void this.kit.start().then(async () => { if (!cancelled) on({ waiting: false, ...(await this.signedIn(account) ? { done: true } : { error: this.signInRecovery() || 'Please try again.' }) }); })
        .catch(() => { if (!cancelled) on({ waiting: false, error: 'Please try again.' }); });
      return { paste() {}, cancel() { cancelled = true; } };
    }
    const authChoice = via === 'code' ? CODE_CHOICE[account] ?? AUTH_CHOICE[account] : AUTH_CHOICE[account];
    if (!authChoice) {
      queueMicrotask(() => on({ waiting: false, error: `Sign-in for ${account} is not connected yet` }));
      return { paste() {}, cancel() {} };
    }
    const name = PROVIDERS[account]?.name ?? account;
    return this.kit.signIn(ME, { authChoice, via }, (v) => {
      if (v.state === 'waiting') on({ waiting: true, ...(v.url ? { url: v.url } : {}), ...(v.code ? { code: v.code } : {}), ...(v.error ? { error: v.error } : {}) });
      else if (v.state === 'done') on({ waiting: false, done: true });
      else if (v.why === 'busy') on({ waiting: false, error: 'Another sign-in is already in progress. Finish or cancel it, then try again.' });
      else if (v.why === 'expired') on({ waiting: false, error: `The sign-in took too long. Tap Sign in with ${name} to start again.` });
      else if (v.why !== 'declined') on({ waiting: false, error: v.error ?? 'Sign-in failed' });
    });
  }

  async signOut(account: string) {
    const provider = PROVIDER_OF[account];
    if (!provider) throw new Error('no such AI account');
    await this.kit.signOut(ME, provider);
  }

  /** Stage offline through the kit; confirmation removes the verified source without a plaintext archive. */
  async migrate(legacyAuthPath: string) { return await this.kit.migrateRetainedLogin(ME, { path: legacyAuthPath }) === 'staged'; }
  confirm(legacyAuthPath: string) { return this.kit.confirmRetainedLogin(ME, { path: legacyAuthPath }); }

  /** Set the custom OpenAI-compatible provider and primary model (the tests' scripted model). */
  async configureModelProvider(baseUrl: string, apiKey: string, modelRef = 'crewhouse-stub/test') {
    await this.kit.patchConfig({
      models: { providers: { 'crewhouse-stub': {
        baseUrl, apiKey, api: 'openai-completions',
        models: [{ id: 'test', name: 'Test', reasoning: true, input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: ['off', 'low', 'medium', 'high'] } }],
      } } },
      agents: { defaults: { model: { primary: modelRef } } },
    });
  }

  async setLearning(on: boolean) { await this.kit.patchConfig({ skills: { workshop: { autonomous: { mode: on ? 'auto' : 'off' } } } }); }
  async learning() {
    const s = await this.kit.call('config.get', {}, { timeoutMs: 20_000 }).catch(() => undefined) as { config?: any } | undefined;
    return s?.config?.skills?.workshop?.autonomous?.mode !== 'off';
  }

  async run(spec: RunSpec, on: (event: RunEvent) => void, opts?: { register?: boolean }): Promise<RunEnd> {
    const register = opts?.register !== false;
    if (register) this.runs.set(spec.key, spec);
    const provider = PROVIDER_OF[spec.account], model = spec.model ?? (provider === 'claude-cli' ? 'claude-opus-5' : undefined); // the run's own account is the one called and billed; bare Claude runs the CLI's default, never the engine's (ChatGPT's)
    try {
      return await this.kit.run({ sessionKey: spec.key, member: ME, message: spec.message, system: spec.system,
        ...(model && provider ? { model: `${provider}/${model}` } : {}), ...(spec.images?.length ? { images: spec.images } : {}), ...(spec.thinking ? { thinking: spec.thinking } : {}), register },
        (e) => on(e.type === 'tool' ? { ...e, name: crewName(e.name) } : e));
    } catch (error) { return { ok: false, kind: 'other', message: String(error) }; }
    finally { if (register) this.runs.delete(spec.key); }
  }
  steer(key: string, text: string) { return this.kit.steer(key, text); }
  abort(key: string) { return this.kit.abort(key); }
  /** The person's applied learned skills (the workshop's proposals, applied state last). */
  async learned() {
    const { agentId } = await this.kit.ensureMember(ME);
    const list = await this.kit.call('skills.proposals.list', { agentId }, { timeoutMs: 20_000 }).catch(() => undefined) as { proposals?: any[] } | undefined;
    return (list?.proposals ?? []).map((p) => ({
      id: String(p.id ?? ''),
      skill: String(p.skillName ?? p.title ?? ''),
      at: Date.parse(p.updatedAt ?? p.createdAt ?? '') || 0,
      state: String(p.status ?? ''),
    })).filter((p) => p.id);
  }

  /** The person's learned-skills folder, and its pre-change capture: crewhouse's own git versioning. A capture that
   *  cannot be verified throws, and the caller must refuse the review — the data stays. */
  workspaceOf() { return join(this.stateDir, 'openclaw/workspaces', ME, 'skills'); }
  captureLearned(): string {
    const dir = this.workspaceOf();
    if (!existsSync(join(dir, '.git'))) mkdirSync(dir, { recursive: true });
    const hash = commit(dir, ['.'], 'Before the skill collection review', true);
    if (!hash) throw new Error('the learned-skills capture failed; the review was refused');
    return hash;
  }
  /** Bring one learned skill back from the capture history, even after later edits or reviews. The target is the
   *  real workspace layout the engine reads: workspaceOf() is the skills root itself, so the skill sits directly
   *  inside it (`<name>/SKILL.md`, never `skills/<name>/SKILL.md`). The capture is read before anything is written —
   *  a restore that cannot be verified throws and leaves the workspace untouched. The blob is written as raw bytes,
   *  so the restore is byte-for-byte: leading and trailing whitespace and the final newline all survive. */
  restoreLearned(name: string, hash?: string) {
    const dir = this.workspaceOf();
    const git = (argv: string[]) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', ...argv], { cwd: dir, stdio: 'pipe' });
    const at = (hash ?? git(['rev-parse', '--short', 'HEAD'])).toString().trim();
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
    const capture = this.captureLearned();
    const jobs = await this.kit.call('cron.list', { limit: 100 }, { timeoutMs: 20_000 }) as { jobs?: { id: string; name: string; enabled: boolean }[] };
    const job = jobs.jobs?.find((j) => j.name === `skill-collection-review-${ME}`);
    if (!job?.enabled) throw new Error('the collection review is not enabled');
    this.armCuration();
    try {
      const kicked = await this.kit.call('cron.run', { id: job.id, mode: 'force' } as { id: string }, { timeoutMs: 30_000 }) as { runId?: string };
      for (const end = Date.now() + 240_000; Date.now() < end;) {
        await sleep(2000);
        const runs = await this.kit.call('cron.runs', { id: job.id }, { timeoutMs: 20_000 }).catch(() => undefined) as { entries?: { runId: string; status: string }[] } | undefined;
        if (runs?.entries?.some((e) => e.runId === kicked.runId && e.status === 'ok')) break;
      }
      const curator = await this.kit.call('skills.curator.status', {}, { timeoutMs: 20_000 }).catch(() => undefined) as any;
      const outcome = curator?.collectionReview ?? {};
      const names = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.name ?? x?.skill ?? x).filter(Boolean) : [];
      return { capture, kept: names(outcome.kept), written: names(outcome.written), dropped: names(outcome.dropped) };
    } finally { this.kit.disallowOnce(); }
  }

  /** The reviewed ClawHub starter set (starter-skills.json): what each one does, what it needs, and whether
   *  the engine already holds it in the workspace. Listing only — installs go through the engine's own gate. */
  starterSkills() {
    let approved: any[] = [];
    try { approved = JSON.parse(readFileSync(join(import.meta.dirname, 'starter-skills.json'), 'utf8')).approved ?? []; } catch { return []; }
    return approved.map((s) => ({ slug: String(s.slug), name: String(s.name ?? s.slug), owner: String(s.owner), version: String(s.version),
      summary: String(s.summary), why: String(s.why), needs: (s.needs ?? []).map(String),
      on: existsSync(join(this.workspaceOf(), String(s.slug))) }));
  }
  /** Switch one starter skill on or off the engine's own way: turning on installs it through the trust gate,
   *  turning off disables it. Anything outside the reviewed set is refused in plain words. */
  async setStarter(slug: string, on: boolean) {
    let approved: any[] = [];
    try { approved = JSON.parse(readFileSync(join(import.meta.dirname, 'starter-skills.json'), 'utf8')).approved ?? []; } catch {}
    const found = approved.find((s) => s.slug === slug);
    if (!found) throw new Error(`“${slug}” is not one of the reviewed starter skills, so the crew leaves it alone.`);
    const { agentId } = await this.kit.ensureMember(ME);
    if (on) await this.kit.call('skills.install', { agentId, source: 'clawhub', slug: `@${found.owner}/${found.slug}`, version: found.version }, { timeoutMs: 120_000 });
    else await this.kit.call('skills.update', { skillKey: String(found.slug), enabled: false }, { timeoutMs: 60_000 });
  }
  /** Search the public skill catalog the engine's own way; while the engine is still starting this answers empty. */
  async searchSkills(query: string) {
    const r = await this.kit.call('skills.search', { query, limit: 10 }, { timeoutMs: 30_000 }).catch(() => undefined) as any;
    const items = Array.isArray(r?.items) ? r.items : Array.isArray(r?.results) ? r.results : [];
    const on = new Set(this.starterSkills().filter((s) => s.on).map((s) => s.slug));
    return items.slice(0, 10).map((i: any) => ({ slug: String(i.slug ?? ''), owner: String(i.ownerHandle ?? i.owner ?? ''),
      summary: String(i.summary ?? i.description ?? ''), version: String(i.version ?? i.latestVersion ?? ''),
      reviewed: this.starterSkills().some((s) => s.slug === String(i.slug ?? '')),
      on: on.has(String(i.slug ?? '')) })).filter((i: any) => i.slug);
  }
  /** Forget one learned skill. Pending proposals are rejected directly; an applied one is restored by a one-shot
   *  turn whose only possible tool is the workshop's own restore (spec §5.4) — no other tool can run on it. */
  async forget(id: string, skill = '') {
    const { agentId } = await this.kit.ensureMember(ME);
    for (const method of ['skills.proposals.reject', 'skills.proposals.quarantine'] as const) {
      const ok = await this.kit.call(method, { agentId, proposalId: id } as any, { timeoutMs: 20_000 }).then(() => true).catch(() => false);
      if (ok) return;
    }
    // Applied: a one-shot turn, unregistered (so the gate allows only the workshop's restore), then forgotten for good.
    const end = await this.run({ key: `agent:${ME}:crewhouse:forget:${randomUUID()}`, bot: 'chief', task: 0, account: 'chatgpt',
      cwd: '', system: 'You are the crew\'s own workshop assistant. Use skill_workshop with action "restore_collection" and nothing else.', message: `Forget the learned skill "${skill}" (proposal ${id}): use skill_workshop with action "restore_collection" and nothing else.`, builtins: [] }, () => {}, { register: false });
    if (!end.ok) throw new Error('Forget failed');
  }
}
