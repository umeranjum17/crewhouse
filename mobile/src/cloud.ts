// The cloud connect's phone side (mock key-first): the boat.dev key and this phone's own key pair for Chief's computer
// live in this phone's secure store, readable only while it is unlocked and never moved to another device. The kit
// calls are web/src/cloud.ts, shared with test/cloud-connect.test.ts.
import { nativeStore } from '@byokit/secrets/native';
import { b64url, keyPair, keyPairFrom, unb64url, type KeyPair } from '@byokit/pair';
import * as SecureStore from 'expo-secure-store';
import { BOAT, provider, signIn, type SignIn } from '../../web/src/cloud.ts';

/** Cloud first in releases; an explicit 0 is the deployment opt-out. */
export const cloudOn = process.env.EXPO_PUBLIC_CREWHOUSE_CLOUD !== '0';

/** The kit's MachineStore: `{ providerKey, ref }`, through BYOKit's own phone store. */
const keys = nativeStore({ prefix: 'crewhouse.cloud', options: { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } });
export const cloudStore = {
  load: async () => JSON.parse((await keys.get('record')) ?? 'null'),
  save: (record: object) => keys.set('record', JSON.stringify(record)),
};
export const keptKey = async (): Promise<string> => (await cloudStore.load())?.providerKey ?? '';
/** Forget: the key leaves this phone; revoking it at boat.dev is the person's. */
export const forgetKey = () => keys.delete('record');

/** boat.dev on this key; a lab build names its fixture boat.dev in EXPO_PUBLIC_CREWHOUSE_BOAT_API. */
export const boatOn = (key: string) => provider(async () => key, process.env.EXPO_PUBLIC_CREWHOUSE_BOAT_API || BOAT.api);

/** A lab build's own download and run settings for the computer (web/src/cloud.ts `recipe`); none in a release build. */
export const lab = { download: process.env.EXPO_PUBLIC_CREWHOUSE_CLOUD_DOWNLOAD, env: JSON.parse(process.env.EXPO_PUBLIC_CREWHOUSE_CLOUD_ENV || '{}') };

/** This phone's key pair for Chief's computer, made once; the secret half never leaves this phone. */
export async function phoneKeys(): Promise<KeyPair> {
  const kept = await keys.get('phone');
  if (kept) return keyPairFrom(unb64url(kept));
  const k = keyPair();
  await keys.set('phone', b64url(k.secretKey));
  return k;
}

/** The code sign-in lives here, not in the screen, so a person who leaves the Cloud screen and comes back finds it where they
 *  left it: the same code, still waiting, or the failure that ended it. Only the state is kept, never the key (it is in the store). */
type Run = { email: string; state: SignIn; stop: AbortController };
let run: Run | null = null;
const watchers = new Set<() => void>();
const tell = () => watchers.forEach((w) => w());
export const signInRun = () => run;
export const watchSignIn = (w: () => void) => { watchers.add(w); return () => void watchers.delete(w); };
export function startSignIn(email: string) {
  run?.stop.abort();
  const mine: Run = run = { email, state: { at: 'starting' }, stop: new AbortController() };
  void (async () => {
    try { for await (const s of signIn(email, cloudStore, { api: process.env.EXPO_PUBLIC_CREWHOUSE_BOAT_API || BOAT.api, signal: mine.stop.signal })) { if (run === mine) { mine.state = s; tell(); } } }
    catch { if (run === mine) { mine.state = { at: 'failed', why: 'provider' }; tell(); } }
  })();
  tell();
}
/** Drop the sign-in: the person chose another email, or it finished and the screen took the computers. */
export const endSignIn = () => { run?.stop.abort(); run = null; tell(); };
