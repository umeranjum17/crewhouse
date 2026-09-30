// This phone's own IPv4 addresses (Android; elsewhere none, so the offline words stay general).
import { requireOptionalNativeModule } from 'expo';

const net = requireOptionalNativeModule<{ addresses(): Promise<string[]> }>('CrewhouseNet');
export const addresses = (): Promise<string[]> => net?.addresses().catch(() => []) ?? Promise.resolve([]);

// Speaking to Chief on this phone's own recognizer (Android 12+ with it installed; elsewhere no mic is shown).
const voice = requireOptionalNativeModule<{ canHear(): Promise<boolean>; hear(): Promise<string>; stop(): Promise<void> }>('CrewhouseVoice');
export const canHear = (): Promise<boolean> => voice?.canHear().catch(() => false) ?? Promise.resolve(false);
/** What was heard ('' for nothing); fails `blocked` without the microphone, `unready` without the voice pack. */
export const hear = (): Promise<string> => voice?.hear() ?? Promise.resolve('');
export const stopHearing = () => { void voice?.stop().catch(() => {}); };

// One still of this phone's screen after its own consent dialog (Android; elsewhere none): its file:// address, or ''.
const screen = requireOptionalNativeModule<{ frame(): Promise<string> }>('CrewhouseScreen');
export const screenFrame = (): Promise<string> => screen?.frame() ?? Promise.resolve('');
