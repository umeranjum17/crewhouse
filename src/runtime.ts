// Crewhouse's contract with its replaceable agent process. No engine protocol crosses this file.
export interface ToolSpec { name: string; description: string; parameters: object }
export type GateResult = { allow: true } | { allow: false; reason: string; park?: boolean };
export interface RunRef { key: string; bot: string; task: number }
export interface ToolHost {
  tools(run: RunRef): ToolSpec[];
  gate(run: RunRef, tool: string, input: Record<string, unknown>): Promise<GateResult>;
  call(run: RunRef, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<string>;
}
export interface RunSpec extends RunRef {
  cwd: string; system: string; message: string; account: string;
  model?: string;
  images?: { data: string; mimeType: string }[];
  thinking?: 'low'; builtins: string[];
}
export type RunEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; phase: 'start' | 'end'; ok?: boolean; ms?: number }
  | { type: 'usage'; tokens: number }
  | { type: 'learned'; skill: string; id: string };
export type RunEnd = { ok: true; text: string } | { ok: false; aborted: true } |
  { ok: false; kind: 'signed-out' | 'resting' | 'plan' | 'network' | 'other' | 'output'; until?: number; message: string };
export type SignInStep = { url?: string; code?: string; waiting: boolean; done?: boolean; error?: string };
export interface AgentRuntime {
  start(host: ToolHost): Promise<unknown>;
  stop(): Promise<void>;
  signInRecovery?(): string;
  signedIn(account: string): Promise<boolean>;
  signIn(account: string, via: 'browser' | 'code', on: (step: SignInStep) => void): { paste(text: string): void; cancel(): void; done?: Promise<unknown> };
  signOut(account: string): Promise<void>;
  run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd>;
  steer(key: string, text: string): Promise<void>;
  abort(key: string): Promise<void>;
  trail(key: string): Promise<{ tool: string; input: string; output: string; at: number }[]>;
  learned(): Promise<{ id: string; skill: string; at: number; state: string }[]>;
  forget(id: string, skill?: string): Promise<void>;
  /** The "Learn from how I work" switch: the engine's learning mode, auto or off. Optional: the stub may ignore it. */
  setLearning?(on: boolean): Promise<void>;
  learning?(): Promise<boolean> | boolean;
  /** Whether this engine has only keyword memory search available. */
  memoryLimited?(): boolean;
  /** Point the engine at a custom OpenAI-compatible model provider. Optional: only the real engine offers it. */
  configureModelProvider?(baseUrl: string, apiKey: string): Promise<void>;
}
