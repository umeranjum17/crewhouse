// The preview APK ships one file per ABI so the arm64 download a phone pulls on
// onboarding stays small; `expo prebuild` regenerates android/app/build.gradle,
// so the splits live here and not in that file. Other ABIs stay available as
// sibling artifacts; the releases page links the arm64 one directly.
const { withAppBuildGradle } = require('expo/config-plugins');

const SPLITS = `splits {
        abi {
            reset()
            enable true
            universalApk false
            include "armeabi-v7a", "arm64-v8a", "x86_64"
        }
    }`;

const ABI_CODES = `def abiCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 3]
import com.android.build.OutputFile
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abi = output.getFilter(OutputFile.ABI)
        if (abi != null) {
            output.versionCodeOverride = variant.versionCode * 10 + abiCodes.get(abi)
        }
    }
}`;

module.exports = (config) => withAppBuildGradle(config, (c) => {
  if (!c.modResults.contents.includes('universalApk false')) {
    c.modResults.contents = c.modResults.contents.replace(
      'android {\n    ndkVersion',
      `android {\n    ${SPLITS}\n    ndkVersion`,
    );
  }
  if (!c.modResults.contents.includes('abiCodes')) c.modResults.contents += `\n${ABI_CODES}\n`;
  return c;
});
