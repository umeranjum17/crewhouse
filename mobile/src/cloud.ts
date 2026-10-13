// The cloud set-up's phone side (mocks provider and signin-key, Main2691): the pasted boat.dev key is checked once by
// BYOKit's cloud kit, then kept in this phone's own secure store the way BYOKit's cloud-setup example keeps it
// (examples/expo/cloud-setup.ts, #535): readable only while the phone is unlocked, never moved to another device.
import { nativeStore } from '@byokit/secrets/native';
import * as SecureStore from 'expo-secure-store';

/** Off in a release build until @byokit/cloud is on npm: a build made with EXPO_PUBLIC_CREWHOUSE_CLOUD=1 shows the
 *  cloud row on the first screen. */
export const cloudOn = process.env.EXPO_PUBLIC_CREWHOUSE_CLOUD === '1';

/** Where the kit's `setupKey` keeps the checked key (its MachineStore): `{ providerKey, ref }`, as in the example,
 *  through BYOKit's own phone store. */
const keys = nativeStore({ prefix: 'crewhouse.cloud', options: { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } });
export const cloudStore = {
  load: async () => JSON.parse((await keys.get('record')) ?? 'null'),
  save: (record: object) => keys.set('record', JSON.stringify(record)),
};

/** Connect: `setupKey({ provider: boat(…key), store: cloudStore, key })` reads the account once, then saves the key.
 *  That call is @byokit/cloud's, which is not published yet, so nothing is checked or saved: the person is told so. */
export async function connectCloud(_key: string): Promise<never> {
  throw new Error('missing');
}
