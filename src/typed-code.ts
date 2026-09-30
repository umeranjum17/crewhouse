// The QR's one-use ticket in a typeable envelope. The checksum catches typing errors; Noise pins the host key.
import { b64url, decodeOffer, encodeOffer } from '@byokit/link';

export type TypedOffer = { v: 1; host: string; name: string; urls: string[]; ticket: string; expires: number; role: 'control' | 'view' };
const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ0';
const bad = () => new Error("That code didn't match. Check it and try again.");
const checksum = (b: Uint8Array) => { let h = 2166136261; for (const x of b) h = Math.imul(h ^ x, 16777619) >>> 0; return h >>> 0; };

export const encodeTyped = encodeOffer;
// Pre-kit compact envelopes remain readable; new offers use the kit's complete envelope.
export function decodeTyped(text: string, now = Date.now()) {
  try { return decodeOffer(text, now); } catch (error) {
    if (!text.toUpperCase().replace(/[\s-]/g, '').startsWith('26')) throw error;
    return decodeLegacy(text, now);
  }
}
function decodeLegacy(text: string, now: number): TypedOffer {
  const s = text.toUpperCase().replace(/[\s-]/g, '');
  if (!s || [...s].some((c) => !ABC.includes(c)) || s.length > 2048) throw bad();
  const b: number[] = []; let bits = 0, value = 0;
  for (const c of s) { value = (value << 5 | ABC.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { bits -= 8; b.push((value >>> bits) & 255); } }
  if (bits && (value & ((1 << bits) - 1))) throw bad();
  if (b.length < 59 || b[0] !== 1 || b[1] > 1) throw bad();
  const body = Uint8Array.from(b.slice(0, -4));
  if (checksum(body) !== ((b.at(-4)! << 24 | b.at(-3)! << 16 | b.at(-2)! << 8 | b.at(-1)!) >>> 0)) throw bad();
  const expires = ((b[50] * 0x1000000 + (b[51] << 16) + (b[52] << 8) + b[53]) >>> 0) * 1000;
  if (expires < now) throw new Error('That code has run out. Show a new one.');
  const count = b[54]; let at = 55; const urls: string[] = [];
  if (!count || count > 8) throw bad();
  for (let i = 0; i < count; i++) {
    const n = b[at++];
    if (n === undefined) throw bad();
    let url: string;
    if (n === 0) {
      if (at + 6 > b.length - 4) throw bad();
      url = `ws://${b.slice(at, at + 4).join('.')}:${b[at + 4] * 256 + b[at + 5]}/link`;
      at += 6;
    } else {
      if (at + n > b.length - 4) throw bad();
      url = new TextDecoder().decode(Uint8Array.from(b.slice(at, at += n)));
    }
    try { const p = new URL(url); if (p.protocol !== 'ws:' || p.username || p.password || !p.hostname) throw bad(); } catch { throw bad(); }
    urls.push(url);
  }
  if (at !== b.length - 4) throw bad();
  return { v: 1, host: b64url(Uint8Array.from(b.slice(2, 34))), ticket: b64url(Uint8Array.from(b.slice(34, 50))), expires,
    name: 'your computer', role: b[1] ? 'control' : 'view', urls };
}
