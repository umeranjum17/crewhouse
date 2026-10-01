// Install through the kit without starting a Gateway. A supplied state directory is disposable (CI/packaging).
import { loadConfig } from '../src/config.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { hostKeyFileSeal } from '@byokit/secrets';

const { stateDir, crewDir } = loadConfig();
// Packaging's disposable state has no sign-ins; the kit's private key stays outside the shipped engine.
await new OpenClawRuntime(process.argv[2] ?? stateDir, crewDir, process.argv[2]
  ? { authSeal: hostKeyFileSeal({ stateDir: process.argv[2], service: 'crewhouse-build' }) } : {}).kit.prepare();
