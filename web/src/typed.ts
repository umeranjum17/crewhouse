// The one code box: what a typed code is. A direct code is the long letter envelope (@byokit/link); a relay
// code carries its relay inside itself — SHORT-CODE@relay — so the person types one thing and nothing else.
export type Typed =
  | { kind: 'direct'; text: string }
  | { kind: 'relay'; short: string; code: string; base: string }
  | { kind: 'unknown' };

const CODES = 18; // the relay's short code (6) then link's pairing code (12)

// A dotted host with an optional port: the only bare host readTyped takes back as https://host (the rest keep their scheme).
const HOST = /^([a-z0-9-]+\.)+[a-z0-9-]+(:\d+)?$/i;

/** A relay code as a person types it: bare host when readTyped rebuilds it, else with its scheme (https for wss). */
export function relayTyped(short: string, code: string, relay: string) {
  const { protocol, host } = new URL(relay);
  const secure = protocol === 'https:' || protocol === 'wss:';
  return `${short}-${code}@${secure && HOST.test(host) ? host : `${secure ? 'https:' : protocol}//${host}`}`;
}

export function readTyped(text: string): Typed {
  const at = text.indexOf('@');
  if (at < 0) {
    const flat = text.toUpperCase().replace(/[\s-]/g, '');
    // The envelope is 95+ letters; anything shorter names no relay, so there is nowhere to dial.
    return flat.length >= 40 ? { kind: 'direct', text } : { kind: 'unknown' };
  }
  const codes = text.slice(0, at).toUpperCase().replace(/[\s-]/g, '');
  const base = text.slice(at + 1).trim();
  if (codes.length !== CODES) return { kind: 'unknown' };
  const address = /^[a-z]+:\/\//i.test(base) || HOST.test(base);
  if (!address) return { kind: 'unknown' };
  return { kind: 'relay', short: codes.slice(0, 6), code: codes.slice(6), base: /^[a-z]+:\/\//i.test(base) ? base : `https://${base}` };
}
