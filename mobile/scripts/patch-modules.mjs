// Two small fixes to native modules, applied after install; each is idempotent. Drop one once its module ships the fix.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function patch(rel, done, edit) {
  const file = new URL(`../node_modules/${rel}`, import.meta.url);
  if (!existsSync(file)) return;
  const s = readFileSync(file, 'utf8');
  if (s.includes(done)) return;
  const out = edit(s);
  if (out === s) throw new Error(`patch-modules: ${rel} changed upstream; check the patch still applies`);
  writeFileSync(file, out);
}

// ponytail: @desklink/react-native 0.1.0 builds its Android module with the plain Kotlin plugin, and on Expo SDK 57 its
// module definition then crashes at launch ("This function has a reified type parameter…"). Expo modules build with
// expo-module-gradle-plugin, which fixes it.
patch('@desklink/react-native/android/build.gradle', 'expo-module-gradle-plugin', (s) => s
  .replace("apply plugin: 'com.android.library'\napply plugin: 'kotlin-android'\n", "plugins {\n  id 'com.android.library'\n  id 'expo-module-gradle-plugin'\n}\n")
  .replace("  kotlinOptions { jvmTarget = '17' }\n", '')
  .replace('  defaultConfig {\n', "  defaultConfig {\n    versionCode 1\n    versionName '0.1.0'\n"));

// ponytail: the share-intent module reads a shared file's name and size without checking it may: a share with no read
// grant (or an empty result) crashed the whole app. Guarded, the share is dropped and the app hears an error it words.
patch('expo-share-intent/android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt', 'crewhouse: unreadable share', (s) => s
  .replace('            } else {\n                // files / medias\n', '            } else try {\n                // files / medias\n')
  .replace('                    notifyError("Invalid action for file sharing: " + intent.action)\n                }\n            }\n',
    '                    notifyError("Invalid action for file sharing: " + intent.action)\n                }\n            } catch (e: Exception) {\n                notifyError("crewhouse: unreadable share")\n            }\n'));
