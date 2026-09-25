// The phone link's crypto, shared as-is by crewd and the Expo app. No crypto of our own here:
// the handshake is Noise IK (Noise_IK_25519_ChaChaPoly_BLAKE2b) from noise-handshake, and the
// primitives are libsodium (sodium-native in Node, sodium-javascript in the app).
//
// IK fits pairing: the phone learns crewd's static key from the QR, and sends its own static key
// encrypted in the first message. After the two handshake messages, each direction has its own
// Noise CipherState, whose nonce counter refuses any replayed, dropped or reordered frame.
import b4a from 'b4a';
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';
import dh from 'noise-handshake/dh.js';
import sodium from 'sodium-universal';

export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

const PROLOGUE = b4a.from('crewhouse-link-v1');
const CHUNK = 60_000; // a Noise message is at most 65535 bytes; larger payloads go in pieces

export const b64 = (u: Uint8Array): string => b4a.toString(u, 'base64');
export const unb64 = (s: string): Uint8Array => b4a.from(s, 'base64');

export const keyPair = (): KeyPair => dh.generateKeyPair();
export const keyPairFrom = (secretKey: Uint8Array): KeyPair => dh.generateKeyPair(b4a.from(secretKey));

/** What people compare on both screens: 8 bytes of BLAKE2b of crewd's public key. */
export function fingerprint(pk: Uint8Array): string {
  const h = b4a.alloc(16);
  sodium.crypto_generichash(h, b4a.from(pk));
  return b4a.toString(h.subarray(0, 8), 'hex').match(/.{4}/g)!.join(' ');
}

/** One socket's two Noise CipherStates. Frames are base64 text, so every WebSocket carries them. */
export class Channel {
  private tx: any;
  private rx: any;
  private parts: string[] = [];
  constructor(hs: any) {
    this.tx = new Cipher(hs.tx);
    this.rx = new Cipher(hs.rx);
  }

  /** One or more frames; send them in order. */
  seal(msg: unknown): string[] {
    const body = b4a.from(JSON.stringify(msg));
    const out: string[] = [];
    for (let at = 0; at === 0 || at < body.length; at += CHUNK) {
      const piece = body.subarray(at, at + CHUNK);
      const more = at + CHUNK < body.length ? 1 : 0;
      out.push(b64(this.tx.encrypt(b4a.concat([b4a.from([more]), piece]))));
    }
    return out;
  }

  /** The whole message once its last frame arrives, else undefined. Throws on any bad frame. */
  open(frame: string): any {
    const plain = this.rx.decrypt(unb64(frame)); // throws unless it is the next authentic frame
    this.parts.push(b4a.toString(plain.subarray(1)));
    if (plain[0] === 1) return undefined;
    const text = this.parts.join('');
    this.parts = [];
    return JSON.parse(text);
  }
}

/** crewd's side of the handshake: first message in, reply out, plus who the phone is. */
export function respond(keys: KeyPair, first: string) {
  const hs = new Noise('IK', false, { publicKey: b4a.from(keys.publicKey), secretKey: b4a.from(keys.secretKey) });
  hs.initialise(PROLOGUE);
  const hello = JSON.parse(b4a.toString(hs.recv(unb64(first)))); // throws unless the phone used our key
  const reply = b64(hs.send());
  return { reply, phone: new Uint8Array(hs.rs) as Uint8Array, hello, channel: new Channel(hs) };
}

/** The QR's content. `u` lists the socket URLs to try in order. */
export type PairOffer = { crewhouse: 1; k: string; c: string; u: string[] };
export function parseOffer(text: string): PairOffer {
  const o = JSON.parse(text);
  if (o?.crewhouse !== 1 || typeof o.k !== 'string' || typeof o.c !== 'string' || !Array.isArray(o.u)) throw new Error('not a Crewhouse pairing code');
  if (unb64(o.k).length !== 32) throw new Error('bad key in pairing code');
  return o;
}

/** The phone's side of one socket: the Noise handshake, then the first sealed frame (`auth`, or
 *  `pair` with the QR's code). Resolves when crewd answers `ready`; uses the platform's WebSocket. */
export function openLink(url: string, me: KeyPair, crewdPk: Uint8Array, first: { t: 'auth' } | { t: 'pair'; code: string; name: string },
  on: { message: (m: any) => void; close: (why: string) => void }, timeoutMs = 6000) {
  return new Promise<{ ready: any; send: (m: unknown) => void; close: () => void }>((resolve, reject) => {
    const ws = new WebSocket(url);
    const hs = new Noise('IK', true, { publicKey: b4a.from(me.publicKey), secretKey: b4a.from(me.secretKey) });
    hs.initialise(PROLOGUE, b4a.from(crewdPk));
    let ch: Channel | null = null;
    let up = false;
    const fail = (why: string) => { clearTimeout(timer); if (up) on.close(why); else reject(new Error(why)); up = false; };
    const timer = setTimeout(() => { fail(`no answer from ${url}`); ws.close(); }, timeoutMs);
    const send = (m: unknown) => ch!.seal(m).forEach((f) => ws.send(f));
    ws.onopen = () => ws.send(b64(hs.send(b4a.from(JSON.stringify({ v: 1, pair: first.t === 'pair' })))));
    ws.onerror = () => fail(`can't reach ${url}`);
    ws.onclose = (e: any) => fail(e.reason || 'connection closed');
    ws.onmessage = (ev: any) => {
      try {
        if (!ch) {
          hs.recv(unb64(String(ev.data))); // throws unless the answer came from the key in the QR
          ch = new Channel(hs);
          return send(first);
        }
        const m = ch.open(String(ev.data));
        if (m === undefined) return;
        if (!up && m.t === 'ready') {
          up = true;
          clearTimeout(timer);
          return resolve({ ready: m, send, close: () => ws.close() });
        }
        on.message(m);
      } catch (e: any) {
        fail(e.message);
        ws.close();
      }
    };
  });
}
