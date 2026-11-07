// Setup only, never a test: fetch and hash-check the pinned NATS server into <dir> and print CREWHOUSE_NATS_BIN=<path>, so the bus tests then run offline on the real binary.
// CI: node scripts/prepare-nats.mjs "$RUNNER_TEMP/nats" >> "$GITHUB_ENV"
import { ensureNats } from '../src/nats.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/prepare-nats.mjs <dir>');
console.log(`CREWHOUSE_NATS_BIN=${await ensureNats(dir)}`);
