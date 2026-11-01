// Speaking to Chief: the browser's own recognizer turns speech into words for the message box. It listens on this
// device when it can; where it has no on-device recognizer (Android Chrome in a PWA, for one), its online recognizer
// does instead, and the app says so before it listens (the words are `VOICE_WORDS` in adapter.ts). Nothing is sent
// by speaking: the words go nowhere until the person taps send.
// Where the browser can record, the box's mic records instead and this computer's Hex writes it down (`record` below),
// so the audio goes to the computer the person paired with and to no cloud service.
import { transcribe } from './api.ts';

const Heard = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
const lang = () => navigator.language || 'en-US';
const want = (local: boolean) => ({ langs: [lang()], processLocally: local });

/** `device`: this browser's own recognizer, on this device; `online`: its online one (its service hears the audio);
 *  `none`: neither can hear here. */
export type Ears = 'device' | 'online' | 'none';

/** Whether the browser can recognize speech this way, perhaps after fetching its voice pack once. An error from the
 *  check (the browser doesn't know this option) counts as no. A recognizer with no check at all (Safari, so every
 *  iPad and iPhone browser) can't say where it hears, so it counts as the online one. */
async function offers(local: boolean): Promise<boolean> {
  if (Heard && !Heard.available) return !local;
  try { return !!Heard && (await Heard.available(want(local))) !== 'unavailable'; } catch { return false; }
}

/** The recognizer this browser should listen with: on this device first, else the online one, else none. */
export async function ears(): Promise<Ears> {
  return (await offers(true)) ? 'device' : (await offers(false)) ? 'online' : 'none';
}

/** Listens until the person pauses (or `stop()`), then gives what was heard ('' for nothing) with `route`'s recognizer;
 *  `heard` gets the words so far while they speak. It fails `blocked` when the microphone isn't allowed, `nomic` when
 *  none can be opened, `offline` when the online recognizer can't be reached, `unready` when the voice pack can't be
 *  fetched or there is no recognizer at all. */
export function hear(route: Ears, heard?: (words: string) => void): { words: Promise<string>; stop: () => void } {
  let r: any = null, stopped = false;
  const words = (async () => {
    if (route === 'none') throw new Error('unready');
    if (route === 'device' && (await Heard.available(want(true))) !== 'available' && !(await Heard.install(want(true)).catch(() => false))) throw new Error('unready');
    if (stopped) return '';
    r = new Heard();
    Object.assign(r, { lang: lang(), processLocally: route === 'device', interimResults: !!heard, continuous: false });
    return new Promise<string>((done, fail) => {
      let said = '';
      r.onresult = (e: any) => { said = [...e.results].map((x: any) => x[0].transcript).join(' ').trim(); heard?.(said); };
      r.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail(new Error('blocked')); else if (e.error === 'audio-capture') fail(new Error('nomic')); else if (e.error === 'network') fail(new Error('offline')); };
      r.onend = () => done(said);
      r.start();
    });
  })();
  return { words, stop: () => { stopped = true; r?.stop(); } };
}

/** Whether this browser can record at all: a microphone, and a way to keep what it hears. Where it can't, the browser's
 *  own recognizer still hears (`hear`). */
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

/** Listens by recording, then has this computer's Hex write the clip down (`transcribe`): the audio goes to the computer
 *  the person paired with, and a tap on the mic ends the recording. Fails the same ways `hear` does, and in Hex's own
 *  plain words when it can't write the clip down. */
export function record(): { words: Promise<string>; stop: () => void } {
  const off: (() => void)[] = [];
  let stopped = false;
  const words = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    off.push(() => stream.getTracks().forEach((t) => t.stop()));
    const Ctx = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext, ctx = new Ctx(), chunks: Float32Array[] = [];
    const tap = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain();
    mute.gain.value = 0; // the tap only listens: the microphone is never played back
    tap.onaudioprocess = (e: any) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);
    await new Promise<void>((ended) => { const end = () => { tap.onaudioprocess = null; void ctx.close(); ended(); }; if (stopped) end(); else off.push(end); });
    off.forEach((f) => f());
    const clip = wav(chunks, ctx.sampleRate);
    return clip.length > 44 ? (await transcribe(base64(clip))).text : '';
  })().catch((e: any) => {
    if (/^(NotAllowed|Security)Error$/.test(e?.name ?? '')) throw new Error('blocked');
    if (e instanceof DOMException) throw new Error('nomic');
    throw e; // the computer's own words, or the link's
  });
  return { words, stop: () => { stopped = true; off.forEach((f) => f()); } };
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
