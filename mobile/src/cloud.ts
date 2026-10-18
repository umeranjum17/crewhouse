// The cloud connect's phone side (mock key-first): the boat.dev key and this phone's own key pair for Chief's computer
// live in this phone's secure store, readable only while it is unlocked and never moved to another device. The kit
// calls are web/src/cloud.ts, shared with test/cloud-connect.test.ts.
import { nativeStore } from '@byokit/secrets/native';
import { b64url, keyPair, keyPairFrom, unb64url } from '@byokit/pair';
import * as SecureStore from 'expo-secure-store';
import { BOAT, provider } from '../../web/src/cloud.ts';

/** Off in a release build until @byokit/cloud is on npm: a build made with EXPO_PUBLIC_CREWHOUSE_CLOUD=1 shows the
 *  cloud row on the first screen. */
export const cloudOn = process.env.EXPO_PUBLIC_CREWHOUSE_CLOUD === '1';

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

/** This phone's public key for Chief's computer, made once; the secret half never leaves this phone. */
export async function phoneKey(): Promise<Uint8Array> {
  const kept = await keys.get('phone');
  if (kept) return keyPairFrom(unb64url(kept)).publicKey;
  const k = keyPair();
  await keys.set('phone', b64url(k.secretKey));
  return k.publicKey;
}
