// Install through the kit without starting a Gateway. A supplied state directory is disposable (CI/packaging).
import { loadConfig } from '../src/config.ts';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { hostKeyFileSeal } from '@byokit/secrets';
import { why } from '../bin/why.mjs';

const { stateDir, crewDir } = loadConfig();
const started = Date.now();
// A failure says its cause and one next line, never the kit's stack trace.
try {
  await new OpenClawRuntime(process.argv[2] ?? stateDir, crewDir, process.argv[2]
    ? { authSeal: hostKeyFileSeal({ stateDir: process.argv[2], service: 'crewhouse-build' }) } : {}).kit.prepare();
} catch (e) {
  const { cause, raw, next } = why(`${e.name}: ${e.message}`);
  console.error(`The AI engine could not be installed: ${cause}.${next ? `\nNext: ${next}` : `\nIt said: ${raw}`}`);
  process.exit(1);
}
const s = Math.floor((Date.now() - started) / 1000);
console.log(`AI engine ready (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}).`);
