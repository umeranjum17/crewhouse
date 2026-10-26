// Crewhouse's contract with its replaceable agent process. No engine protocol crosses this file.
export interface ToolSpec { name: string; description: string; parameters: object }
export type GateResult = { allow: true } | { allow: false; reason: string; park?: boolean };
export interface RunRef { key: string; bot: string; task: number }
export interface ToolHost {
  tools(run: RunRef): ToolSpec[];
  gate(run: RunRef, tool: string, input: Record<string, unknown>): Promise<GateResult>;
  call(run: RunRef, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<string>;
  delegate?(parent: RunRef, bot: string, key: string, brief: string): Promise<RunRef>;
  event?(run: RunRef, event: RunEvent): void;
  end?(run: RunRef, end: RunEnd): void;
}
/** One of the person's AI accounts as the runtime keeps it: the engine's own id, the account's provider and the name it goes by.
 *  `state` is the engine's answer; 'unknown' means the probe gave no answer (ask again), never a sign-out. */
export type AccountRow = { id: string; provider: string; label?: string; email?: string; plan?: string; state: 'ready' | 'signing' | 'resting' | 'signed_out' | 'needs_again' | 'not_included' | 'unknown'; until?: number };
/** The account key the person reads and edits: the provider alone ("chatgpt", the first account of it), or the provider and
 *  the account's own name ("claude.work"), so two accounts of one provider are two keys. */
export const accountRef = (provider: string, label?: string) => `${provider}${label ? `.${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}` : ''}`;
export const refParts = (ref: string) => { const i = String(ref).indexOf('.'); return i < 0 ? [String(ref), ''] as const : [String(ref).slice(0, i), String(ref).slice(i + 1)] as const; };
export interface RunSpec extends RunRef {
  cwd: string; system: string; message: string; account: string; model?: string; // account: an accountRef, resolved by the runtime to the engine's own account

  images?: { data: string; mimeType: string }[];
  thinking?: 'low'; builtins: string[];
  team?: { bot: string; system: string; tools: string[] }[];
}
export type RunEvent =
  | { type: 'started' | 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; phase: 'start' | 'end'; error?: boolean }
  | { type: 'usage'; tokens: number }
  | { type: 'delegated'; id: string; parent: string; root: string };
export type RunEnd = { ok: true; text: string } | { ok: false; aborted: true } |
  { ok: false; kind: 'signed-out' | 'resting' | 'plan' | 'network' | 'other' | 'output' | 'handoff'; until?: number; message: string }; // handoff messages are Crewhouse-authored, never raw engine diagnostics
export type SignInStep = { url?: string; code?: string; waiting: boolean; done?: boolean; notIncluded?: boolean; error?: string; cliLogin?: { signIn: boolean }; workspaces?: { id: string; name: string }[] };
export interface StarterSkill { slug: string; name: string; owner: string; version: string; maturity: string; summary: string; why: string; needs: string[]; on: boolean }
export interface AgentRuntime {
  readonly identity: { name: string; version: string };
  start(host: ToolHost): Promise<unknown>;
  stop(): Promise<void>;
  signInRecovery?(): string;
  engine?(): { phase: string; words: string; detail?: string }; onEngine?: () => void;
  /** Every account the person has (two of one provider included), by engine id; the shim keys them by accountRef. */
  accounts(): Promise<AccountRow[]>;
  signedIn(account: string): Promise<boolean>;
  signIn(account: string, via: 'browser' | 'code' | 'key', on: (step: SignInStep) => void): { paste(text: string): Promise<unknown> | void; pick?(id: string): Promise<unknown> | void; cancel(): void; done?: Promise<unknown> };
  signOut(account: string): Promise<void>;
  /** The live catalog of one signed-in account: the models the person can pick from, ids without the provider. */
  models(account: string): Promise<{ id: string; name: string }[]>;
  run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd>;
  steer(key: string, text: string): Promise<void>;
  abort(key: string): Promise<void>;
  learned(): Promise<{ id: string; skill: string; at: number; state: string }[]>;
  forget(id: string, skill?: string): Promise<void>;
  /** The "Learn from how I work" switch: the engine's learning mode, auto or off. Optional: the stub may ignore it. */
  setLearning?(on: boolean): Promise<void>;
  /** Learned-skills safety (a capture that cannot be verified throws; a restore is byte for byte), the engine's native skills, and the legacy sign-in staging. */
  captureLearned?(dir?: string, why?: string): string; restoreLearned?(name: string, hash?: string, dir?: string): string;
  starterSkills?(): StarterSkill[]; setStarter?(slug: string, on: boolean): Promise<unknown>; searchSkills?(query: string): Promise<unknown[]>;
  runCollectionReview?(): Promise<{ capture: string; kept: string[]; written: string[]; dropped: string[] }>;
  migrate?(path: string): Promise<boolean>; confirm?(path: string): Promise<boolean>;
  /** Hands on the bot's own screen through the engine's `computer` tool; resolves to the node name its calls must use. */
  computer?(bot: string, screen: { DISPLAY: string; XAUTHORITY: string }): Promise<string>;
  /** Whether this engine has only keyword memory search available. */
  memoryLimited?(): boolean;
  /** Point the engine at a custom OpenAI-compatible model provider. Optional: only the real engine offers it. */
  configureModelProvider?(baseUrl: string, apiKey: string): Promise<void>;
  /** Composio's hosted tools: the browser URL to open, the wait for its callback, and the native sign-out. Optional: only the real engine offers them. */
  composioBegin?(): Promise<{ url: string }>;
  composioDone?(): Promise<void>;
  composioSignOut?(): Promise<void>;
}
