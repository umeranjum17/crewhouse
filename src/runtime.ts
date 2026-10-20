// Crewhouse's contract with its replaceable agent process. No engine protocol crosses this file.
export interface ToolSpec { name: string; description: string; parameters: object }
export type GateResult = { allow: true } | { allow: false; reason: string; park?: boolean };
export interface RunRef { key: string; bot: string; task: number }
export interface ToolHost {
  tools(run: RunRef): ToolSpec[];
  gate(run: RunRef, tool: string, input: Record<string, unknown>): Promise<GateResult>;
  call(run: RunRef, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<string>;
  delegate?(parent: RunRef, bot: string, key: string): Promise<RunRef>;
  event?(run: RunRef, event: RunEvent): void;
  end?(run: RunRef, end: RunEnd): void;
}
export interface RunSpec extends RunRef {
  cwd: string; system: string; message: string; account: string; model?: string;
  images?: { data: string; mimeType: string }[];
  thinking?: 'low'; builtins: string[];
  team?: { bot: string; system: string; tools: string[] }[];
}
export type RunEvent =
  | { type: 'started' | 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; phase: 'start' | 'end' }
  | { type: 'usage'; tokens: number }
  | { type: 'delegated'; id: string; parent: string; root: string };
export type RunEnd = { ok: true; text: string } | { ok: false; aborted: true } |
  { ok: false; kind: 'signed-out' | 'resting' | 'plan' | 'network' | 'other' | 'output' | 'handoff'; until?: number; message: string }; // handoff messages are Crewhouse-authored, never raw engine diagnostics
export type SignInStep = { url?: string; code?: string; waiting: boolean; done?: boolean; notIncluded?: boolean; error?: string; cliLogin?: { signIn: boolean }; workspaces?: { id: string; name: string }[] };
export interface AgentRuntime {
  start(host: ToolHost): Promise<unknown>;
  stop(): Promise<void>;
  signInRecovery?(): string;
  engine?(): { phase: string; words: string }; onEngine?: () => void;
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
