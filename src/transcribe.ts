// Hex (anomalyco/hex, MIT) writes speech down on this computer, with no cloud service in it: the `hex` the person
// installed, its `service --embedded` helper driven by its published client `@kitlangton/hex`. A clip goes over the
// helper's pipe, the words come back, and this module keeps neither. BYOKit's `@byokit/dictation` should own this
// adapter as a `hex` engine later; crewd only ever calls `transcribe`.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import * as Hex from '@kitlangton/hex';

const MODEL = 'parakeet_unified_en', run = promisify(execFile), plain = (words: string) => Object.assign(new Error(words), { plain: true });
const INSTALL = process.platform === 'darwin' ? 'brew install --cask anomalyco/tap/hex' : 'curl -fsSL https://anoma.ly/hex/install-linux.sh | sh';

/** Hex and its speech model, or the one thing the person has to do. The model is never fetched from here: it is 700 MB,
 *  so it comes by the person's own command. `hex model status` is the truth; the client's catalog call expects a newer Hex. */
async function start() {
  const bin = process.env.CREWHOUSE_HEX ?? [join(homedir(), '.local/bin'), ...(process.env.PATH ?? '').split(delimiter)].map((d) => join(d, 'hex')).find((p) => existsSync(p));
  if (!bin || !existsSync(bin)) throw plain(`Speaking needs Hex on your computer first. On that computer, run: ${INSTALL}`);
  const { stdout } = await run(bin, ['model', 'status', MODEL], { timeout: 20_000 }).catch(() => ({ stdout: '' }));
  if (!stdout.startsWith('installed\tverified')) throw plain(`Speaking needs Hex's speech model on your computer first. On that computer, run: ${bin} model install ${MODEL}`);
  const helper = await Hex.create({ command: [bin, 'service', '--embedded'], model: MODEL, language: 'en', startupTimeoutMs: 60_000 });
  pid = helper.pid;
  return helper;
}

let ready: Promise<Hex.Transcriber> | null = null, queue: Promise<unknown> = Promise.resolve(), pid = 0;
// A helper whose parent has gone stops serving but stays, holding the model (Hex 3.1.1), so crewd takes it down with it.
process.once('exit', () => { if (pid) process.kill(pid, 'SIGKILL'); });

/** The person's words from one clip, made here. One clip at a time (Hex admits one inference), the model kept loaded
 *  between clips, and a failure drops the helper so the next try starts a fresh one. */
export function transcribe(wav: Uint8Array): Promise<string> {
  const go = async () => {
    try {
      return (await (await (ready ??= start())).transcribe(wav, { signal: AbortSignal.timeout(120_000) })).transcript.trim();
    } catch (e: any) {
      console.error('hex:', e?.message ?? e); // crewd's own log keeps the cause; the person reads plain words
      void ready?.then((h) => h.close()).catch(() => {});
      ready = null; pid = 0;
      throw e?.plain ? e : new Error('Hex couldn’t make that clip out. Try the mic again, or type instead.');
    }
  };
  return (queue = queue.then(go, go));
}
