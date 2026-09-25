// Crewhouse's Pi is its own copy: nothing from the owner's Pi or shell may reach it. Imported before the engine, because
// Pi reads some of these at import time (PI_PACKAGE_DIR points at the owner's own install when crewd starts from inside pi).
import { join } from 'node:path';
import { isolate } from '@byokit/accounts/isolate';
import { loadConfig } from './config.ts';

/** The engine's own folder (Pi's "agent dir"), never ~/.pi. Every session is also given it explicitly. */
export const engineDir = isolate(join(loadConfig().stateDir, 'engine'));
