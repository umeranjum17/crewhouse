// The phone's end of the link: its key pair and grant in secure storage, one socket to crewd that
// reconnects forever, and requests that survive a reconnect (same idempotency key, so a retried tap runs once).
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { b64, fingerprint, keyPair, keyPairFrom, openLink, parseOffer, unb64, type KeyPair } from '../../src/envelope.ts';

export type Grant = { sk: string; crewdPk: string; fp: string; urls: string[]; device: { id: string; name: string; role: 'control' | 'view' } };
export type Status = 'connecting' | 'online' | 'offline' | 'refused' | 'removed';
const STORE = 'crewhouse.grant';

export async function loadGrant(): Promise<Grant | null> {
  const s = await SecureStore.getItemAsync(STORE);
  return s ? JSON.parse(s) : null;
}
export const forgetGrant = () => SecureStore.deleteItemAsync(STORE);
const me = (g: Grant): KeyPair => keyPairFrom(unb64(g.sk));

/** Scan result in, durable grant out. Tries each address in the QR until one answers. */
export async function pair(qrText: string): Promise<Grant> {
  const offer = parseOffer(qrText);
  const mine = keyPair();
  const crewdPk = unb64(offer.k);
  const name = (Device.deviceName || Device.modelName || 'Phone').slice(0, 40);
  let last = new Error('the code has no addresses');
  for (const url of offer.u) {
    try {
      const l = await openLink(url, mine, crewdPk, { t: 'pair', code: offer.c, name }, { message: () => {}, close: () => {} });
      l.close();
      const g: Grant = { sk: b64(mine.secretKey), crewdPk: offer.k, fp: fingerprint(crewdPk), urls: [url, ...offer.u.filter((u) => u !== url)], device: l.ready.device };
      await SecureStore.setItemAsync(STORE, JSON.stringify(g));
      return g;
    } catch (e: any) {
      last = e;
      if (/expired|removed/.test(e.message)) break; // the code is spent; other addresses won't help
    }
  }
  throw last;
}

type Pending = { msg: any; resolve: (v: any) => void; reject: (e: Error) => void };

export class PhoneLink {
  grant: Grant;
  status: Status = 'connecting';
  url = '';
  private conn: { send: (m: unknown) => void; close: () => void } | null = null;
  private pending = new Map<number, Pending>();
  private n = 0;
  private stopped = false;
  private onEvent: (e: any) => void;
  private onStatus: (s: Status) => void;

  constructor(grant: Grant, onEvent: (e: any) => void, onStatus: (s: Status) => void) {
    this.grant = grant;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.connect();
  }

  private set(s: Status) { this.status = s; this.onStatus(s); }

  private async connect() {
    if (this.stopped) return;
    this.set(this.status === 'online' ? 'offline' : this.status);
    for (const url of this.grant.urls) {
      try {
        const l = await openLink(url, me(this.grant), unb64(this.grant.crewdPk), { t: 'auth' }, {
          message: (m) => {
            if (m.t === 'revoked') return this.removed(); // sealed by crewd, so it is really crewd saying it
            if (m.t === 'event') return this.onEvent(m.e);
            const p = m.t === 'res' && this.pending.get(m.id);
            if (!p) return;
            this.pending.delete(m.id);
            m.status === 200 ? p.resolve(m.body) : p.reject(new Error(m.body?.error ?? `error ${m.status}`));
          },
          close: () => { this.conn = null; if (this.status === 'removed') return; this.set('offline'); setTimeout(() => this.connect(), 1500); },
        });
        if (this.stopped) return l.close();
        this.conn = l;
        this.url = url;
        this.grant.urls = [url, ...this.grant.urls.filter((u) => u !== url)]; // try the one that worked first next time
        this.set('online');
        this.onEvent({ kind: 'connected' });
        for (const p of this.pending.values()) l.send(p.msg); // resend with the same key: crewd runs each once
        return;
      } catch (e: any) {
        // crewd answered but won't take this phone. That answer is not authenticated, so keep the grant
        // and let the person decide (pair again, or retry) rather than forget it on a stranger's word.
        if (/not paired|removed|verify/.test(e.message)) { this.stopped = true; return this.set('refused'); }
      }
    }
    this.set('offline');
    setTimeout(() => this.connect(), 3000);
  }

  private removed() {
    this.stopped = true;
    for (const p of this.pending.values()) p.reject(new Error('this phone was removed'));
    this.pending.clear();
    forgetGrant();
    this.set('removed');
  }

  /** The Transport for web/src/api.ts. Resolves only when crewd has answered. */
  call = (method: string, path: string, body?: unknown) => new Promise<any>((resolve, reject) => {
    const id = ++this.n;
    const key = method === 'GET' ? undefined : `${Date.now().toString(36)}-${id}-${Math.random().toString(36).slice(2)}`;
    const msg = { t: 'req', id, method, path, body, key };
    this.pending.set(id, { msg, resolve, reject });
    this.conn?.send(msg);
  });

  retry() { this.stopped = false; this.set('connecting'); this.connect(); }

  stop() { this.stopped = true; this.conn?.close(); }
}
