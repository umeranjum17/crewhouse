// The one code box: what a typed code is. The computer shows @byokit/pair's 12-letter code, found on the phone's own
// Wi-Fi; a relay code carries its relay inside itself — SHORT-CODE@relay — so the person types one thing and nothing
// else.
import { normalizeCode } from '@byokit/pair';

export type Typed =
  | { kind: 'code'; code: string }
  | { kind: 'relay'; short: string; code: string; base: string }
  | { kind: 'unknown'; words: string };

const CODES = 18; // the relay's short code (6) then link's pairing code (12)
export const MISSING = 'That code is missing a part. Copy the whole code from your computer, then try again.';
export const TYPO = 'That code has a typo. Check the 12 letters on your computer and try again.';
export const NO_COMPUTER = 'Your phone could not find your computer on this Wi-Fi. Scan the QR on your computer instead.';
/** The web app's version: its page can dial only its own address, so the Wi-Fi is no help here. */
export const NO_HERE = "This page can't reach your computer. On your computer open Settings, Phones, then Add a phone, and scan its code with this phone's camera.";
export const NO_LINK = 'Your phone could not reach your computer at that link. Turn Tailscale on, on this phone and on the computer, then try again.';
export const OLD_LINK = 'That link is not from your computer any more. Run ./crewhouse link there for the current one.';
export const NO_RELAY = "Could not reach your computer's relay. Check it is on and try again.";

// A dotted host with an optional port: the only bare host readTyped takes back as https://host (the rest keep their scheme).
const HOST = /^([a-z0-9-]+\.)+[a-z0-9-]+(:\d+)?$/i;

/** A relay code as a person types it: bare host when readTyped rebuilds it, else with its scheme (https for wss). */
export function relayTyped(short: string, code: string, relay: string) {
  const { protocol, host } = new URL(relay);
  const secure = protocol === 'https:' || protocol === 'wss:';
  return `${short}-${code}@${secure && HOST.test(host) ? host : `${secure ? 'https:' : protocol}//${host}`}`;
}

/** A scanned or pasted pairing link to the computer's own web app, when this page is not that app: the address to open instead. */
export const appLink = (text: string, here = location.origin) => { try { const u = new URL(text.trim()); return /^https?:$/.test(u.protocol) && u.origin !== here && u.hash.includes('byokit-link:') ? u.href : ''; } catch { return ''; } };

/** A pairing link, as tapped, scanned or pasted: the page link `./crewhouse link` prints (the phone asks it for a ticket),
 *  the app link its button opens (`crewhouse://pair?code=`, the ticket inside), or a bare ticket. Anything else is null. */
export type Joined = { kind: 'page'; url: string } | { kind: 'offer'; text: string };
export function readLink(text: string): Joined | null {
  const t = text.trim(), app = /crewhouse:\/\/pair\?code=([^\s&]+)/.exec(t), page = /https?:\/\/[^\s/]+\/pair\/[\w-]+/.exec(t);
  try { if (app) return { kind: 'offer', text: decodeURIComponent(app[1]) }; } catch { return null; }
  return page ? { kind: 'page', url: page[0] } : /BYOKIT-LINK:|byokit-link:/i.test(t) ? { kind: 'offer', text: t } : null;
}

export function readTyped(text: string): Typed {
  const at = text.indexOf('@');
  if (at < 0) {
    const code = normalizeCode(text);
    if (code) return { kind: 'code', code };
    // Up to the 12 letters of a code, it is a mistyped code; longer, a relay code cut off before its host.
    return { kind: 'unknown', words: text.toUpperCase().replace(/[\s-]/g, '').length <= 16 ? TYPO : MISSING };
  }
  const codes = text.slice(0, at).toUpperCase().replace(/[\s-]/g, '');
  const base = text.slice(at + 1).trim();
  if (codes.length !== CODES) return { kind: 'unknown', words: MISSING };
  const address = /^[a-z]+:\/\//i.test(base) || HOST.test(base);
  if (!address) return { kind: 'unknown', words: MISSING };
  return { kind: 'relay', short: codes.slice(0, 6), code: codes.slice(6), base: /^[a-z]+:\/\//i.test(base) ? base : `https://${base}` };
}
