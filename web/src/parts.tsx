// The shared pieces: dot art, the ASCII moments, ask cards and the approval sheet, media, steps, the composer.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, trouble, type Json } from './api.ts';
import { draftOf, keepDraft, sent } from './draft.ts';
import { canHear, hear } from './voice.ts';
import { cycle, type Focused } from './dialog.ts';
import { chatTokens, safeLink } from './chat-md.ts';
import * as art from './art.ts';
import { MARKS } from './logos.ts';
import { clock, column, docLinks, sourceLabel, document as docView, fileSource, fileView, mdPlain, pageWords, saveAs, sheetWords, workbook, type Card, type DocPart, type DocView, type FileView, type Helper, type Sheet, type Step, type Workbook } from './adapter.ts';

/** Markdown inline runs, from the shared safe tokens (web/src/chat-md.ts): no raw HTML, http(s) links only. */
const mdInline = (tokens: any[]): ReactNode => tokens.map((t, i) => t.type === 'strong' ? <strong key={i}>{mdInline(t.tokens)}</strong>
  : t.type === 'em' ? <em key={i}>{mdInline(t.tokens)}</em>
  : t.type === 'link' && safeLink(t.href) ? <a className="chat-link" key={i} href={safeLink(t.href)} target="_blank" rel="noopener noreferrer">{t.text === t.href ? sourceLabel(safeLink(t.href)) : mdInline(t.tokens)}</a>
  : t.type === 'codespan' ? <span key={i}>{t.text}</span>
  : t.type === 'br' ? <br key={i} />
  : t.type === 'html' ? t.raw : t.tokens ? <span key={i}>{mdInline(t.tokens)}</span> : t.text ?? t.raw);
/** Markdown blocks from the same tokens: headings, paragraphs, task lists with read-only ticks, tables. */
const mdBlocks = (tokens: any[]): ReactNode => tokens.map((t, i) => t.type === 'heading' ? <h3 key={i}>{mdInline(t.tokens)}</h3>
  : t.type === 'paragraph' || t.type === 'text' ? <p key={i}>{mdInline(t.tokens ?? [{ text: t.text }])}</p>
  : t.type === 'list' ? <ul key={i}>{t.items.map((item: any, j: number) => <li key={j}>{item.task && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? 'Done' : 'Not done'} />} {mdBlocks(item.tokens.filter((x: any) => x.type !== 'checkbox'))}</li>)}</ul>
  : t.type === 'table' ? <div className="chat-table" key={i}><table><thead><tr>{t.header.map((c: any, j: number) => <th key={j}>{mdInline(c.tokens)}</th>)}</tr></thead><tbody>{t.rows.map((row: any[], j: number) => <tr key={j}>{row.map((c, k) => <td key={k}>{mdInline(c.tokens)}</td>)}</tr>)}</tbody></table></div>
  : t.type === 'code' ? <p key={i}>{t.text}</p>
  : t.type === 'html' ? <p key={i}>{t.raw}</p> : null);

/** Chat markdown without raw HTML or arbitrary URL schemes. Long answers stay available behind More. */
export function ChatText({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.length > 700 || text.split('\n').length > 10;
  const shown = long && !more ? text.slice(0, 650).replace(/\s+\S*$/, '') : text;
  return <div className="chat-md">{mdBlocks(chatTokens(shown))}{long && <button className="chat-more" onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</button>}</div>;
}

// ---------- toasts ----------
const listeners = new Set<(m: string) => void>();
/** A short line at the bottom of the screen: "Sent", "Connecting apps comes with the next update". */
export const toast = (m: string) => listeners.forEach((l) => l(m));
export function Toasts() {
  const [m, setM] = useState('');
  useEffect(() => {
    let t: any;
    const l = (x: string) => { setM(x); clearTimeout(t); t = setTimeout(() => setM(''), 3200); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return m ? <div className="toast" role="status">{m}</div> : null;
}
/** Run an action; a failure becomes a friendly toast, never a stack trace. `quiet` leaves the word to the caller —
 *  the composer, whose failed send keeps the words on screen with a Retry instead. */
export async function attempt(fn: () => Promise<unknown>, ok?: string, quiet = false) {
  try { await fn(); if (ok) toast(ok); return true; } catch (e: any) { if (!quiet) toast(FRIENDLY[trouble(e)]); return false; }
}
const FRIENDLY = {
  missing: "That isn't ready yet. It arrives with the next Crewhouse update.",
  offline: "Can't reach the home computer right now. Check it's on, then try again.",
  failed: 'That didn’t work. Please try again.',
};

// ---------- dialogs ----------
/** A dialog that owns the keyboard while it's open: focus moves in on open, Tab cycles inside (the page behind never
 *  gets it), Escape leaves, and on close the focus goes home. One hook, so every sheet behaves the same. */
export function useDialogOwn(box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const dlg = box.current;
    if (!dlg) return;
    const prev = document.activeElement as HTMLElement | null;
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    dlg.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); }
      else if (e.key === 'Tab') {
        const list = dlg.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        const now = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const next = cycle(Array.from(list) as unknown as Focused[], now, e.shiftKey);
        if (next) { e.preventDefault(); next.focus(); }
      }
    };
    addEventListener('keydown', keys, true);
    return () => { removeEventListener('keydown', keys, true); prev?.focus?.(); };
  }, [box]);
}

// ---------- dot art ----------
export function Dots({ rows, pal, d = 6, label, crisp = false }: { rows: art.Bitmap; pal: art.Palette; d?: number; label?: string; crisp?: boolean }) {
  return (
    <div className={`dots${crisp ? ' crisp' : ''}`} style={{ ['--w' as any]: rows[0].length, ['--d' as any]: `${d}px` }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {rows.flatMap((r, y) => [...r].map((k, x) => <b key={`${y}.${x}`} className={pal[k] ? 'on' : undefined} style={pal[k] ? { background: pal[k] } : undefined} />))}
    </div>
  );
}

/** One 170 ms blink frame when the mood changes, then the new face. No tween, no slide; Reduce Motion changes at once.
 *  The face is otherwise still — no idle blink, no twitch (the calmer-look pass removed them). */
function useChangeBlink(on: boolean, mood: art.Mood) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(mood);
  useEffect(() => {
    if (prev.current === mood) return;
    prev.current = mood;
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 170);
    return () => clearTimeout(t);
  }, [mood, on]);
  return flash;
}

/** Chief's mood holds: a higher-priority mood takes over at once, a lower one waits until the current one has held for
 *  6 s, so the 120 ms refresh and the 15 s poll never flicker him. Hero-sized faces only; small faces change at once. */
export function useHeld<V extends { mood: art.Mood; rank: number }>(view: V): V {
  const [cur, setCur] = useState(view);
  const since = useRef(Date.now());
  useEffect(() => {
    if (cur.mood === view.mood && cur.rank === view.rank) return;
    if (view.rank < cur.rank || Date.now() - since.current >= 6000) { setCur(view); since.current = Date.now(); }
  }, [view, cur]);
  return cur.mood === view.mood ? view : cur;
}

/** Chief leans in while his composer holds your words, and for a beat after it empties or blurs. */
let listening = false;
const listenSubs = new Set<() => void>();
export function setListen(chat: string | undefined, on: boolean) {
  const next = !!chat && chat === 'chief' && on;
  if (next === listening) return;
  listening = next;
  listenSubs.forEach((f) => f());
}
export function useListen() {
  const [on, setOn] = useState(listening);
  useEffect(() => { const f = () => setOn(listening); listenSubs.add(f); return () => { listenSubs.delete(f); }; }, []);
  return on;
}

/** Set by the shell as it renders, so the art matches day or night without waiting a frame — and so every little
 *  Chief face (avatars, headers) carries the mood without each caller holding the state. */
let night = false;
export const setNight = (n: boolean) => { night = n; };
let chiefMood: art.Mood = 'idle';
export const setChiefMood = (m: art.Mood) => { chiefMood = m; };

/** Chief. `d` is sized for the old 14-dot head, so callers keep their footprint; small sizes get the 12-dot cut.
 *  `hero` marks the one face on screen that lives: it blinks and shows the 170 ms change-blink. */
export function ChiefArt({ mood = 'idle', d = 6, dark, hero }: { mood?: art.Mood; d?: number; dark?: boolean; hero?: boolean }) {
  const flash = useChangeBlink(!!hero, mood);
  const m = flash ? 'blink' : mood;
  const dd = (d * 14) / 22, small = d * 14 < 24;
  return <Dots rows={small ? art.chiefSmall(m) : art.chief(m)} pal={dark ?? night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={small ? (dd * 22) / 12 : dd} label="Chief" crisp={d * 14 < 96} />;
}
export function PalArt({ kind, mood = 'idle', d = 4, name, crisp = false }: { kind: art.Kind; mood?: art.Mood; d?: number; name?: string; crisp?: boolean }) {
  return <Dots rows={art.pal(kind, mood)} pal={art.palPalette(kind)} d={(d * 12) / 18} label={name} crisp={crisp} />;
}

/** A round face: Chief or a pal, with a ring when it's working or needs you. */
export function Face({ who, size = 44, ring = '' }: { who: Helper | 'chief' | { kind: art.Kind; name: string; mood?: art.Mood }; size?: number; ring?: string }) {
  const chief = who === 'chief';
  const soft = chief ? (night ? '#2A2622' : '#FFF3E0') : art.PALS[who.kind].soft;
  return (
    <span className={`face ${ring}`} style={{ width: size, height: size, background: night && !chief ? `color-mix(in srgb, ${soft} 16%, var(--solid))` : soft }}>
      {chief ? <ChiefArt d={size * .74 / 14} mood={chiefMood} /> : <PalArt kind={who.kind} mood={who.mood} d={size * .74 / 12} name={who.name} crisp={size < 96} />}
    </span>
  );
}

/** The mark is Chief himself (the app icon's 12-dot cut), then the wordmark. */
export function Logo({ night }: { night?: boolean }) {
  return (
    <span className="logo" aria-label="Crewhouse">
      <Dots rows={art.chiefSmall()} pal={night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={1.8} crisp />
      <span>Crewhouse</span>
    </span>
  );
}

/** An AI account's own mark, white on its brand tile. */
export function AiMark({ ai, size = 36 }: { ai: { key: string; bg: string }; size?: number }) {
  return (
    <span className="ai-mark" style={{ background: ai.bg, width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size * .56} height={size * .56}><path d={MARKS[ai.key]} fill="#fff" /></svg>
    </span>
  );
}

// ---------- ASCII moments ----------
function useTicker(ms: number, on = true) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const i = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(i);
  }, [ms, on]);
  return t;
}

/** Chief types on a tiny laptop while the crew works. */
export function Laptop() {
  const t = useTicker(150);
  return <pre className="art laptop" aria-hidden>{art.laptop(t)}</pre>;
}

/** The block-letter CREWHOUSE: solid strokes in ink, their shadow in the quiet line colour. */
export function Banner() {
  return <pre className="art banner" aria-hidden>
    {art.BANNER.map((line, y) => <div key={y}>{line.split(/(█+)/).map((run, x) => <i key={x} className={run.startsWith('█') ? 'ink' : undefined}>{run}</i>)}</div>)}
  </pre>;
}

/** ?splash keeps the boot splash up, for design review. */
const holdSplash = typeof location !== 'undefined' && new URLSearchParams(location.search).has('splash');
/** The boot splash: block letters over a living field of glyphs, and Chief waking the crew. */
export function Splash({ done: ready }: { done: boolean }) {
  const done = ready && !holdSplash;
  const t = useTicker(110);
  const [gone, setGone] = useState(false);
  useEffect(() => { if (done) { const x = setTimeout(() => setGone(true), 450); return () => clearTimeout(x); } }, [done]);
  if (gone) return null;
  const words = 'Waking the crew…';
  return (
    <div className={`splash ${done ? 'out' : ''}`} role="status" aria-label="Opening Crewhouse">
      <pre className="art field" aria-hidden>{art.field(t, 200, 72)}</pre>
      <div className="splash-in">
        <Banner />
        <ChiefArt mood="work" d={7} dark />
        <Laptop />
        <div className="splash-line">{words.slice(0, Math.min(words.length, 4 + t))}<span className="cur" /></div>
      </div>
    </div>
  );
}

/** A finished job, said once: a calm toast with a way in — never a full-screen party. Gone within 4 s. */
export function Celebrate({ title, href, onDone }: { title: string; href: string; onDone: () => void }) {
  useEffect(() => { const x = setTimeout(onDone, 4000); return () => clearTimeout(x); }, [onDone]);
  return <div className="toast celebrate-toast" role="status">✓ {title} · <a href={href} onClick={onDone}>Open</a></div>;
}

// ---------- small things ----------
export function Pill({ tone = 'ok', live, children }: { tone?: 'ok' | 'wait' | 'off'; live?: boolean; children: ReactNode }) {
  return <span className={`pill ${tone}${live ? ' live' : ''}`}><i />{children}</span>;
}

export function Media({ f, big }: { f: FileView; big?: boolean }) {
  const [play, setPlay] = useState(false);
  if (f.kind === 'image') return <a href={f.url} target="_blank" rel="noreferrer" className="media"><img src={f.url} alt={f.name} /></a>;
  if (f.kind === 'sheet' || f.kind === 'page') return <PreviewCard f={f} big={big} />;
  if (f.kind === 'video') {
    return play
      ? <video className="media" src={f.url} controls autoPlay />
      : <button className={`media cover ${big ? 'big' : ''}`} onClick={() => setPlay(true)} aria-label={`Play ${f.name}`}><span>{f.name}</span><i>▶</i></button>;
  }
  return <a href={f.url} target="_blank" rel="noreferrer" className="doc"><span className="doc-ic">▤</span><span className="grow">{f.name}</span><b>Open</b></a>;
}

// ---------- previews: spreadsheets and documents crewd read for the app ----------
/** crewd reads a delivered file with its own copy of the library (web/src/adapter.ts, docs/ui-contract.md); the card and
 *  the panel open the same file, so they share one read instead of asking the home computer twice. */
const previews = new Map<string, Promise<Json>>();
function usePreview(f: FileView) {
  const [read, setRead] = useState<{ book: Workbook | null; doc: DocView | null; text: string | null; title?: string }>({ book: null, doc: null, text: null });
  useEffect(() => {
    const src = fileSource(f.url);
    if (!src) return;
    let on = true;
    let got = previews.get(f.url);
    if (!got) previews.set(f.url, got = f.kind === 'page' ? api.document(src.bot, src.path) : api.workbook(src.bot, src.path));
    // crewd's registered title names the file wherever it opens, even from a bare `#/f/…` address.
    got.then((j) => on && setRead({ title: typeof j?.title === 'string' && j.title.trim() ? j.title.trim() : undefined, ...(f.kind === 'page'
      ? (typeof j?.text === 'string' ? { book: null, doc: null, text: mdPlain(j.text) } : { book: null, doc: docView(j, f.name), text: null })
      : { book: workbook(j, f.name), doc: null, text: null }) }))
      .catch(() => on && setRead({ book: null, doc: null, text: null }));
    return () => { on = false; };
  }, [f.url, f.name]);
  return read;
}

const bare = (t: string) => t.toLowerCase().replace(/^the\s+|[^a-z0-9]/g, '');
/** The line under a file's name: what kind of thing it is, and how much is in it. */
function aboutFile(f: FileView, book: Workbook | null, doc: DocView | null) {
  const kind = f.kind === 'page' ? 'Document' : 'Spreadsheet';
  const count = book ? book.sheets.length : doc?.parts.filter((p) => p.kind === 'heading' && bare(p.text ?? '') !== bare(f.name)).length ?? 0;
  return count ? `${kind} · ${book ? sheetWords(count) : pageWords(count)}` : kind;
}

/** A page's peek: its first heading that is not the title said twice, over a grey line for each of the next few parts,
 *  each as long as the words it stands for. A written page (.md) reads the same way from its own lines. */
function pagePeek(name: string, doc: DocView | null, text: string | null) {
  const parts: DocPart[] = doc?.parts ?? (text ?? '').split('\n').filter((l) => l.trim())
    .map((l) => ({ kind: /^#/.test(l) ? 'heading' : 'p', text: l.replace(/^[#>*\-\s]+/, '') }));
  const at = parts.findIndex((p) => p.kind === 'heading' && bare(p.text ?? '') !== bare(name));
  const bars = parts.slice(at + 1).filter((p) => p.kind !== 'heading').slice(0, 4)
    .map((p) => (p.kind === 'table' ? 100 : Math.min(100, 30 + (p.text ?? '').length / 2)));
  return { head: at < 0 ? '' : parts[at].text ?? '', bars };
}

/** The card's peek inside: a sheet's top-left corner as a small grid, tinted the way the panel is, or a page's heading
 *  over its lines. Nothing to peek at yet (still opening, or empty) shows nothing. */
export function Thumb({ name, book, doc, text }: { name: string; book: Workbook | null; doc: DocView | null; text: string | null }) {
  const s = book?.sheets[0];
  if (s && [s.head, ...s.rows].some((r) => r.some(Boolean))) {
    const rows = [s.head, ...s.rows].slice(0, 4);
    const cols = [...Array(Math.min(4, Math.max(...rows.map((r) => r.length)))).keys()];
    return <span className="wb-thumb" aria-hidden style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>{rows.flatMap((r, j) => cols.map((c) =>
      <i key={`${j}-${c}`} className={s.roles[j]?.[c] || (j ? undefined : 'head')}>{r[c] ?? ''}</i>))}</span>;
  }
  const page = doc || text ? pagePeek(name, doc, text) : null;
  if (!page || (!page.head && !page.bars.length)) return null;
  return <span className="wb-thumb leaf" aria-hidden>
    {page.head && <b>{page.head}</b>}
    {page.bars.map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}
  </span>;
}

/** A finished file the helper made — a workbook or a document — in the chat: a peek inside, then what kind of file it
 *  is, its name, a line about it, and Open. */
export function PreviewCard({ f: given, big }: { f: FileView; big?: boolean }) {
  const { book, doc, text, title } = usePreview(given);
  const f = title ? { ...given, name: title } : given;
  const src = fileSource(f.url);
  const about = aboutFile(f, book, doc);
  return (
    <a className={`wb-card${big ? ' big' : ''}`} href={`#/f/${src?.bot ?? ''}/${encodeURIComponent(src?.path ?? '')}`} aria-label={`Open ${f.name}`}>
      <Thumb name={f.name} book={book} doc={doc} text={text} />
      <span className={`wb-ic wb-${f.kind}`} aria-hidden>{src?.path.split('.').pop()?.toUpperCase().slice(0, 4)}</span>
      <span className="grow wb-what">
        <b>{f.name}</b>
        <span className="mute small">{about}</span>
      </span>
      <b className="wb-open">Open</b>
    </a>
  );
}

/** One sheet as a grid, read-only: letters over every column any row reaches, the file's own row numbers down the
 *  side, each cell tinted by its role, and what is not shown said under it. */
export function SheetTable({ s }: { s: Sheet }) {
  const cols = [...Array(Math.max(...[s.head, ...s.rows].map((r) => r.length))).keys()];
  const more = s.total - s.rows.length - 1;
  return <div className="wb-rows">
    <table className="wb-grid wb-sheet">
      <thead><tr><th className="wb-n" />{cols.map((c) => <th key={c}>{column(c)}</th>)}</tr></thead>
      <tbody>{[s.head, ...s.rows].map((r, i) => <tr key={i}><th className="wb-n" scope="row">{s.nums[i] ?? i + 1}</th>
        {cols.map((c) => i ? <td key={c} className={s.roles[i]?.[c] || undefined}>{r[c] ?? ''}</td>
          : <th key={c} scope="col" className="head">{r[c] ?? ''}</th>)}</tr>)}</tbody>
    </table>
    {more > 0 && <div className="mute small">…and {more === 1 ? 'one more row' : `${more} more rows`}. Download it to see the whole sheet.</div>}
  </div>;
}

/** Link bare source URLs without changing the document's visible text. React escapes everything else. */
function DocText({ text = '' }: { text?: string }) {
  return <>{docLinks(text).map((part, i) => part.href
    ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</>;
}

/** The body of a document preview: its headings, paragraphs, bullet lists and tables, read-only. */
function DocBody({ doc }: { doc: DocView }) {
  const runs: (DocPart | DocPart[])[] = [];
  doc.parts.forEach((p) => {
    const last = runs.at(-1);
    if (p.kind === 'li' && Array.isArray(last)) last.push(p);
    else if (p.kind === 'li') runs.push([p]);
    else runs.push(p);
  });
  return <div className="wb-rows doc-rows">
    {runs.map((run, i) => Array.isArray(run) ? <ul key={i}>{run.map((li, j) => <li key={j}><DocText text={li.text} /></li>)}</ul>
      : run.kind === 'heading' ? <h3 key={i}><DocText text={run.text} /></h3>
      : run.kind === 'table' ? <table key={i} className="wb-grid">
          <thead><tr>{run.head?.map((h, c) => <th key={c}><DocText text={h} /></th>)}</tr></thead>
          <tbody>{run.rows?.map((r, k) => <tr key={k}>{run.head?.map((_, c) => <td key={c}><DocText text={r[c] ?? ''} /></td>)}</tr>)}</tbody>
        </table>
      : <p key={i} className={run.bold ? 'strong' : undefined}><DocText text={run.text} /></p>)}
  </div>;
}

/**
 * A finished file read-only: a workbook is sheet tabs over a table; a document is its headings, paragraphs, lists and
 * tables. On a desk it is a panel beside the chat it came from; on a phone it is the whole screen. Reading edits
 * nothing, and Download hands over the file itself.
 */
export function PreviewPanel({ bot, path, title: known, onClose }: { bot: string; path: string; title?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  useDialogOwn(box, onClose);
  const file = fileView(bot, path, known);
  const { book, doc, text, title } = usePreview(file);
  const f = title ? { ...file, name: title } : file;
  const sheets = book?.sheets ?? [];
  const s = sheets[Math.min(tab, Math.max(0, sheets.length - 1))];
  const about = aboutFile(f, book, doc);
  return (
    <div className="scrim wb-scrim" onClick={onClose}>
      <div ref={box} className="wb-panel" role="dialog" aria-modal aria-label={f.name} onClick={(e) => e.stopPropagation()}>
        <header className="wb-head">
          <span className={`wb-ic wb-${f.kind}`} aria-hidden>{f.kind === 'page' ? '▤' : '▦'}</span>
          <span className="grow wb-what"><b>{f.name}</b><span className="mute small">{about}</span></span>
          <a className="btn" href={f.url} download={saveAs(f).name}>Download</a>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!book && !doc && text === null && <div className="mute">Opening “{f.name}”…</div>}
        {book && !sheets.length && <div className="mute">There is nothing in it to show yet.</div>}
        {doc && !doc.parts.length && <div className="mute">There is nothing in it to show yet.</div>}
        {s && <SheetTable s={s} />}
        {sheets.length > 0 && <nav className="wb-tabs" aria-label="Sheets">
          {sheets.map((x, i) => <button key={`${x.name}-${i}`} className={`wb-tab${x === s ? ' on' : ''}`} onClick={() => setTab(i)}>{x.name}</button>)}
        </nav>}
        {doc && doc.parts.length > 0 && <DocBody doc={doc} />}
        {text !== null && <div className="wb-rows doc-rows"><div className="chat-md">{mdBlocks(chatTokens(text))}</div></div>}
      </div>
    </div>
  );
}

/** "Show the work", as a friendly list of steps. */
export function Steps({ steps, max = 6, onUndo }: { steps: Step[]; max?: number; onUndo?: (s: Step) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(-max);
  if (!steps.length) return null;
  return (
    <div className="card steps">
      {steps.length > shown.length && <button className="link" onClick={() => setAll(true)}>Show all {steps.length} steps</button>}
      {shown.map((s) => (
        <div key={s.seq} className={`step ${s.now ? 'now' : s.asked ? 'asked' : ''}`}>
          <i className="ascii" /><span className="grow">{s.text}</span>
          {onUndo && s.undo && <button className="link" onClick={() => onUndo(s)}>Undo</button>}
          <time>{s.now ? 'now' : clock(s.at)}</time>
        </div>
      ))}
    </div>
  );
}

/** The voice note to Chief: a mic in the box when this browser can hear on this device. What was said lands in the
 *  box after what is already there, for the person to read and send; nothing is sent by speaking. */
function useVoice(on: boolean, text: string, put: (t: string) => void) {
  const [can, setCan] = useState(false);
  const [ear, setEar] = useState<{ stop: () => void } | null>(null);
  const now = useRef(text);
  now.current = text;
  useEffect(() => { if (on) void canHear().then(setCan); }, [on]);
  useEffect(() => () => ear?.stop(), [ear]); // leaving the box turns the mic off
  if (!can) return null;
  const start = () => {
    const h = hear();
    setEar(h);
    setListen('chief', true);
    h.words.then((w) => { if (w) put(now.current.trim() ? `${now.current.trimEnd()} ${w}` : w); else toast("I didn't catch that. Try again."); },
      (e) => toast(e.message === 'blocked' ? 'Allow the microphone for this page, then try again.' : "Speaking isn't ready on this computer. Type instead."))
      .finally(() => { setEar(null); setListen('chief', false); });
  };
  return <button type="button" className={`mic${ear ? ' on' : ''}`} aria-label={ear ? 'Stop listening' : 'Speak to Chief'} aria-pressed={!!ear}
    onClick={() => (ear ? ear.stop() : start())}>{ear ? <i className="mic-stop" /> : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}</button>;
}

/**
 * The message box. `chat` ties it to one conversation's held draft. A send that doesn't go through keeps the words
 * here with a Retry: nothing a person typed is ever thrown away (web/src/draft.ts).
 */
export function Composer({ placeholder, onSend, chat }: { placeholder: string; onSend: (t: string) => Promise<unknown> | unknown; chat?: string }) {
  const [text, setText] = useState(() => (chat ? draftOf(chat).text : ''));
  const voice = useVoice(chat === 'chief', text, (t) => change(t));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const hold = useRef<any>(null);
  const hear = (on: boolean, words: string) => { // he listens while focused with words, 1.5 s after it ends
    clearTimeout(hold.current);
    if (on && words.trim()) setListen(chat, true);
    else hold.current = setTimeout(() => setListen(chat, false), 1500);
  };
  const change = (t: string) => { setText(t); setFailed(false); hear(focused, t); if (chat) keepDraft(chat, t); };
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    let ok = false;
    try { ok = !!(await onSend(t)); } catch { ok = false; }
    setBusy(false);
    if (ok) { setText(''); setFailed(false); hear(focused, ''); if (chat) keepDraft(chat, ''); } else { setFailed(true); if (chat) sent(chat, false, text); }
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      {failed && <div className="send-failed" role="alert">Not sent — it's kept here. <button type="button" className="link inline" onClick={() => void send()}>Retry</button></div>}
      <textarea rows={1} value={text} placeholder={placeholder} aria-label={placeholder}
        onFocus={() => { setFocused(true); hear(true, text); }} onBlur={() => { setFocused(false); hear(false, text); }}
        onChange={(e) => change(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      {voice}
      <button className="send" aria-label="Send" disabled={!text.trim() || busy}>↑</button>
    </form>
  );
}

// ---------- asks ----------
const answer = (c: Card, body: Json) => attempt(() => api.answer(c.id, body), body.change ? 'Chief will change the plan' : body.remind ? 'OK, back tomorrow' : body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

/** A waiting-for-the-computer schedule preview: the words in plain time, and the first run on the computer's own clock. */
function useSchedule(text: string | null) {
  const [preview, setPreview] = useState<Json>(null);
  useEffect(() => {
    if (text === null || !text.trim()) return setPreview(null);
    const t = setTimeout(() => api.schedule(text).then(setPreview).catch(() => setPreview({ bad: true })), 250);
    return () => clearTimeout(t);
  }, [text]);
  return preview;
}

/** An order line as the page wrote it, laid out as its words and its amount at the edge. No word changes —
 *  the money is crewd's read of the page, and the rest of the line is the page's own. */
const splitAmount = (l: string): [string, string] => {
  const m = l.match(/^(.*?)[\s—]+(\$[\d.,]+)$/);
  return m ? [m[1], m[2]] : [l, ''];
};

/** The ask's evidence in the sunken block (§4.4): an order's lines with the total above a hairline, a form's or a
 *  job's label-over-value lines, a draft's to/subject/body, Chief's routine confirmation lines, or exactly what
 *  goes out. Long bodies clamp until `open`; `readAll` is the card's or the sheet's own way of opening them. */
function AskEvidence({ c, open, readAll }: { c: Card; open: boolean; readAll: ReactNode }) {
  const body = c.preview?.body ?? '';
  if (c.review) return <div className="ev">{body.split('\n').map((l, i) => {
    const [text, amount] = splitAmount(l);
    return <div key={i} className={`order-row${/^Total/.test(l) ? ' total' : ''}`}>{amount ? <><span className="grow">{text}</span><span>{amount}</span></> : text}</div>;
  })}</div>;
  if (c.evidence === 'lines') return <div className="ev">{body.split('\n').filter(Boolean).map((l, i) => {
    const at = l.indexOf(': ');
    return at > 0 ? <div key={i} className="ev-line"><span>{l.slice(0, at)}</span><b>{l.slice(at + 2)}</b></div> : <div key={i}>{l}</div>;
  })}</div>;
  if (c.evidence === 'draft') {
    const at = body.indexOf('\n');
    return <div className="ev">
      {c.draftTo && <div className="ev-to">To {c.draftTo}</div>}
      <b className="ev-subject">{(at < 0 ? body : body.slice(0, at)).replace(/^Subject: /, '')}</b>
      <div className={`ev-body${open ? '' : ' clamp4'}`}>{(at < 0 ? '' : body.slice(at + 1)).trim()}</div>
      {!open && readAll}
    </div>;
  }
  if (c.lines) return <div className="ev">{c.lines.map((l, i) => <div key={i} className={i && c.kind === 'routine' ? 'ev-quiet' : undefined}>{l}</div>)}</div>;
  if (c.preview) return <div className="ev">
    {c.preview.head && <div className="ev-to">{c.preview.head}</div>}
    <div className={`ev-body${open ? '' : ' clamp3'}`}>{c.preview.body}</div>
    {!open && readAll}
  </div>;
  return null;
}

/** The ask card's head: the asker's face and name, the status line with the pink dot, the time on the right. */
function AskHead({ c, who }: { c: Card; who: Helper | undefined }) {
  const name = c.helper === 'chief' ? 'Chief' : who?.name ?? c.head;
  return <div className="ask-head">
    {c.helper === 'chief' ? <Face who="chief" size={28} /> : who ? <Face who={{ ...who, mood: 'ask' }} size={28} /> : null}
    <div className="grow"><b>{name}</b><div className="ask-status"><i />{c.status}</div></div>
    <time className="mute small">{clock(c.at)}</time>
  </div>;
}

/** A helper's draft takes the person's own words before Approve: their version replaces the draft, and still nothing
 *  is sent. `box` stands in for the evidence while editing; `yes` carries the words only when they changed. */
function useDraftEdit(c: Card) {
  const [words, setWords] = useState<string | null>(null);
  const changed = words !== null && words.trim() !== c.draftText;
  return {
    can: c.evidence === 'draft' && !!c.draftText, editing: words !== null, empty: words !== null && !words.trim(),
    toggle: () => setWords(words === null ? c.draftText ?? '' : null),
    box: words !== null && <textarea className="input draft-edit" rows={8} value={words} onChange={(e) => setWords(e.target.value)} aria-label="Your version of the message" autoFocus />,
    yes: (body: Json) => (changed ? { ...body, text: words!.trim() } : body),
  };
}

/** The plain-language ask card, in the thread: one decision with the evidence in front of you. A checkout opens the
 *  review before any yes; spending always says the footer note. */
export function AskCard({ c, who, onDone }: { c: Card; who: Helper | undefined; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone(); else setOops(true); };
  const yes = c.choices[0];
  const deny = c.choices.find((x) => x.body.answer === 'deny' && x !== yes);
  // A deferred "Not now" comes back on its own: "Remind me tomorrow" re-asks it from a one-shot routine.
  const remind = deny && deny.label === 'Not now' ? { ...deny.body, remind: true } : null;
  const always = c.choices.find((x) => x.body.scope === 'always');
  const question = c.review && c.preview?.head ? c.preview.head : c.words;
  // A routine offered by Chief: the lines are the confirmation, and changing the time is an edit before the yes.
  const [when, setWhen] = useState<string | null>(null);
  const preview = useSchedule(when);
  const start = () => act({ answer: 'allow', scope: 'once', ...(when !== null && when.trim() && when.trim() !== c.schedule ? { schedule: when.trim() } : {}) });
  const stuck = when !== null && (!when.trim() || !preview || preview.bad);
  // Chief's plan: "Change it" opens a box, and what the person types goes back to Chief for a new plan.
  const [change, setChange] = useState<string | null>(null);
  const edit = useDraftEdit(c);
  return (
    <div className="card ask">
      <AskHead c={c} who={who} />
      <p className="ask-words">{question}</p>
      {edit.box || <AskEvidence c={c} open={false} readAll={<a className="link" href={`#/ask/${c.id}`}>Read all</a>} />}
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
      {c.kind === 'routine' ? (
        <>
          {when !== null && <form className="row routine-edit" onSubmit={(e) => { e.preventDefault(); if (!stuck) void start(); }}>
            <input className="input grow" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When? For example: every Saturday 10am" aria-label="When" />
          </form>}
          {when !== null && preview && !preview.bad && <div className="mute small routine-note">{preview.words}. First time {preview.first}. {c.zoneNote}</div>}
          {when !== null && preview?.bad && <div className="mute small routine-note">I didn't catch that time. Try “every Monday 9:00”.</div>}
          <div className="btns">
            <button className="btn go" disabled={stuck} onClick={start}>Start it</button>
            <button className="btn" aria-pressed={when !== null} onClick={() => { setWhen(when === null ? c.schedule || '' : null); }}>{when === null ? 'Change time' : 'Keep the time'}</button>
            {deny && <button className="btn" onClick={() => act(deny.body)}>{deny.label}</button>}
          {remind && <button className="btn ghost" onClick={() => act(remind)}>Remind me tomorrow</button>}
          </div>
        </>
      ) : c.kind === 'plan' ? (
        <>
          {change !== null && <form className="row routine-edit" onSubmit={(e) => { e.preventDefault(); if (change.trim()) void act({ answer: 'deny', change: change.trim() }); }}>
            <input className="input grow" value={change} onChange={(e) => setChange(e.target.value)} placeholder="What should change?" aria-label="What should change" autoFocus />
            <button className="btn go" disabled={!change.trim()}>Send</button>
          </form>}
          <div className="btns">
            {change === null && <button className="btn go" onClick={() => act(yes.body)}>{yes.label}</button>}
            <button className="btn" aria-pressed={change !== null} onClick={() => setChange(change === null ? '' : null)}>{change === null ? 'Change it' : 'Keep the plan'}</button>
            {deny && <button className="btn" onClick={() => act(deny.body)}>{deny.label}</button>}
          {remind && <button className="btn ghost" onClick={() => act(remind)}>Remind me tomorrow</button>}
          </div>
        </>
      ) : c.reply ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) act({ text: reply.trim() }); }}>
          <input className="input grow" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Tell ${who?.name ?? 'them'} what to do`} />
          <button className="btn go" disabled={!reply.trim()}>Send</button>
        </form>
      ) : c.review ? (
        <div className="btns">
          <a className="btn go" href={`#/ask/${c.id}`}>Review order</a>
          {deny && <button className="btn ghost" onClick={() => act(deny.body)}>{deny.label}</button>}
          {remind && <button className="btn ghost" onClick={() => act(remind)}>Remind me tomorrow</button>}
        </div>
      ) : yes ? (
        <div className="btns">
          <button className="btn go" disabled={edit.empty} onClick={() => act(edit.yes(yes.body))}>{yes.label}</button>
          {edit.can && <button className="btn" aria-pressed={edit.editing} onClick={edit.toggle}>{edit.editing ? 'Use the original' : 'Edit'}</button>}
          {deny && <button className="btn" onClick={() => act(deny.body)}>{deny.label}</button>}
          {remind && <button className="btn ghost" onClick={() => act(remind)}>Remind me tomorrow</button>}
          {always && <button className="btn ghost always" onClick={() => act(always.body)}>{always.label}</button>}
        </div>
      ) : null}
      {c.kind === 'spend' && <p className="ask-note">Anything that costs money asks you every time.</p>}
      {c.kind === 'plan' && <p className="ask-note">Saying Go doesn’t OK any sending or spending. Those still ask you each time.</p>}
    </div>
  );
}

/** The approval moment: who, the status, exactly what goes out, and the choices — a centred dialog on a desk,
 *  a bottom sheet on a phone. A checkout reviews the whole order here, with a yes that names the order; an order
 *  without a readable total offers no yes at all. */
export function AskSheet({ c, who, chiefSays, onClose }: { c: Card; who: Helper | undefined; chiefSays?: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onClose(); else setOops(true); };
  const question = c.review && c.preview?.head ? c.preview.head : c.words;
  const yes = c.choices[0]?.body.answer === 'allow' ? c.choices[0] : null;
  // Every way out that isn't the one yes — an unpriced order has two, and neither is a yes.
  const rest = c.choices.filter((x) => x !== yes && x.body.scope !== 'always');
  const remind = rest.find((x) => x.label === 'Not now' && x.body.answer === 'deny');
  const always = c.choices.find((x) => x.body.scope === 'always');
  const edit = useDraftEdit(c);
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={box} className="sheet approve" role="dialog" aria-modal aria-label={c.head} onClick={(e) => e.stopPropagation()}>
        <AskHead c={c} who={who} />
        <h2 className="ask-words">{question}</h2>
        {edit.box || <AskEvidence c={c} open={open} readAll={<button className="link" onClick={() => setOpen(true)}>Read all</button>} />}
        {c.review && c.order && !c.order.known && <div className="mute small">So nothing is counted against the monthly limit.</div>}
        {chiefSays && <div className="chief-says"><Face who="chief" size={20} /><span><b>Chief:</b> {chiefSays}</span></div>}
        {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
        <div className="approve-btns">
          {edit.can && <button className="btn big" aria-pressed={edit.editing} onClick={edit.toggle}>{edit.editing ? 'Use the original' : 'Edit'}</button>}
          {remind && <button className="btn big ghost" onClick={() => act({ ...remind.body, remind: true })}>Remind me tomorrow</button>}
          {rest.map((x) => <button key={x.label} className="btn big" onClick={() => act(x.body)}>{x.label}</button>)}
          {yes && <button className="btn go big" disabled={edit.empty} onClick={() => act(edit.yes(yes.body))}>{yes.label}</button>}
        </div>
        {always && <button className="btn ghost always" onClick={() => act(always.body)}>{always.label}</button>}
        {c.kind === 'spend' && <p className="ask-note">Anything that costs money asks you every time.</p>}
      </div>
    </div>
  );
}
