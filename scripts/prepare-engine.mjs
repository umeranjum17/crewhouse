// Install through the kit without starting a Gateway. A supplied state directory is disposable (CI/packaging).
import { loadConfig } from '../src/config.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';

const { stateDir, crewDir } = loadConfig();
await new OpenClawRuntime(process.argv[2] ?? stateDir, crewDir).kit.prepare();
