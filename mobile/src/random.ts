// libsodium's JavaScript build looks for crypto.getRandomValues when it loads; React Native doesn't
// have one, Expo does.
import { getRandomValues } from 'expo-crypto';

const g = globalThis as any;
g.self ??= g;
if (!g.crypto?.getRandomValues) g.crypto = { ...g.crypto, getRandomValues };
