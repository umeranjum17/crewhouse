// Loader hooks (module.register) for the test that loads mobile/src/phone-only.ts under node: each Expo module it imports
// resolves to test/expo-fake.ts, and its Markdown templates load as their text, as metro bundles them.
import { readFileSync } from 'node:fs';
const fake = new URL('./expo-fake.ts', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (/^expo(\/|-|$)/.test(specifier)) return { url: fake, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('.md')) {
    return { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
  }
  return next(url, context);
}
