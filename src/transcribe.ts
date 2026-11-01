// Hex (anomalyco/hex, MIT) transcribes speech on this computer, with no cloud service in it: the `hex` the person
// installed, its `service --embedded` helper driven by its published client `@kitlangton/hex`. A clip goes over the
// helper's pipe, the words come back, and this module keeps neither. BYOKit's `@byokit/dictation` should own this
// adapter as a `hex` engine later; crewd only ever calls `transcribe`.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as Hex from '@kitlangton/hex';

const run = promisify(execFile);
const INSTALL = 'Speaking here needs Hex on this computer first. In a terminal, run: curl -fsSL https://anoma.ly/hex/files/install-linux.sh | sh';
const NO_MODEL = 'Hex has no speech model on this computer yet. In a terminal, run: ~/.local/bin/hex model install';

/** Where Hex is: `CREWHOUSE_HEX` when it is set, else the install this app's own installer makes, else a system one. */
const binary = () => process.env.CREWHOUSE_HEX ?? [join(homedir(), '.local/bin/hex'), '/usr/bin/hex'].find((p) => existsSync(p));

/** The first of Hex's own models this computer has installed and verified, by `hex model status` (the truth the CLI
 *  keeps; the client's catalog call expects a newer engine). */
async function model(bin: string): Promise<Hex.ModelId | null> {
  for (const id of Hex.MODEL_IDS) if (await run(bin, ['model', 'status', id], { timeout: 20_000 }).then((r) => r.stdout.startsWith('installed\tverified'), () => false)) return id;
  return null;
}

let ready: Promise<Hex.Transcriber> | null = null, queue: Promise<unknown> = Promise.resolve();

/** The person's words from one clip, made here. One clip at a time (Hex admits one inference), the model kept loaded
 *  between clips, and a failure drops the helper so the next try starts a fresh one. */
export function transcribe(wav: Uint8Array): Promise<string> {
  const go = async () => {
    try {
      ready ??= (async () => {
        const bin = binary();
        if (!bin || !existsSync(bin)) throw new Error(INSTALL);
        const id = await model(bin);
        if (!id) throw new Error(NO_MODEL);
        return Hex.create({ command: [bin, 'service', '--embedded'], model: id, language: 'en', startupTimeoutMs: 60_000 });
      })();
      const helper = await ready, { transcript } = await helper.transcribe(wav, { signal: AbortSignal.timeout(120_000) });
      return transcript.trim();
    } catch (e: any) {
      console.error('hex:', e?.message ?? e); // crewd's own log keeps the cause; the person reads plain words
      if (ready) void ready.then((h) => h.close(), () => {}).catch(() => {});
      ready = null;
      throw new Error(/^Speaking here needs Hex|^Hex has no speech model/.test(e?.message ?? '') ? e.message : 'Hex couldn’t make that clip out. Try the mic again, or type instead.');
    }
  };
  const next = queue.then(go, go);
  queue = next.catch(() => {});
  return next;
}

