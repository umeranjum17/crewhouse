// Speaking to Chief: the browser records, the clip goes to the computer the person paired with, and the Hex installed
// there writes it down (`record` below). No recognizer of the browser's or a cloud service's hears anything. Nothing is
// sent by speaking: the words go nowhere until the person taps send.
import { transcribe } from './api.ts';

const lang = () => navigator.language || 'en-US';

/** Whether this browser can record at all: a microphone, and a way to keep what it hears. Where it can't, there is no
 *  mic to offer. */
export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && !!((globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext);

/** A 16-bit mono PCM WAV of what the microphone captured, at its own rate (Hex resamples). */
function wav(chunks: Float32Array[], rate: number): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.length, 0), bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, n * 2, true);
  let at = 44;
  for (const c of chunks) for (const f of c) { v.setInt16(at, Math.max(-1, Math.min(1, f)) * 0x7fff, true); at += 2; }
  return bytes;
}

const base64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** What one clip may hold, so a long note always fits crewd's request limit: 4.5M samples, about 90 s at 48 kHz. */
const MOST = 4_500_000;

/** What a call counts as speech and as the person having finished: a chunk louder than `LOUD` is speech, `PAUSE` seconds
 *  of quiet after speech ends it, and `WAIT` seconds without any speech ends it with nothing. */
const LOUD = 0.02, PAUSE = 1.2, WAIT = 8;

/** Listens by recording, then has this computer's Hex write the clip down (`transcribe`): the audio goes to the computer
 *  the person paired with. A tap on the mic ends the recording, or the clip filling up; with `call`, the person's pause
 *  ends it instead (`ended` tells the call, which then waits for the words), and a take with no speech gives '' without
 *  asking Hex. Fails `blocked` when the microphone isn't allowed, `nomic` when none can be opened, `far` when the
 *  computer can't be reached, and with crewd's own plain words (a `status`) when Hex can't write it down. */
export function record(call?: { ended: () => void }): { words: Promise<string>; stop: () => void } {
  let stop = () => {}, ctx: any, spoke = false, quiet = 0;
  const stopped = new Promise<void>((done) => { stop = done; }), chunks: Float32Array[] = [];
  const words = (async () => {
    ctx = new ((globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext)(); // on the tap itself: Safari starts audio only from one
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tap = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain();
    mute.gain.value = 0; // the tap only listens: the microphone is never played back
    tap.onaudioprocess = (e: any) => {
      const c = new Float32Array(e.inputBuffer.getChannelData(0)), s = c.length / ctx.sampleRate;
      chunks.push(c);
      if (call) { // the pause that ends a call's turn
        if (Math.sqrt(c.reduce((a, x) => a + x * x, 0) / c.length) > LOUD) { spoke = true; quiet = 0; } else quiet += s;
        if (quiet >= (spoke ? PAUSE : WAIT)) stop();
      }
      if (chunks.length * 4096 >= MOST) stop();
    };
    ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);
    void ctx.resume();
    await stopped;
    tap.onaudioprocess = null;
    stream.getTracks().forEach((t) => t.stop());
    call?.ended();
    const clip = wav(chunks, ctx.sampleRate);
    return clip.length > 44 && (!call || spoke) ? (await transcribe(base64(clip))).text : '';
  })().catch((e: any) => {
    if (/^(NotAllowed|Security)Error$/.test(e?.name ?? '')) throw new Error('blocked');
    if (e instanceof DOMException) throw new Error('nomic');
    throw e?.status ? e : new Error('far');
  }).finally(() => void ctx?.close());
  return { words, stop };
}

// Reading Chief's replies aloud: only this device's own voices (never an online one), a sentence at a time, so a call
// can show the one being read and Stop cuts in between.
const synth: SpeechSynthesis | undefined = globalThis.speechSynthesis;

/** This device's own voices in the person's language, its default first, once the browser has listed them (none
 *  where it has no voice of its own). */
export async function voices(): Promise<SpeechSynthesisVoice[]> {
  if (synth && !synth.getVoices().length) await new Promise((r) => { synth.addEventListener('voiceschanged', r, { once: true }); setTimeout(r, 1000); });
  const own = synth?.getVoices().filter((v) => v.localService) ?? [], l = (x: string) => x.split(/[-_]/)[0].toLowerCase();
  const mine = own.filter((v) => l(v.lang) === l(lang()));
  return (mine.length ? mine : own).sort((a, b) => Number(!!b.default) - Number(!!a.default));
}

/** Reads `text` aloud, each sentence with `how()`'s voice and speed at its start (a change lands on the next one), and
 *  tells `reading` the sentence as it starts. `done` settles once all is read or `stop()` cuts it short. */
export function speak(text: string, how: () => { voice?: SpeechSynthesisVoice; rate: number }, reading: (s: string) => void) {
  let stopped = false;
  const done = (async () => {
    for (const s of text.match(/[^.!?\n]+[.!?]*/g) ?? []) {
      if (stopped) return;
      if (!s.trim()) continue;
      reading(s.trim());
      const h = how();
      await new Promise<void>((r) => { // Chromium on Linux may only say a sentence ended once another is queued: a deadline
        const late = setTimeout(() => { synth?.cancel(); r(); }, 2000 + (s.length * 100) / h.rate);
        synth?.speak(Object.assign(new SpeechSynthesisUtterance(s), { ...h, onend: () => { clearTimeout(late); r(); }, onerror: () => { clearTimeout(late); r(); } }));
      });
    }
  })();
  return { done, stop: () => { stopped = true; synth?.cancel(); } };
}
