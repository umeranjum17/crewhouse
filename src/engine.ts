// The bundled Pi engine, in-process. Each task runs as one Pi session in its bot's own folder (its "space"), on the
// task member's own runtime, with only the tools its grants give it. Every tool call passes crewd's gate first.
import './isolate.ts';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createAgentSession, createBashTool, DefaultResourceLoader, defineTool, SessionManager, SettingsManager,
  type AgentSession, type ModelRuntime, type ToolCallEventResult, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { engineDir } from './isolate.ts';

export type Gate = (tool: string, input: Record<string, any>) => Promise<ToolCallEventResult | undefined>;

export interface SessionSpec {
  runtime: ModelRuntime;
  provider: string;
  model: string;
  space: string;
  /** The task's session file to continue, or the folder a new one goes in. */
  file?: string;
  sessionsDir: string;
  system: string;
  skills: string;
  /** The engine's own file tools (read, write, edit, ls, grep, find) and whether the sandboxed shell comes with them. */
  builtins: string[];
  tools: ToolDefinition[];
  gate: Gate;
  /** Automatic retries on a passing hiccup; the stub model wants every answer exactly once. */
  retry: boolean;
}

export async function openSession(s: SessionSpec): Promise<AgentSession> {
  const model = s.runtime.getModel(s.provider, s.model) ?? s.runtime.getModels(s.provider)[0];
  if (!model) throw new Error(`no model for ${s.provider}`);
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: 'never', compaction: { enabled: true }, retry: { enabled: s.retry, maxRetries: 2 } } as any);
  // Nothing is discovered: no extensions, context files, prompts or themes from anywhere, and only the bot's own skills.
  const resourceLoader = new DefaultResourceLoader({
    cwd: s.space, agentDir: engineDir, settingsManager, noExtensions: true, noContextFiles: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalSkillPaths: [s.skills], systemPrompt: s.system,
    extensionFactories: [(pi) => { pi.on('tool_call', (e) => s.gate(e.toolName, e.input as Record<string, any>)); }],
  });
  // Pi still scans the usual places (~/.agents/skills and friends) before the flags above drop what it found; its
  // discovery is switched off outright so none of the owner's folders are even looked at.
  // ponytail: reaches into the loader's package manager; the isolation test fails if a Pi bump moves it.
  const nothing = { extensions: [], skills: [], prompts: [], themes: [] };
  (resourceLoader as any).packageManager = { resolve: async () => nothing, resolveExtensionSources: async () => nothing };
  await resourceLoader.reload();
  const tools = [...s.builtins, ...s.tools.map((t) => t.name)];
  const { session } = await createAgentSession({
    cwd: s.space, agentDir: engineDir, modelRuntime: s.runtime, model, resourceLoader, settingsManager, tools, customTools: s.tools,
    sessionManager: s.file ? SessionManager.open(s.file, s.sessionsDir, s.space) : SessionManager.create(s.space, s.sessionsDir),
  });
  return session;
}

// ---- the shell: bubblewrap, where the bot's space is the only writable part of the disk ----
let sandboxOk: boolean | undefined;
/** Whether bubblewrap works here (it is missing on macOS, and some distros forbid the namespaces it needs). */
export function sandboxReady() {
  sandboxOk ??= (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', 'true'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } })();
  return sandboxOk;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell tool, sandboxed: /usr and /etc read-only, /home empty but for the space, network on. No command ever asks.
 *  ponytail: assumes a merged /usr (all current distros); a sandboxed shell can still send data out over the network. */
export function sandboxBash(space: string, readOnly: string[], env: Record<string, string>) {
  return createBashTool(space, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command }) => ({
      cwd: space,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      command: ['exec bwrap --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib --symlink usr/lib64 /lib64',
        '--ro-bind /etc /etc --ro-bind-try /run/systemd/resolve /run/systemd/resolve --proc /proc --dev /dev --tmpfs /tmp --tmpfs /home',
        ...readOnly.map((d) => `--ro-bind-try ${q(d)} ${q(d)}`), `--bind ${q(space)} ${q(space)}`,
        '--clearenv', ...Object.entries({ ...env, HOME: space, LANG: 'C.UTF-8', TERM: 'dumb', PATH: `${env.PATH ? env.PATH + ':' : ''}/usr/local/bin:/usr/bin` })
          .map(([k, v]) => `--setenv ${k} ${q(v)}`),
        `--chdir ${q(space)} --unshare-all --share-net --die-with-parent -- bash -c ${q(command)}`].join(' '),
    }),
  });
}

// ---- the web, without a key ----
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: {} });
const plain = (html: string) => html.replace(/<(script|style|noscript)[^]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export const webTools = () => [
  defineTool({
    name: 'web_fetch', label: 'Read a web page', description: 'Fetch a web page and return its text.',
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, p, signal) {
      const res = await fetch(p.url, { signal: signal ?? AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' } });
      const body = await res.text();
      return text(`${res.status} ${p.url}\n${(/html/.test(res.headers.get('content-type') ?? '') ? plain(body) : body).slice(0, 20_000)}`);
    },
  }),
  // ponytail: DuckDuckGo's plain HTML results page, no key; swap for a search API if it starts refusing.
  defineTool({
    name: 'web_search', label: 'Search the web', description: 'Search the web; returns titles, links and snippets.',
    parameters: Type.Object({ query: Type.String() }),
    async execute(_id, p, signal) {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(p.query)}`, { signal: signal ?? AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' } });
      const html = await res.text();
      const hits = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([^]*?)<\/a>[^]*?class="result__snippet"[^>]*>([^]*?)<\/a>/g)].slice(0, 8)
        .map(([, href, title, snip]) => { const u = /uddg=([^&]+)/.exec(href)?.[1]; return `${plain(title)} — ${u ? decodeURIComponent(u) : href}\n  ${plain(snip)}`; });
      return text(hits.join('\n') || 'No results.');
    },
  }),
];

// ---- command-line tools that need the person's own sign-in: fixed argv on this computer, outside the sandbox ----
export function cliTool(name: string, bin: string, about: string, cwd: string, env: Record<string, string>) {
  return defineTool({
    name, label: about, description: `${about}. Pass the command's arguments as a list, without the program name.`,
    parameters: Type.Object({ args: Type.Array(Type.String()) }),
    execute: (_id, p, signal) => new Promise<ReturnType<typeof text>>((resolve) => {
      execFile(bin, p.args, { cwd, env: { ...process.env, ...env, NO_COLOR: '1' }, timeout: 120_000, maxBuffer: 8 << 20, signal }, (err, out, errOut) =>
        resolve(text(`${out}${errOut}${err && !out ? `\n(exit: ${err.message})` : ''}`.slice(0, 30_000))));
    }),
  });
}

// ---- MCP servers (the browser), bridged into engine tools: a few lines of JSON-RPC over stdio ----
export class Mcp {
  private proc: ChildProcess;
  private next = 1;
  private pending = new Map<number, (m: any) => void>();

  constructor(command: string, args: string[], env: Record<string, string>) {
    this.proc = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.on('error', () => {});
    createInterface({ input: this.proc.stdout! }).on('line', (l) => {
      let m: any;
      try { m = JSON.parse(l); } catch { return; }
      this.pending.get(m.id)?.(m);
      this.pending.delete(m.id);
    });
    this.proc.on('exit', () => { for (const r of this.pending.values()) r({ error: { message: 'the tool stopped' } }); this.pending.clear(); });
  }

  request(method: string, params: object): Promise<any> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** Its tools as engine tools; `seen` hears each result's text (the browser says which page it is on). */
  async tools(seen: (text: string) => void): Promise<ToolDefinition[]> {
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'crewhouse', version: '1' } });
    this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await this.request('tools/list', {});
    return tools.map((t: any) => defineTool({
      name: t.name, label: t.title ?? t.name, description: t.description ?? t.name, parameters: Type.Unsafe(t.inputSchema ?? { type: 'object' }),
      execute: async (_id, args) => {
        const r = await this.request('tools/call', { name: t.name, arguments: args });
        const content = (r.content ?? []).filter((c: any) => c.type === 'text' || c.type === 'image')
          .map((c: any) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', data: c.data, mimeType: c.mimeType }));
        seen(content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n'));
        return { content, details: {} };
      },
    }) as ToolDefinition);
  }

  stop() { this.proc.kill(); }
}
