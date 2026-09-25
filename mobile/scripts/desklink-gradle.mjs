// ponytail: @desklink/react-native 0.1.0 builds its Android module with the plain Kotlin plugin, and on Expo SDK 57 its
// module definition then crashes at launch ("This function has a reified type parameter…"). Expo modules build with
// expo-module-gradle-plugin, which fixes it. Run after install; drop it once desklink ships the plugin itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../node_modules/@desklink/react-native/android/build.gradle', import.meta.url);
if (existsSync(file)) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes('expo-module-gradle-plugin')) {
    writeFileSync(file, s
      .replace("apply plugin: 'com.android.library'\napply plugin: 'kotlin-android'\n", "plugins {\n  id 'com.android.library'\n  id 'expo-module-gradle-plugin'\n}\n")
      .replace("  kotlinOptions { jvmTarget = '17' }\n", '')
      .replace('  defaultConfig {\n', "  defaultConfig {\n    versionCode 1\n    versionName '0.1.0'\n"));
  }
}
