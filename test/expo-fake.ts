// In-memory stand-ins for the Expo modules mobile/src/phone-only.ts imports, so its storage runs under `node --test`
// with no device. test/expo-hooks.mjs maps every `expo-*` and `expo/*` import here at run time; tsconfig `paths` maps
// their types here. Only the calls phone-only.ts makes are implemented, and a missing file reads as an error.
export const files = new Map<string, string>();
const dirs = new Set<string>();
export function reset() { files.clear(); dirs.clear(); }

type Part = string | { uri: string };
const joined = (parts: Part[]) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));
const nameOf = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

export class Directory {
  readonly uri: string;
  constructor(...parts: Part[]) { this.uri = joined(parts); }
  get name() { return nameOf(this.uri); }
  get exists() { return dirs.has(this.uri); }
  create(_options?: { intermediates?: boolean; idempotent?: boolean }) { dirs.add(this.uri); }
  delete() {
    dirs.delete(this.uri);
    for (const uri of [...files.keys()]) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
  }
  list(): Array<File | Directory> {
    return [
      ...[...files.keys()].filter((uri) => parentOf(uri) === this.uri).map((uri) => new File(uri)),
      ...[...dirs].filter((uri) => parentOf(uri) === this.uri).map((uri) => new Directory(uri)),
    ];
  }
}

export class File {
  readonly uri: string;
  constructor(...parts: Part[]) { this.uri = joined(parts); }
  get name() { return nameOf(this.uri); }
  get exists() { return files.has(this.uri); }
  create(options?: { intermediates?: boolean; overwrite?: boolean }) {
    if (options?.overwrite || !files.has(this.uri)) files.set(this.uri, '');
  }
  write(content: string | Uint8Array, options?: { append?: boolean }) {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    files.set(this.uri, (options?.append ? files.get(this.uri) ?? '' : '') + text);
  }
  textSync() {
    const text = files.get(this.uri);
    if (text === undefined) throw new Error(`no file at ${this.uri}`);
    return text;
  }
  moveSync(dest: File) {
    const text = this.textSync();
    files.delete(this.uri);
    files.set(dest.uri, text);
  }
  delete() { files.delete(this.uri); }
}

export const Paths = { document: new Directory('file:///phone-documents') };

// Secure storage and the rest: enough for phone-only.ts to load and for its sign-in marker to round-trip.
const secure = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 4;
export async function getItemAsync(key: string) { return secure.get(key) ?? null; }
export async function setItemAsync(key: string, value: string) { secure.set(key, value); }
export async function deleteItemAsync(key: string) { secure.delete(key); }
export const randomUUID = () => crypto.randomUUID();
export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
export async function shareAsync(_uri: string, _options?: unknown) {}
