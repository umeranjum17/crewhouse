// The Pi engine behind CREWHOUSE_ENGINE=pi, the one file that reaches @byokit/pi (a dev-only reference until it publishes: node scripts/prepare-pi.mjs, so its name stays a variable). Each bot gets the kit's own process, home, session and extension list, and that process runs behind bubblewrap (bin/sandbox.mjs) or not at all. Nothing Pi runs passes Crew.gate yet, so settings.json leaves it none of Pi's own tools, but for the ones CREWHOUSE_PI_TOOLS names in a proof, and extensions.json holds only code that reaches nothing past its session, or past the bot's own notes file (notes.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { piRefusal, piWall, wallDown } from '../../bin/sandbox.mjs';
import { botConfig } from '../bots.ts'; import type { Config } from '../config.ts'; import type { AccountRow, AgentRuntime, RunEnd, RunEvent, RunSpec, SignInStep } from '../runtime.ts';

type PiEvent = RunEvent | { type: 'end'; end: { ok: true; text: string } | { ok: false; aborted: true } | { ok: false; message: string } } | { type: 'stopped'; reason: string; detail?: string };
type Bot = { on(hear: (event: PiEvent) => void): () => void; prompt(text: string): Promise<void>; steer(text: string): Promise<void>; abort(): Promise<void>; stop(): Promise<void> }; type Launch = { command: string; args: readonly string[] }; type Kit = { bot(spec: { id: string; folder: string; session: string; extensions: string[]; env: Record<string, string>; launch: (pi: Launch) => Launch }): Bot; close(): Promise<void> };
/** The kit's own name; the one account a custom provider stands in for (Crew's constructor marks it ready); the variable the key travels in, so it never lands on disk. */
const KIT = '@byokit/pi', ACCOUNT = 'chatgpt', KEY = 'CREWHOUSE_MODEL_KEY', MODEL = () => process.env.CREWHOUSE_ENGINE_MODEL || 'test', talk = (tools: string[]) => `\n\nHere you have ${tools.length ? `only these tools: ${tools.join(', ')}` : 'no tools at all'}, crew tools included, whatever this prompt names. Otherwise answer in plain words.\n`;

export class PiRuntime implements AgentRuntime {
  readonly identity = { name: 'Pi', version: '1.5.0' }; // the kit refuses any other Pi
  private cfg: Config; private kit?: Promise<Kit>; private failed?: { words: string; detail: string };
  private open = new Map<string, { bot: Bot; session: string; system: string }>(); private runs = new Map<string, Bot>(); onEngine?: () => void;
  constructor(cfg: Config) { this.cfg = cfg; }

  private load(): Promise<Kit> { return this.kit ??= import(KIT).then((kit) => kit.createPiKit({ stateDir: this.cfg.stateDir, idleMs: Number(process.env.CREWHOUSE_PI_IDLE_MS) || undefined })); } // once, by whichever comes first: a job recovered at boot can reach run() before crewd reaches start()
  async start() {
    delete this.failed;
    try { const down = wallDown(); if (down) throw new Error(down); await this.load(); }
    catch (e) { delete this.kit; this.failed = { words: wallDown() || 'Pi is not set up on this computer. Run node scripts/prepare-pi.mjs, then try again.', detail: (e as Error).message }; throw e; }
    finally { this.onEngine?.(); }
  }
  async stop() { await this.kit?.then((kit) => kit.close(), () => {}); }
  engine() { return this.failed ? { phase: 'failed', ...this.failed } : { phase: 'ready', words: '' }; }

  async accounts(): Promise<AccountRow[]> { return this.cfg.engineProvider ? [{ id: ACCOUNT, provider: ACCOUNT, state: 'ready' }] : []; }
  async signedIn(account: string) { return account === ACCOUNT && !!this.cfg.engineProvider; }
  async models(account: string) { return await this.signedIn(account) ? [{ id: MODEL(), name: MODEL(), dflt: true }] : []; }
  signIn(_account: string, _via: 'browser' | 'code' | 'key', on: (step: SignInStep) => void) {
    on({ waiting: false, error: 'Pi has no sign-in yet. Start Crewhouse with CREWHOUSE_ENGINE_BASE_URL and CREWHOUSE_ENGINE_API_KEY.' });
    return { paste() {}, cancel() {} };
  }
  async signOut() {} async learned() { return []; } async forget() {}

  /** The extensions this bot loads: extensions.json in its own folder, or the default without one. A bot may rewrite its folder, so the file only names, and anything but a reviewed name stops the job with these words. The person's memory switch outranks the list. */
  private extensions({ bot, cwd }: RunSpec) {
    const file = join(cwd, 'extensions.json'), set = JSON.parse(readFileSync(join(this.cfg.repoDir, 'src', 'pi', 'extensions.json'), 'utf8')) as { reviewed: Record<string, string>; default: string[] }, list: unknown = (() => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : set.default; } catch { return null; } })(), named = Array.isArray(list) && list.every((name) => Object.hasOwn(set.reviewed, name)) ? [...new Set<string>(list)].filter((name) => name !== 'notes' || botConfig(this.cfg, bot).memory !== false) : undefined;
    return named ? { named, paths: named.map((name) => join(this.cfg.repoDir, set.reviewed[name]!)) } : `This job did not start: extensions.json in this bot's folder may only list ${Object.keys(set.reviewed).join(', ')}.`;
  }
  /** The bot's Pi on this session, system prompt and extension list: a running one is kept only while all still hold, as Pi reads them at start (the prompt names the list, so one check covers both). */
  private async botFor(spec: RunSpec, { named, paths }: { named: string[]; paths: string[] }) {
    const session = spec.key.replace(/[^A-Za-z0-9._-]+/g, '-'), was = this.open.get(spec.bot), provider = this.cfg.engineProvider, system = spec.system + talk(named); // the prompt names tools Pi leaves out, and a model told of a tool writes its call into the reply
    if (was?.session === session && was.system === system) return was.bot;
    if (!provider) throw new Error('Pi is not ready: its model provider is missing.');
    const kit = await this.load();
    await was?.bot.stop();
    const home = join(this.cfg.stateDir, 'pi', spec.bot), folder = join(home, 'work'); // the kit's Pi home: the person's own Pi is never used
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(join(home, 'SYSTEM.md'), system);
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ defaultTools: process.env.CREWHOUSE_PI_TOOLS?.split(',') ?? [] }));
    writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { crewhouse: { baseUrl: provider.baseUrl, api: 'openai-completions', apiKey: `$${KEY}`, models: [{ id: MODEL() }] } } }));
    const repo = this.cfg.repoDir, extensions = [...paths, piRefusal(repo)], bot = kit.bot({ id: spec.bot, folder, session, extensions, env: { [KEY]: provider.apiKey }, launch: ({ command, args }) => ({ command: 'bwrap', args: [...piWall({ folder, home, repo, extensions }), command, ...args] }) });
    this.open.set(spec.bot, { bot, session, system });
    return bot;
  }

  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    const list = wallDown() || this.extensions(spec);
    if (typeof list === 'string') return { ok: false, kind: 'handoff', message: list };
    const bot = await this.botFor(spec, list); let said = '';
    this.runs.set(spec.key, bot);
    try {
      return await new Promise<RunEnd>((resolve, reject) => {
        const settle = (end: RunEnd) => { off(); resolve(end); }, off = bot.on((e) => {
          if (e.type === 'text') on({ type: 'text', text: said += e.text }); // the app shows the reply so far, the kit hands over each piece
          else if (e.type === 'end') settle(e.end.ok || 'aborted' in e.end ? e.end : { ok: false, kind: 'other', message: e.end.message });
          else if (e.type === 'stopped') { if (e.reason !== 'idle') settle({ ok: false, kind: 'other', message: e.detail ?? 'Pi stopped before it answered.' }); } // gone before the run began: no end follows; an idle stop is the last Pi leaving, and this run waits for the next
          else on(e);
        });
        bot.prompt(spec.message).catch((e) => { off(); reject(e); });
      });
    } finally { this.runs.delete(spec.key); }
  }
  async steer(key: string, text: string) { await this.runs.get(key)?.steer(text); }
  async abort(key: string) { await this.runs.get(key)?.abort(); }
}
