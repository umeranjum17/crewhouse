// Crewhouse's Pi is its own copy: nothing from the owner's Pi or shell may reach it. Imported before the engine, because
// Pi reads some of these at import time (PI_PACKAGE_DIR points at the owner's own install when crewd starts from inside pi).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';

/** Inherited settings for Pi, and provider keys that would let a bot run on someone's account without signing in here. */
export const INHERITED = /^(PI_|AI_AGENT$|ANTHROPIC_|AWS_|AZURE_|GOOGLE_|GCLOUD_|CLOUDFLARE_)|_API_KEY$|^(COPILOT_GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN|HF_TOKEN)$/;

for (const k of Object.keys(process.env)) if (INHERITED.test(k)) delete process.env[k];
/** The engine's own folder (Pi's "agent dir"), never ~/.pi. Every session is also given it explicitly. */
export const engineDir = join(loadConfig().stateDir, 'engine');
mkdirSync(engineDir, { recursive: true });
Object.assign(process.env, { PI_CODING_AGENT_DIR: engineDir, PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
