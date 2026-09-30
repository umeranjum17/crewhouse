// Install through the kit without starting a Gateway. A supplied state directory is disposable (CI/packaging).
import { loadConfig } from '../src/config.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { hostKeySeal } from '@byokit/secrets';
import { randomBytes } from 'node:crypto';

const { stateDir, crewDir } = loadConfig();
// Packaging's disposable state has no sign-ins; its throwaway key never enters the shipped engine.
await new OpenClawRuntime(process.argv[2] ?? stateDir, crewDir, process.argv[2]
  ? { authSeal: hostKeySeal({ key: randomBytes(32), service: 'crewhouse-build' }) } : {}).kit.prepare();
