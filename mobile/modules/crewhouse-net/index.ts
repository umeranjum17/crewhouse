// Migration debt (G06): reach has no nativeAddresses() API. This phone's own IPv4 addresses (Android; elsewhere none, so the offline words stay general).
import { Dictation, DictateError, systemEngine, type DictationHandle } from '@byokit/dictation';
import { requireOptionalNativeModule } from 'expo';

const net = requireOptionalNativeModule<{ addresses(): Promise<string[]> }>('CrewhouseNet');
export const addresses = (): Promise<string[]> => net?.addresses().catch(() => []) ?? Promise.resolve([]);

// Speaking to Chief through @byokit/dictation, on this phone's own recognizer (Android 12+ with it installed; elsewhere
// no mic is shown): CrewhouseVoice is the system engine the kit asks its app to inject, on the phone only.
// Migration debt: the kit ships no Android binding yet, so CrewhouseVoiceModule.kt stays until it does.
const voice = requireOptionalNativeModule<{ canHear(): Promise<boolean>; hear(): Promise<string>; stop(): Promise<void> }>('CrewhouseVoice');
let can = false, ended = () => {}, stopAsked = false;
const dictation = new Dictation({ engine: systemEngine({
  available: async () => (can ? 'ready' : 'unsupported'), // what canHear() last found, just before each listen
  // One listen: the recognizer ends on the person's pause (or stop) with what it heard.
  start: (_o, on) => {
    const end = ended; // this listen's own
    const heard = (voice?.hear() ?? Promise.resolve('')).then((text) => { if (text) on({ id: '0', text, final: true }); },
      (e) => { throw new DictateError(/blocked/.test(`${e?.code} ${e?.message}`) ? 'mic-blocked' : 'needs-download', { cause: e }); });
    void heard.catch(() => {}).finally(end);
    const stop = async () => { await voice?.stop().catch(() => {}); await heard; };
    return { stop, cancel: () => void stop().catch(() => {}) };
  },
}) });
let now: DictationHandle | null = null;
export const canHear = async () => (can = !!(await voice?.canHear().catch(() => false)));
/** What was heard ('' for nothing), once the person pauses or stops; fails `mic-blocked` without the microphone,
 *  `needs-download` without the voice pack. A second listen first finishes the one before (its words still land). */
export async function hear(): Promise<string> {
  stopAsked = false;
  await now?.finish().catch(() => {});
  if (!(await canHear()) || stopAsked) return '';
  const h = now = dictation.listen({ onDeviceOnly: true });
  const done = new Promise<void>((r) => { ended = r; }); // set before the kit calls start, a microtask later
  try { await done; return (await h.finish()).text; } finally { if (now === h) now = null; }
}
export const stopHearing = () => { stopAsked = true; ended(); void now?.finish().catch(() => {}); };

// One still of this phone's screen after its own consent dialog (Android; elsewhere none): its file:// address, or ''.
const screen = requireOptionalNativeModule<{ frame(): Promise<string> }>('CrewhouseScreen');
export const screenFrame = (): Promise<string> => screen?.frame() ?? Promise.resolve('');
