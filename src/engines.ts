// The one place the engine is chosen from config; every other file talks to the AgentRuntime it returns.
import type { Config } from './config.ts'; import type { AgentRuntime } from './runtime.ts';
import { StubRuntime } from './stub-runtime.ts';
import { OpenClawRuntime } from './openclaw/runtime.ts';

export const pickRuntime = (cfg: Config): AgentRuntime => cfg.engine === 'stub' ? new StubRuntime() : new OpenClawRuntime(cfg.stateDir, cfg.crewDir);
