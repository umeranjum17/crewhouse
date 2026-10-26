// The phone app's own download, offered on the pairing screen as a QR and the same link in plain text.
// The forge's newest phone preview wins, so a person who scans it installs today's build instead of the hand-made
// rolling release's old one; the one stable link stands whenever the forge cannot be asked (offline, blocked, out of
// requests). The lookup is public and unauthenticated: it names a release asset, never the person or their crew.
import { demo, type Json } from './api.ts';

/** The rolling release, kept as the fallback: it always answers, whatever the forge says. */
export const APP_DOWNLOAD_URL = 'https://github.com/umeranjum17/crewhouse/releases/download/phone-preview/crewhouse.apk';
export type AppDownload = { url: string; version: string };
/** A phone preview's tag, e.g. v1.0.0-preview.20261024.25; the newest one leads the releases list. */
const PREVIEW = /^v\d+\.\d+\.\d+-preview\.\d+\.\d+$/, ARM64 = /-arm64-v8a\.apk$/i;

let found: AppDownload | null = null, askedAt = 0;
/** The newest phone preview's arm64 build, or null while the forge cannot be asked. Asked once, kept ten minutes. */
export const appDownload = async (): Promise<AppDownload | null> => {
  if (demo) return null; // every demo screen runs with no network
  if (Date.now() - askedAt < 600_000) return found;
  askedAt = Date.now();
  try {
    const r = await fetch('https://api.github.com/repos/umeranjum17/crewhouse/releases?per_page=20', { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/vnd.github+json' } });
    const list: Json[] = r.ok ? await r.json() : [], rel = (Array.isArray(list) ? list : []).find((x) => !x.draft && PREVIEW.test(String(x.tag_name))), file: Json = rel?.assets?.find((a: Json) => ARM64.test(String(a.name)));
    found = file ? { url: String(file.browser_download_url), version: String(rel.tag_name).replace(/^v/, '') } : null;
  } catch { found = null; /* no answer: the stable link stands */ }
  return found;
};
