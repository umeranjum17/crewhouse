// The QR's one-use ticket in a typeable envelope. The checksum catches typing errors; Noise pins the host key.
import { b64url, unb64url } from '@byokit/link';

export type TypedOffer = { v: 1; host: string; name: string; urls: string[]; ticket: string; expires: number; role: 'control' | 'view' };
const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ0';
const bad = () => new Error("That code didn't match. Check it and try again.");
const checksum = (b: Uint8Array) => { let h = 2166136261; for (const x of b) h = Math.imul(h ^ x, 16777619) >>> 0; return h >>> 0; };

export function encodeTyped(o: TypedOffer): string {
  const urls = o.urls.filter((u) => /^ws:\/\//.test(u)); // relay URLs aren't needed for direct pairing
  if (!urls.length || urls.length > 8) throw new Error('No direct phone address is available');
  const bytes = [1, o.role === 'control' ? 1 : 0, ...unb64url(o.host), ...unb64url(o.ticket)];
  const expiry = Math.floor(o.expires / 1000);
  for (const n of [expiry >>> 24, expiry >>> 16, expiry >>> 8, expiry]) bytes.push(n & 255);
  bytes.push(urls.length);
  for (const u of urls) {
    const match = /^ws:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\/link$/.exec(u);
    const ip = match?.[1].split('.').map(Number);
    const port = Number(match?.[2]);
    if (ip?.length === 4 && ip.every((n) => n >= 0 && n < 256) && port > 0 && port < 65536) {
      bytes.push(0, ...ip, port >>> 8, port & 255);
    } else {
      const text = new TextEncoder().encode(u);
      if (text.length > 255) throw new Error('Phone address is too long');
      bytes.push(text.length, ...text);
    }
  }
  const hash = checksum(Uint8Array.from(bytes));
  bytes.push(hash >>> 24, hash >>> 16 & 255, hash >>> 8 & 255, hash & 255);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8 | b) & 0xffff; bits += 8; while (bits >= 5) { bits -= 5; out += ABC[(value >>> bits) & 31]; } }
  if (bits) out += ABC[(value << (5 - bits)) & 31];
  return out.match(/.{1,5}/g)!.join('-');
}

export function decodeTyped(text: string, now = Date.now()): TypedOffer {
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
