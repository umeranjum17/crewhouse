// Inter weights on the phone: one variable file cannot carry bold on Android.
// React Native resolves a custom family's weight only on iOS; on Android a custom family always draws its default
// instance, so every bold title fell back to regular. The fix is static instances of the same bundled variable font
// (assets/fonts, instanced with fonttools at opsz 14), one family per weight, mapped here — the one place that turns
// a weight into a family. iOS keeps the variable font with a weight, exactly as before.
import { Platform, type TextStyle } from 'react-native';

type Weight = NonNullable<TextStyle['fontWeight']>;

const FAMILY: Record<string, string> = {
  '400': 'Inter',
  '500': 'Inter_Medium',
  '600': 'Inter_SemiBold',
  '700': 'Inter_Bold',
  '900': 'Inter_Black',
};

/** A weight that stays bold on Android too: write `...fw('600')` where a style said weight 600. */
export const fw = (w: Weight): TextStyle =>
  Platform.OS === 'android' ? { fontFamily: FAMILY[w] ?? 'Inter' } : { fontFamily: 'Inter', fontWeight: w };
