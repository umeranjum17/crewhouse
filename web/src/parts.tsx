// The shared pieces: dot art, the ASCII moments, ask cards and the approval sheet, media, steps, the composer.
import { createPortal } from 'react-dom';
import { createElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from 'react';
import { api, trouble, type Json } from './api.ts';
import { draftOf, keepDraft, sent } from './draft.ts';
import { SHARE_CACHE, SHARE_KEEP, sharedKey } from './share-in.ts';
import { ears, hear, speak, voices, type Ears } from './voice.ts';
import { cycle, type Focused } from './dialog.ts';
import { chatTokens, safeLink } from './chat-md.ts';
import * as art from './art.ts';
import { MARKS } from './logos.ts';
import { ICONS, type IconName } from './icons.ts';
import { VOICE_WORDS, clock, deckFile, deck as deckView, docLinks, document as docView, fileSize, fileSource, fileTarget, fileView, flowed, mdPlain, pageWords, sentFile, slideWords, timeOf, workbook, type Card, type CampaignOutcome, type Chart, type DeckView, type DocPart, type DocView, type FileView, type Helper, type Sheet, type Step, type Workbook } from './adapter.ts';

/** Markdown inline runs, from the shared safe tokens (web/src/chat-md.ts): no raw HTML, http(s) links only. */
const mdInline = (tokens: any[]): ReactNode => tokens.map((t, i) => t.type === 'strong' ? <strong key={i}>{mdInline(t.tokens)}</strong>
  : t.type === 'em' ? <em key={i}>{mdInline(t.tokens)}</em>
  : t.type === 'link' && safeLink(t.href) ? <a className="chat-link" key={i} href={safeLink(t.href)} target="_blank" rel="noopener noreferrer">{mdInline(t.tokens)}</a>
  : t.type === 'codespan' ? <code className="chat-code" key={i}>{t.text}</code>
  : t.type === 'br' ? <br key={i} />
  : t.type === 'html' ? t.raw : t.tokens ? <span key={i}>{mdInline(t.tokens)}</span> : t.text ?? t.raw);
/** Markdown blocks from the same tokens: headings, paragraphs, task lists with read-only ticks, tables. */
const mdBlocks = (tokens: any[]): ReactNode => tokens.map((t, i) => t.type === 'heading' ? <h3 key={i}>{mdInline(t.tokens)}</h3>
  : t.type === 'paragraph' || t.type === 'text' ? <p key={i}>{mdInline(t.tokens ?? [{ text: t.text }])}</p>
  : t.type === 'list' ? (t.ordered ? <ol key={i} start={t.start || 1}>{t.items.map((item: any, j: number) => <li key={j}>{item.task && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? 'Done' : 'Not done'} />} {mdBlocks(item.tokens.filter((x: any) => x.type !== 'checkbox'))}</li>)}</ol>
    : <ul key={i}>{t.items.map((item: any, j: number) => <li key={j}>{item.task && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? 'Done' : 'Not done'} />} {mdBlocks(item.tokens.filter((x: any) => x.type !== 'checkbox'))}</li>)}</ul>)
  : t.type === 'blockquote' ? <blockquote key={i}>{mdBlocks(t.tokens)}</blockquote>
  : t.type === 'table' ? <div className="chat-table" key={i}><table><thead><tr>{t.header.map((c: any, j: number) => <th key={j}>{mdInline(c.tokens)}</th>)}</tr></thead><tbody>{t.rows.map((row: any[], j: number) => <tr key={j}>{row.map((c, k) => <td key={k}>{mdInline(c.tokens)}</td>)}</tr>)}</tbody></table></div>
  : t.type === 'code' ? <pre className="chat-pre" key={i}><code>{t.text}</code></pre>
  : t.type === 'html' ? <p key={i}>{t.raw}</p> : null);

/** Chat markdown without raw HTML or arbitrary URL schemes. The newest reply stays open in full behind no
 *  fold; older long answers stay available behind More. */
export function ChatText({ text, latest }: { text: string; latest?: boolean }) {
  const [more, setMore] = useState(false);
  const long = !latest && (text.length > 700 || text.split('\n').length > 10);
  // A cut inside a list item drops that item, so the fold never ends on an empty or half-cut bullet.
  const shown = long && !more ? text.slice(0, 650).replace(/\s+\S*$/, '').replace(/\n[ \t]*(?:[-*+]|\d+[.)])(?:[ \t][^\n]*)?$/, '') : text;
  return <div className="chat-md">{mdBlocks(chatTokens(shown))}{long && <button className="chat-more" onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</button>}</div>;
}

// ---------- toasts ----------
type Said = { m: string; act?: { label: string; run: () => void } };
const listeners = new Set<(s: Said) => void>();
/** A short line at the foot of the screen: "Sent", "Connecting apps comes with the next update". `act` adds one tap
 *  ("Reload"), and the line then stays a little longer so there is time to tap it. */
export const toast = (m: string, act?: Said['act']) => listeners.forEach((l) => l({ m, act }));
export function Toasts() {
  const [s, setS] = useState<Said | null>(null);
  useEffect(() => {
    let t: any;
    const l = (x: Said) => { setS(x); clearTimeout(t); t = setTimeout(() => setS(null), x.act ? 12_000 : 3200); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return s ? <Toast>{s.act ? <><span>{s.m}</span><button type="button" className="toast-act" onClick={() => { s.act!.run(); setS(null); }}>{s.act.label}</button></> : s.m}</Toast> : null;
}
/** Every toast sits in one place, never over the words: just above the box you type in where the screen has one,
 *  else in a bar along the foot of the screen, with room left below the page so its end clears the bar. */
function Toast({ children }: { children: ReactNode }) {
  const [, moved] = useState(0); // a toast still up when the screen changes moves to the new screen's place
  useEffect(() => { const f = () => requestAnimationFrame(() => moved((n) => n + 1)); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const dock = Array.from(document.querySelectorAll<HTMLElement>('.dock')).find((d) => d.offsetParent);
  return dock ? createPortal(<div className="toast" role="status">{children}</div>, dock) : <div className="toast foot" role="status">{children}</div>;
}
/** Run an action; a failure becomes a friendly toast, never a stack trace. `quiet` leaves the word to the caller —
 *  the composer, whose failed send keeps the words on screen with a Retry instead. */
export async function attempt(fn: () => Promise<unknown>, ok?: string, quiet = false) {
  try { await fn(); if (ok) toast(ok); return true; } catch (e: any) { if (!quiet) toast(e?.status === 409 ? e.message : FRIENDLY[trouble(e)]); return false; }
}
const FRIENDLY = {
  missing: "That isn't ready yet. It arrives with the next Crewhouse update.",
  offline: "Can't reach the home computer right now. Check it's on, then try again.",
  failed: 'That didn’t work. Please try again.',
  noauth: 'Open Crewhouse from this computer’s app menu.',
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

/** Set by the shell while the home computer isn't answering: every composer keeps its words and holds Send. */
let away = false;
export const setAway = (a: boolean) => { away = a; };
/** The shell installs the office's live moods once: every size and screen reads the same face state. */
let chiefMood: art.Mood = 'idle', faceMoods = new Map<string, art.Mood>(), talking = new Set<string>(), reducedFaces = false;
export const setFaceMoods = (m: art.Mood, crew: { id: string; mood: art.Mood }[], writing: string[] = [], reduced = false) => {
  chiefMood = m; faceMoods = new Map(crew.map((c) => [c.id, c.mood])); talking = new Set(writing); reducedFaces = reduced;
};
function useFaceArt(who: art.Kind | 'chief', mood: art.Mood = 'idle', id?: string, aspect = 1) {
  const live = (id && faceMoods.get(id)) || mood, mode = art.faceOf(live);
  // Embedded SVG media queries do not reliably update with the page's preference override.
  const motion = reducedFaces ? 'still' : art.motionOf(live, !!id && talking.has(id));
  const phase = useRef({ motion, turn: 0 });
  if (phase.current.motion !== motion) phase.current = { motion, turn: phase.current.turn + 1 };
  // A fresh image per transition replays one-shots, never on each streamed word or snapshot refresh.
  const instance = `${useId()}-${phase.current.turn}`;
  const svg = useMemo(() => art.critter(who, mode, { aspect, motion, instance }), [who, mode, aspect, motion, instance]);
  return { svg, mode, motion };
}

/** A B1 drawing (art.ts) as a picture: crisp at any size, and never markup in the page. Sized by width only: the
 *  height follows the drawing's own viewBox, so no box ever squashes it. */
export function Ink({ svg, w, label, className = '' }: { svg: string; w: number; label?: string; className?: string }) {
  return <img className={`ink ${className}`} src={`data:image/svg+xml,${encodeURIComponent(svg)}`} width={w} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} />;
}

/** A Geo face (art.critter) in the box the text helmet filled: `cols` art-font columns (0.6em each) by half as many
 *  lines, so the slot's font size, and every rule that sets it, still sizes the face and no layout moves. */
function Critter({ who, mood, id, cols, label, d, mascot }: { who: art.Kind | 'chief'; mood: art.Mood; id?: string; cols: number; label: string; d?: number; mascot?: boolean }) {
  const { svg, mode, motion } = useFaceArt(who, mood, id, mascot ? 100 / 92 : 1.2);
  if (mascot) return <Ink className="helmet" w={52} label={label} svg={svg} />;
  return <img className="art helmet" data-mode={mode} data-motion={motion} src={`data:image/svg+xml,${encodeURIComponent(svg)}`} alt={label} draggable={false}
    style={{ display: 'block', width: `${cols * 0.6}em`, height: `${Math.round(cols / 2)}em`, fontSize: d }} />;
}

/** Chief and helpers keep their old boxes; the same Little nudge SVG serves every size. */
export function ChiefArt({ mood = 'idle', d = 6, whole, mascot }: { mood?: art.Mood; d?: number; dark?: boolean; whole?: boolean; mascot?: boolean }) {
  return <Critter who="chief" mood={mood} id="chief" cols={whole ? 38 : 24} label="Chief" d={whole ? undefined : d} mascot={mascot} />;
}
export function PalArt({ kind, mood = 'idle', d = 4, name, id }: { kind: art.Kind; mood?: art.Mood; d?: number; name?: string; id?: string; crisp?: boolean }) {
  return <Critter who={kind} mood={mood} id={id} cols={14} label={name ?? kind} d={d} />;
}

/** A round face: Chief or a helper, with a ring when it's working or needs you. The Geo face is its own black disc. */
export function Face({ who, size = 44, ring = '' }: { who: Helper | 'chief' | { id?: string; kind: art.Kind; name: string; mood?: art.Mood }; size?: number; ring?: string; row?: boolean }) {
  const chief = who === 'chief', look = chief ? 'chief' : who.kind;
  const { svg, motion } = useFaceArt(look, chief ? chiefMood : who.mood, chief ? 'chief' : who.id);
  return (
    <span className={`face ${ring}`} data-motion={motion} style={{ width: size, height: size }}>
      <Ink svg={svg} w={size} label={chief ? 'Chief' : who.name} />
    </span>
  );
}

/** One B1 line icon (icons.ts), in the text's colour. */
// Each mark is a constant from icons.ts, drawn as elements (never markup): `<path d="…"/>` -> createElement('path', {d}).
const marks = (src: string) => [...src.matchAll(/<(\w+)([^>]*)\/>/g)].map(([, tag, attrs], i) =>
  createElement(tag, { key: i, ...Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])) }));
export const Icon = ({ name, size = 16 }: { name: IconName; size?: number }) =>
  <svg className="lucide" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{marks(ICONS[name])}</svg>;

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
    if (!on) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let i: ReturnType<typeof setInterval> | undefined;
    const sync = () => { clearInterval(i); if (!motion.matches) i = setInterval(() => setT((x) => x + 1), ms); };
    sync(); motion.addEventListener('change', sync);
    return () => { clearInterval(i); motion.removeEventListener('change', sync); };
  }, [ms, on]);
  return t;
}

/** Chief types on a tiny laptop while the crew works. */
export function Laptop() {
  const t = useTicker(150);
  return <pre className="art laptop" aria-hidden>{art.laptop(t)}</pre>;
}

/** ?splash keeps the boot splash up, for design review. */
const holdSplash = typeof location !== 'undefined' && new URLSearchParams(location.search).has('splash');
/** The boot splash (Stack J01a): Chief, the name, and four bars that fill while the crew wakes. */
export function Splash({ done: ready }: { done: boolean }) {
  const done = ready && !holdSplash;
  const t = useTicker(110);
  const [gone, setGone] = useState(false);
  useEffect(() => { if (done) { const x = setTimeout(() => setGone(true), 450); return () => clearTimeout(x); } }, [done]);
  if (gone) return null;
  const at = done ? 4 : Math.min(3.5, 0.6 + t * 0.05);
  return (
    <div className={`splash ${done ? 'out' : ''}`} role="status" aria-label="Opening Crewhouse">
      <div className="splash-in">
        <Face who="chief" size={160} />
        <b className="wide">Crewhouse</b>
        <span className="splash-line">Waking the crew…</span>
        <span className="splash-bars" aria-hidden>{[0, 1, 2, 3].map((i) => <i key={i}><u style={{ width: `${Math.max(0, Math.min(1, at - i)) * 100}%` }} /></i>)}</span>
      </div>
    </div>
  );
}

/** A finished job, said once: a calm toast with a way in — never a full-screen party. Gone within 4 s. */
export function Celebrate({ title, href, onDone }: { title: string; href: string; onDone: () => void }) {
  useEffect(() => { const x = setTimeout(onDone, 4000); return () => clearTimeout(x); }, [onDone]);
  return <Toast>✓ {title} · <a href={href} onClick={onDone}>Open</a></Toast>;
}

// ---------- small things ----------
export function Pill({ tone = 'ok', live, children }: { tone?: 'ok' | 'wait' | 'off'; live?: boolean; children: ReactNode }) {
  return <span className={`pill ${tone}${live ? ' live' : ''}`}><i />{children}</span>;
}

/** Crewd's own check on a suggested change, read as a verdict and not a quiet line: what the check found, when it ran,
 *  which run is current when a newer one overturned an older, and — when it did not pass — one tap that reopens the very
 *  same job with those findings still in hand. A dead end is the one thing this card never is. */
export function ReviewCard({ f }: { f: FileView }) {
  const r = f.review!, bot = fileSource(f.url)?.bot ?? '';
  const [busy, setBusy] = useState(false);
  const again = async () => {
    setBusy(true);
    try { await api.again(bot, r.task); dispatchEvent(new HashChangeEvent('hashchange')); } finally { setBusy(false); }
  };
  // What the check found, and which run counts, are already the thread's own line right above this card.
  // The card says it once more would be twice: the verdict, when, and the way back.
  return <div className={`review ${r.ok ? 'ok' : 'bad'}`} role={r.ok ? undefined : 'alert'}>
    <b>{r.ok ? 'Its check passed' : 'Its check did not pass'}</b>
    {`Checked ${clock(r.when)}.`}
    {!r.ok && <button className="btn go" disabled={busy} onClick={again}>{busy ? 'Starting again…' : 'Start it again'}</button>}
  </div>;
}

export function Media({ f, big, forget, who }: { f: FileView; big?: boolean; forget?: boolean; who?: Maker }) {
  const [play, setPlay] = useState(false);
  if (f.kind === 'image') return <a href={f.url} target="_blank" rel="noreferrer" className="media"><img src={f.url} alt={f.name} /></a>;
  if (f.review) return <div className="with-review"><a className="doc" href={f.url} target="_blank" rel="noreferrer"><span className="doc-ic">▤</span><span className="grow"><span className="doc-name" title={f.name}>{f.name}</span></span><b>Open</b></a><ReviewCard f={f} /></div>;
  if (f.kind === 'sheet' || f.kind === 'page') return <PreviewCard f={f} big={big} forget={forget} who={who} />;
  if (f.kind === 'video') {
    return play
      ? <video className="media" src={f.url} controls autoPlay />
      : <button className={`media cover ${big ? 'big' : ''}`} onClick={() => setPlay(true)} aria-label={`Play ${f.name}`}><span>{f.name}</span><i>▶</i></button>;
  }
  // A sent file (a PDF, a receipt, a letter): its name, what kind it is and how big, then Open. A kept unlocked copy
  // says so on the same sub line, so its name stays the file's own name and never clips under a suffix.
  const at = fileSource(f.url)?.path ?? '', copy = /^files\/unlocked\//.test(at), chip = fileTarget(f)?.chip,
    sub = [chip, f.size ? fileSize(f.size) : '', copy ? 'unlocked' : ''].filter(Boolean).join(' · ');
  const card = <a href={f.url} target="_blank" rel="noreferrer" className="doc"><span className="doc-ic" aria-hidden>▤</span><span className="grow"><span className="doc-name" title={f.name}>{f.name}</span>{sub && <span className="mute small doc-sub">{sub}</span>}</span><b>Open</b></a>;
  return forget && sentFile(f) ? <div className="file-with-forget">{card}<ForgetFile f={f} /></div> : card;
}

/** "Forget this file": the person takes one file out of the helper's folder themselves. One tap arms it, the next
 *  does it; nothing else in that folder changes, and the file's own card leaves the chat with it. */
export function ForgetFile({ f }: { f: FileView }) {
  const src = fileSource(f.url), [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await api.forgetFile(src!.bot, src!.path); }
    catch (e: any) { toast(e?.status ? e.message : "Can't reach the home computer right now."); setArmed(false); }
    finally { setBusy(false); }
  };
  return armed
    ? <span className="forget-file"><button className="link" disabled={busy} onClick={() => void run()}>{busy ? 'Removing…' : 'Forget it'}</button><button className="link mute" onClick={() => setArmed(false)}>Keep</button></span>
    : <button className="link forget-file" onClick={() => setArmed(true)}>Forget this file</button>;
}

// ---------- previews: spreadsheets and documents crewd read for the app ----------
/** crewd reads a delivered file with its own copy of the library (web/src/adapter.ts, docs/ui-contract.md); the card and
 *  the panel open the same file, so they share one read instead of asking the home computer twice. */
const previews = new Map<string, Promise<Json>>();
function usePreview(f: FileView) {
  const [read, setRead] = useState<{ book: Workbook | null; doc: DocView | null; deck: DeckView | null; text: string | null }>({ book: null, doc: null, deck: null, text: null });
  useEffect(() => {
    const src = fileSource(f.url);
    if (!src || !['sheet', 'page'].includes(f.kind)) return;
    let on = true;
    let got = previews.get(f.url);
    if (!got) previews.set(f.url, got = f.kind === 'sheet' ? api.workbook(src.bot, src.path) : api.document(src.bot, src.path));
    got.then((j) => on && setRead(f.kind === 'sheet' ? { book: workbook(j, f.name), doc: null, deck: null, text: null }
      : deckFile(f) ? { book: null, doc: null, deck: deckView(j, f.name), text: null }
      : typeof j?.text === 'string' ? { book: null, doc: null, deck: null, text: mdPlain(j.text) }
      : { book: null, doc: docView(j, f.name), deck: null, text: null }))
      .catch(() => on && setRead({ book: null, doc: null, deck: null, text: null }));
    return () => { on = false; };
  }, [f.url, f.name]);
  return read;
}

const bare = (t: string) => t.toLowerCase().replace(/^the\s+|[^a-z0-9]/g, '');
/** The line under a file's name: what kind of thing it is, and how much is in it. */
const KIND = { sheet: 'Spreadsheet', page: 'Document', image: 'Picture', video: 'Video' };
const kindOf = (f: FileView, deck: DeckView | null) => deck ? 'Deck' : f.kind === 'doc' ? fileTarget(f)?.chip ?? 'File' : KIND[f.kind];
function aboutFile(f: FileView, book: Workbook | null, doc: DocView | null, deck: DeckView | null) {
  const kind = kindOf(f, deck);
  if (book) {
    const rows = book.sheets.reduce((n, s) => n + (s.total ? s.total - 1 : s.rows.length), 0) // `total` counts the heading row;
    return rows ? `${kind} · ${rows === 1 ? '1 row' : `${rows} rows`}` : kind;
  }
  const count = deck ? deck.slides.length : doc?.parts.filter((p) => p.kind === 'heading' && bare(p.text ?? '') !== bare(f.name)).length ?? 0;
  return count ? `${kind} · ${deck ? slideWords(count) : pageWords(count)}` : kind;
}

/** A page's peek: its first heading that is not the title said twice, then the first few lines under it, as written. A
 *  written page (.md) reads the same way from its own lines. */
function pagePeek(name: string, doc: DocView | null, text: string | null) {
  const parts: DocPart[] = doc?.parts ?? (text ?? '').split('\n').filter((l) => l.trim())
    .map((l) => ({ kind: /^#/.test(l) ? 'heading' : 'p', text: l.replace(/^[#>*\-\s]+/, '') }));
  const at = parts.findIndex((p) => p.kind === 'heading' && bare(p.text ?? '') !== bare(name));
  const lines = parts.slice(at + 1).filter((p) => p.kind === 'p' || p.kind === 'li').slice(0, 3).map((p) => p.text ?? '');
  return { head: at < 0 ? '' : parts[at].text ?? '', lines };
}

/** The card's peek inside: a sheet's top-left corner as a small grid, tinted the way the panel is, or a page's heading
 *  over its first lines as written. Nothing to peek at yet (still opening, or empty) shows nothing. */
export function Thumb({ name, book, doc, deck, text }: { name: string; book: Workbook | null; doc: DocView | null; deck: DeckView | null; text: string | null }) {
  const s = book?.sheets[0];
  if (s && [s.head, ...s.rows].some((r) => r.some(Boolean))) {
    const rows = [s.head, ...s.rows].slice(0, 3);
    const cols = [...Array(Math.min(3, Math.max(...rows.map((r) => r.length)))).keys()];
    return <span className="wb-thumb" aria-hidden style={{ gridTemplateColumns: `repeat(${cols.length}, auto)` }}>{rows.flatMap((r, j) => cols.map((c) =>
      <i key={`${j}-${c}`} className={j ? cell(r[c]) : 'head'}>{j ? money(s.head[c], r[c]) : r[c] ?? ''}</i>))}</span>;
  }
  const first = deck?.slides[0];
  const page = first ? { head: first.title, lines: first.lines.slice(0, 3) } : doc || text ? pagePeek(name, doc, text) : null;
  if (!page || (!page.head && !page.lines.length)) return null;
  return <span className="wb-thumb leaf" aria-hidden>
    {page.head && <b>{page.head}</b>}
    {page.lines.map((l, i) => <span key={i} className="ln">{l}</span>)}
  </span>;
}

/** Who made a file: a helper, or Chief himself. Their card colour and name. */
type Maker = Helper | 'chief';
export const tint = (who?: Maker) => who ? { background: art.colourOf(who === 'chief' ? 'chief' : who.kind) } : undefined;
const nameOf = (who: Maker) => who === 'chief' ? 'Chief' : who.name;

/** A finished file the helper made, in the chat or in Your things: a peek inside, what kind of file it is, its name,
 *  and Open. Given the helper who made it, it is that helper's colour card with their face (Stack J07a). */
export function PreviewCard({ f, big, forget, who, meta }: { f: FileView; big?: boolean; forget?: boolean; who?: Maker; meta?: string }) {
  const { book, doc, deck, text } = usePreview(f);
  const t = fileTarget(f), out = !t?.href.startsWith('#');
  const card = (
    <a className={`wb-card${big ? ' big' : ''}${who ? ` wb-made${who === 'chief' ? ' wb-chief' : ''}` : ''}`} style={tint(who)} href={t?.href}
      target={out ? '_blank' : undefined} rel={out ? 'noreferrer' : undefined} aria-label={`Open ${f.name}`}>
      {who ? <Face who={who} /> : <span className={`wb-ic wb-${f.kind}`} aria-hidden>{t?.chip.slice(0, 4)}</span>}
      <span className="grow wb-what"><b>{f.name}</b><span className="mute small">{meta ? `${kindOf(f, deck)} · ${meta}` : aboutFile(f, book, doc, deck)}</span></span>
      {f.kind === 'image' ? <img className="wb-picture" src={f.url} alt="" /> : <Thumb name={f.name} book={book} doc={doc} deck={deck} text={text} />}
      <span className="wb-open">Open</span>
    </a>
  );
  return forget && sentFile(f) ? <div className="file-with-forget">{card}<ForgetFile f={f} /></div> : card;
}

/** A job just finished, in Chief's thread (Stack J16a): its maker's colour and face, Done., the thread's own words for
 *  what came of it, a peek inside, then Open it or Later. Either one settles it into the plain file card. */
export function DoneCard({ f, who, text, settle }: { f: FileView; who: Maker; text: string; settle: (later: boolean) => void }) {
  const { book, doc, deck, text: md } = usePreview(f);
  return <section className={`done-card${who === 'chief' ? ' wb-chief' : ''}`} style={tint(who)} aria-label={`Done: ${f.name}`}>
    <Face who={who} size={96} />
    <div className="done-say"><h2>Done.</h2><p>{text}</p></div>
    <Thumb name={f.name} book={book} doc={doc} deck={deck} text={md} />
    <div className="done-go"><a className="done-open" href={fileTarget(f)?.href} onClick={() => settle(false)}>Open it</a>
      <button type="button" className="done-later" onClick={() => settle(true)}>Later</button></div>
  </section>;
}

const HUES = ['var(--go)', 'var(--ok)', 'var(--amber)', 'var(--danger)', 'var(--ink2)', 'var(--line2)'];
const num = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });
/** A chart the helper put in the sheet, drawn from the numbers crewd read out of it: bars, a line, or a pie, with a
 *  legend in words under it. The downloaded file holds the real chart. */
export function SheetChart({ c }: { c: Chart }) {
  const W = 480, H = 240, L = 48, R = 12, T = 12, B = 30, n = Math.max(1, c.labels.length);
  const all = c.series.flatMap((s) => s.values), step = 10 ** Math.floor(Math.log10(Math.max(1, ...all.map(Math.abs))));
  const top = Math.ceil(Math.max(0, ...all) / step) * step, low = Math.floor(Math.min(0, ...all) / step) * step, span = top - low || 1; // round ends: 0 to 500, not 455
  const y = (v: number) => T + ((top - v) / span) * (H - T - B), band = (W - L - R) / n, x = (i: number) => L + (i + 0.5) * band;
  const every = Math.ceil(n / Math.floor((W - L - R) / 56)), short = (t: string) => (t.length > 8 ? `${t.slice(0, 7)}…` : t);
  const pie = c.series[0]?.values.map((v) => Math.max(0, v)) ?? [], sum = pie.reduce((a, b) => a + b, 0) || 1;
  let turn = 0;
  const keys = c.type === 'pie' ? c.labels.map((l, i) => `${l} ${Math.round((pie[i] ?? 0) / sum * 100)}%`) : c.series.length > 1 ? c.series.map((s) => s.name) : [];
  return <figure className="wb-chart">
    {c.title && <figcaption>{c.title}</figcaption>}
    <svg className={`wb-${c.type}`} viewBox={c.type === 'pie' ? '0 0 240 240' : `0 0 ${W} ${H}`} role="img" aria-label={`${c.type === 'pie' ? 'Pie' : c.type === 'bar' ? 'Bar' : 'Line'} chart${c.title ? `: ${c.title}` : ''}`}>
      {c.type === 'pie' ? pie.map((v, i) => {
        const a = (turn / sum) * 2 * Math.PI, b = ((turn += v) / sum) * 2 * Math.PI, p = (t: number) => `${120 + 110 * Math.sin(t)} ${120 - 110 * Math.cos(t)}`;
        return v >= sum ? <circle key={i} cx="120" cy="120" r="110" fill={HUES[i % 6]} />
          : <path key={i} d={`M120 120L${p(a)}A110 110 0 ${b - a > Math.PI ? 1 : 0} 1 ${p(b)}Z`} fill={HUES[i % 6]} />;
      }) : <>
        {[top, (top + low) / 2, low].map((v) => <g key={v} className="wb-axis"><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end">{num(v)}</text></g>)}
        {c.labels.map((l, i) => i % every ? null : <text key={i} className="wb-axis" x={x(i)} y={H - 10} textAnchor="middle">{short(l)}</text>)}
        {c.series.map((s, k) => c.type === 'bar'
          ? s.values.slice(0, n).map((v, i) => { const w = (band * 0.7) / c.series.length;
            return <rect key={`${k}-${i}`} x={x(i) - band * 0.35 + k * w} width={w - 1} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={HUES[k]} rx="2" />; })
          : <polyline key={k} points={s.values.slice(0, n).map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={HUES[k]} strokeWidth="2.5" strokeLinejoin="round" />)}
      </>}
    </svg>
    {keys.length > 0 && <ul className="wb-legend">{keys.map((k, i) => <li key={i}><i style={{ background: HUES[i % 6] }} />{k}</li>)}</ul>}
  </figure>;
}

/** A cell's look: what the helper filled in, a sum it worked out, or a number, which reads from the right. */
/** A sum in a column its header calls money reads to the penny (42.50), as a bill does; the file keeps its own number.
 *  ponytail: the header's words decide, so a "Total visits" column reads 3.00; read the file's number format when one matters. */
const money = (head = '', v = '') => /amount|cost|price|total|fee|balance|spent|budget|owed|[£$€]/i.test(head) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v).toFixed(2) : v;
const cell = (v = '', role = '') => [role, /^[-+(]?[£$€]?\d[\d,.]*%?\)?$/.test(v.trim()) ? 'n' : ''].filter(Boolean).join(' ') || undefined;

/** One sheet as a table, read-only: its own header row on top, each cell tinted by its role, and what is not shown
 *  said under it. */
export function SheetTable({ s }: { s: Sheet }) {
  const cols = [...Array(Math.max(...[s.head, ...s.rows].map((r) => r.length))).keys()];
  const more = s.total - s.rows.length - 1;
  return <div className="wb-rows">
    {s.charts.map((c, i) => <SheetChart key={i} c={c} />)}
    <table className="wb-grid wb-sheet">
      <thead><tr>{cols.map((c) => <th key={c} scope="col">{s.head[c] ?? ''}</th>)}</tr></thead>
      <tbody>{s.rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={cell(r[c], s.roles[i + 1]?.[c])}>{money(s.head[c], r[c])}</td>)}</tr>)}</tbody>
    </table>
    {more > 0 && <div className="mute">…and {more === 1 ? 'one more row' : `${more} more rows`}. Download it to see the whole sheet.</div>}
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

/** The body of a deck preview: one frame per slide, its title and its lines, read-only. */
function SlideBody({ deck }: { deck: DeckView }) {
  return <div className="wb-rows slide-rows">
    {deck.slides.map((s, i) => <section key={i} className="slide-frame">
      {s.title && <h3><DocText text={s.title} /></h3>}
      {s.lines.length > 0 && <ul>{s.lines.map((l, j) => <li key={j}><DocText text={l} /></li>)}</ul>}
    </section>)}
  </div>;
}

/**
 * A finished file read-only: a workbook is sheet tabs over a table; a document is its headings, paragraphs, lists and
 * tables; a deck is one frame per slide. On a desk it is a panel beside the chat it came from, or, opened from Your
 * things (`wide`), the whole page with what it is beside it; on a phone it is the whole screen above the tabs. `inline`
 * is Your things' peek at its newest file. Reading edits nothing, and Download hands over the file itself.
 */
export function PreviewPanel({ bot, path, title, onClose, inline, wide, who, made, summary }: { bot: string; path: string; title?: string; onClose: () => void; inline?: boolean; wide?: boolean; who?: Maker; made?: string; summary?: string }) {
  const box = useRef<HTMLDivElement>(null), none = useRef(null);
  const [tab, setTab] = useState(0);
  useDialogOwn(inline ? none : box, onClose);
  const f = fileView(bot, path, undefined, undefined, title);
  const { book, doc, deck, text } = usePreview(f);
  const sheets = book?.sheets ?? [];
  const s = sheets[Math.min(tab, Math.max(0, sheets.length - 1))];
  const about = aboutFile(f, book, doc, deck), t = fileTarget(f);
  const chip = <span className={`wb-ic wb-${f.kind}`} style={tint(who)} aria-hidden>{t?.chip.slice(0, 4)}</span>;
  const download = <a className={`btn wb-down${inline ? '' : ' go'}`} href={f.url} target="_blank" rel="noreferrer" download><Icon name="download" size={20} />Download</a>;
  const ask = async (words: string) => {
    const ok = await attempt(() => api.post('chief', `${words}\n\n(About “${f.name}”${who ? `, made by ${nameOf(who)}` : ''}.)`), undefined, true);
    if (ok) location.hash = '#/chief';
    return ok;
  };
  return (
    <div className={inline ? 'wb-peek' : `scrim wb-scrim${wide ? ' wb-wide' : ''}`} onClick={inline ? undefined : onClose}>
      <div ref={box} className="wb-panel" role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : true} aria-label={f.name} onClick={(e) => e.stopPropagation()}>
        {inline ? <a className="wb-file" href={t?.href}>{chip}<span className="grow wb-what"><b>{f.name}</b><span>{[about, made].filter(Boolean).join(' · ')}</span></span><Icon name="next" size={20} /></a>
          : <header className="wb-head">
            <button className="wb-close" onClick={onClose} aria-label="Close file"><Icon name="back" size={20} /></button>
            {chip}<span className="grow wb-what"><b>{f.name}</b><span>{who ? `By ${nameOf(who)}` : about}<span className="wb-ro"> · read-only</span></span></span>
            {download}
          </header>}
        <div className="wb-content"><div className="wb-reading">
          {!book && !doc && !deck && text === null && <div className="mute" role="status">Opening “{f.name}”…</div>}
          {(book && !sheets.length || doc && !doc.parts.length) && <div className="mute">There is nothing in it to show yet.</div>}
          {!inline && sheets.length > 1 && <nav className="wb-tabs" aria-label="Sheets">
            {sheets.map((x, i) => <button key={`${x.name}-${i}`} aria-pressed={x === s} className={`wb-tab${x === s ? ' on' : ''}`} onClick={() => setTab(i)}>{x.name}</button>)}
          </nav>}
          {s && <SheetTable s={s} />}
          {doc && doc.parts.length > 0 && <DocBody doc={doc} />}
          {deck && <SlideBody deck={deck} />}
          {text !== null && <div className="wb-rows doc-rows"><div className="chat-md">{mdBlocks(chatTokens(text))}</div></div>}
          {summary && !inline && <p className="wb-note"><Icon name="lock" size={20} /><span>{summary}</span></p>}
          {inline && download}
        </div>{wide && <aside className="wb-about"><div className="label">About this file</div>
          <p><b>Made by</b><span>{who ? nameOf(who) : 'The crew'}{made && `, ${made}`}</span></p><p><b>Holds</b><span>{about}</span></p>
          <div className="label">Ask about it</div><Composer placeholder="Ask Chief about this file…" onSend={ask} />
        </aside>}</div>
      </div>
    </div>
  );
}

/** "Show the work", as a friendly list of steps. */
export function Steps({ steps, max = 6, onUndo, onForget, trail }: { steps: Step[]; max?: number; onUndo?: (s: Step) => void; onForget?: (s: Step) => void; trail?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? steps : steps.slice(-max);
  if (!steps.length) return null;
  return (
    <div className={`card steps${trail ? ' trail' : ''}`}>
      {steps.length > shown.length && <button className="link" onClick={() => setAll(true)}>Show all {steps.length} steps</button>}
      {shown.map((s) => (
        <div key={s.seq} className={`step ${s.now ? 'now' : s.asked ? 'asked' : ''}`}>
          <i className="ascii" /><span className="grow">{s.text}</span>
          {onUndo && s.undo && <button className="link" onClick={() => onUndo(s)}>Undo</button>}
          {onForget && s.forget && <button className="link" onClick={() => onForget(s)}>Forget</button>}
          <time>{s.now ? 'now' : clock(s.at)}</time>
        </div>
      ))}
    </div>
  );
}

const heardWrong = (e: any) => ({ blocked: 'Allow the microphone for this page, then try again.', nomic: "I can't hear a microphone on this computer. Type instead.", offline: "The browser's online service couldn't hear you. Check the connection, or type instead." } as Record<string, string>)[e?.message] ?? "Speaking isn't ready on this computer. Type instead.";

/** The voice note to Chief: a mic in the box, on this device or the browser's online recognizer (said first). Where
 *  neither can hear, the mic says why. What was said lands in the box after what is already there, for the person to
 *  read and send; nothing is sent by speaking. */
function useVoice(on: boolean, text: string, put: (t: string) => void) {
  const [route, setRoute] = useState<Ears | null>(null);
  const [ear, setEar] = useState<{ stop: () => void } | null>(null);
  const now = useRef(text);
  now.current = text;
  useEffect(() => { if (on) void ears().then(setRoute); }, [on]);
  useEffect(() => () => ear?.stop(), [ear]); // leaving the box turns the mic off
  if (!route) return null;
  const start = () => {
    if (route === 'online') toast(VOICE_WORDS.online);
    const h = hear(route);
    setEar(h);
    setListen('chief', true);
    h.words.then((w) => { if (w) put(now.current.trim() ? `${now.current.trimEnd()} ${w}` : w); else toast("I didn't catch that. Try again."); },
      (e) => toast(heardWrong(e)))
      .finally(() => { setEar(null); setListen('chief', false); });
  };
  const off = route === 'none';
  return <button type="button" className={`mic${ear ? ' on' : ''}${off ? ' off' : ''}`} aria-label={ear ? 'Stop listening' : off ? VOICE_WORDS.none : 'Speak to Chief'} aria-pressed={!!ear}
    onClick={() => (off ? toast(VOICE_WORDS.none) : ear ? ear.stop() : start())}>{ear ? <i className="mic-stop" /> : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}</button>;
}

/** A call with Chief: his thread's lines (to read his new ones aloud) and which of them is being read. */
export type Talk = { chat: string; name: string; lines: { id: number; from: string; text: string }[]; reading: (id: number) => void };
type Now = { phase: 'listening' | 'thinking' | 'speaking'; words: string; name: string };
/** This device's voice and speed for Chief, kept on the device (its voices are its own). */
const VOICE = 'crewhouse.voice';
const kept = (): { voice?: string; rate?: number } => { try { return JSON.parse(localStorage.getItem(VOICE) ?? '{}'); } catch { return {}; } };
const SPEEDS: [string, number][] = [['Slower', 0.8], ['Normal', 1], ['Faster', 1.25], ['Fastest', 1.5]];
const spoken = (t: string) => t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>|]+/g, '');

/** Talking with Chief: listen, send the words once the person stops, read his reply aloud, then listen again. It never
 *  listens while it reads, so it can't hear itself; Stop ends it at any point, and every word stays in the chat. */
function useCall(talk: Talk | undefined, send: (said: string) => Promise<boolean>) {
  const [route, setRoute] = useState<Ears>('none');
  const [now, setNow] = useState<Now | null>(null);
  const lines = useRef(talk?.lines ?? []);
  lines.current = talk?.lines ?? [];
  const arrived = useRef(() => {});
  const run = useRef<{ stopped: boolean; cut: () => void } | null>(null);
  useEffect(() => arrived.current(), [talk?.lines]);
  useEffect(() => { if (talk) void Promise.all([ears(), voices()]).then(([r, v]) => setRoute(v.length > 0 ? r : 'none')); }, [!!talk]);
  const stop = () => { if (!run.current) return; run.current.stopped = true; run.current.cut(); arrived.current(); };
  useEffect(() => stop, []); // leaving the chat ends the call
  const show = (n: Omit<Now, 'name'>) => { setNow({ ...n, name: talk?.name ?? 'Chief' }); if (talk?.chat === 'chief') setListen('chief', n.phase === 'listening'); };
  const start = async () => {
    const r = run.current = { stopped: false, cut: () => {} }, mark = talk?.reading ?? (() => {});
    const replies = () => lines.current.filter((l) => l.from === 'them' && l.text);
    let read = replies().at(-1)?.id ?? 0, quiet = 0, end = 'Call ended.';
    try {
      while (!r.stopped) {
        const next = replies().find((l) => l.id > read);
        if (next) { // Chief's new lines first, one at a time, before the mic opens again
          read = next.id;
          const vs = await voices();
          const s = speak(spoken(next.text), () => ({ voice: vs.find((v) => v.name === kept().voice) ?? vs[0], rate: kept().rate ?? 1 }), (w) => show({ phase: 'speaking', words: w }));
          mark(next.id); r.cut = s.stop; await s.done; mark(0);
          continue;
        }
        show({ phase: 'listening', words: '' });
        const h = hear(route, (w) => show({ phase: 'listening', words: w }));
        r.cut = h.stop;
        const said = await h.words;
        if (r.stopped) break;
        if (!said) { if (++quiet < 2) continue; end = "Call ended. I didn't hear anything."; break; }
        quiet = 0;
        show({ phase: 'thinking', words: '' });
        if (!(await send(said))) { end = 'Not sent, so the call ended. Your words are in the box.'; break; }
        await new Promise<void>((go) => { arrived.current = () => { if (r.stopped || replies().some((l) => l.id > read)) go(); }; arrived.current(); });
      }
    } catch (e) { end = heardWrong(e); }
    run.current = null; mark(0); setNow(null); if (talk?.chat === 'chief') setListen('chief', false); toast(end);
  };
  return { can: route !== 'none' && !!talk, route, now, start, stop };
}

/** The call in the box's place: what's happening, the words being heard or read, this device's voice and speed, Stop. */
function CallPanel({ now, hears, stop }: { now: Now; hears: Ears; stop: () => void }) {
  const [vs, setVs] = useState<SpeechSynthesisVoice[]>([]);
  const [pick, setPick] = useState(kept);
  useEffect(() => { void voices().then(setVs); }, []);
  const choose = (k: { voice?: string; rate?: number }) => { const n = { ...pick, ...k }; setPick(n); try { localStorage.setItem(VOICE, JSON.stringify(n)); } catch { /* kept for this call only */ } };
  const lang = (l: string) => { try { return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(l) ?? l; } catch { return l; } };
  return <div className={`call ${now.phase}`} role="group" aria-label={`Call with ${now.name}`}>
    <span className="call-state" aria-live="polite"><i aria-hidden />{{ listening: 'Listening', thinking: `${now.name} is thinking`, speaking: `${now.name} is speaking` }[now.phase]}</span>
    <details className="call-voice"><summary aria-label="Voice and speed">Voice</summary><div className="call-menu">
      <label>Voice<select value={pick.voice ?? vs[0]?.name} onChange={(e) => choose({ voice: e.target.value })}>{vs.map((v) => <option key={v.name} value={v.name}>{v.name} · {lang(v.lang)}</option>)}</select></label>
      <label>Speed<select value={pick.rate ?? 1} onChange={(e) => choose({ rate: +e.target.value })}>{SPEEDS.map(([w, r]) => <option key={r} value={r}>{w}</option>)}</select></label>
      {hears === 'device' && <p>{VOICE_WORDS.device}</p>}</div></details>
    <button type="button" className="call-stop" onClick={stop}><i className="mic-stop" />Stop</button>
    {hears === 'online' && <p className="call-heard">{VOICE_WORDS.online}</p>}
    {(now.words || now.phase === 'listening') && <p className={`call-words${now.words ? '' : ' mute'}`}>{now.words || 'Go ahead, I’m listening.'}</p>}
  </div>;
}

/** How long a send may wait unanswered before the box says the words are held, not gone. */
const HOLD_MS = 4000;

/** A file waiting to send: the picker's own name and size for its chip, its bytes for crewd (which names it itself). */
export type Pick = { name: string; type: string; size: number; data: string };
const PICK_ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.webp';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const readBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result ?? '').split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
/** A photo made small enough for the link, as the phone makes it (mobile/App.tsx `shrink`): about 1280 px wide, JPEG at
 *  quality 0.6, never upscaled. Redrawing it drops the EXIF block, so where the photo was taken goes too. Null when the
 *  browser can't decode the photo, and the caller keeps the raw file. */
async function shrinkPhoto(f: File): Promise<Pick | null> {
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return null;
  const k = Math.min(1, 1280 / bmp.width), c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  if (!g) { bmp.close(); return null; }
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // a PNG's clear pixels would come out black as a JPEG
  g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.6));
  if (!blob) return null;
  return { name: f.name.replace(/\.[^.]*$/, '') + '.jpg', type: 'image/jpeg', size: blob.size, data: await readBase64(blob) };
}
/** One picked file for crewd: a photo shrinks, anything else (or a photo that won't decode) goes as it is, and one too
 *  big is left out with a toast, never sent half-read. */
const pickOne = async (f: File): Promise<Pick | null> => {
  const shrunk = PHOTO_TYPES.includes(f.type) ? await shrinkPhoto(f).catch(() => null) : null;
  if (shrunk) return shrunk;
  if (f.size > 10 << 20) { toast(`“${f.name}” is too big; try one under 10 MB.`); return null; }
  return readBase64(f).then((data) => ({ name: f.name, type: f.type, size: f.size, data })).catch(() => null);
};
const pickFiles = (list: ArrayLike<File> | null) => Promise.all(Array.from(list ?? []).slice(0, 4).map(pickOne)).then((ps) => ps.filter((p): p is Pick => !!p?.data));
/** The photos the installed app's Share sheet sent (web/src/sw.ts holds them), each made small as a picked photo is.
 *  They stay in the share cache until `dropShared`, so a share that arrives before the person connects survives the
 *  pairing reload. Nothing when this page wasn't opened by a share. */
export async function peekShared(): Promise<Pick[]> {
  try {
    const cache = await caches.open(SHARE_CACHE), files: File[] = [];
    for (let i = 0; i < SHARE_KEEP; i++) {
      const hit = await cache.match(sharedKey(i));
      if (!hit) break;
      const blob = await hit.blob();
      files.push(new File([blob], decodeURIComponent(hit.headers.get('X-Name') ?? '') || 'Photo', { type: blob.type }));
    }
    return pickFiles(files);
  } catch { return []; }
}
/** The share is sent or put aside: its photos go. */
export const dropShared = () => caches.delete(SHARE_CACHE).catch(() => false);

/** A send handler's answer for words kept for the person, not sent and not failed (Hello asks for a name first): the box
 *  gets them back, with no Not sent line. */
export const KEPT = 'kept';
/**
 * The message box. `chat` ties it to one conversation's held draft. A send that doesn't go through keeps the words
 * here with a Retry: nothing a person typed is ever thrown away (web/src/draft.ts). A send the computer hasn't
 * answered in a few seconds says so ("Reconnecting…"), so a stall never looks like a dead button.
 */
/** Chief's box. With `chips` (the desk feed, B1) a bar under the words: attach (a PDF, a document or a photo,
 *  shown as chips until sent), a starter or two that fill the box without sending, then the mic and send. */
export function Composer({ placeholder, onSend, chat, chips, talk, stop }: { placeholder: string; onSend: (t: string, files?: Pick[]) => Promise<unknown> | unknown; chat?: string; chips?: { label: string; ask: string }[]; talk?: Talk; stop?: () => void }) {
  const [text, setText] = useState(() => (chat ? draftOf(chat).text : ''));
  const voice = useVoice(chat === 'chief', text, (t) => change(t));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<Pick[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const hold = useRef<any>(null);
  const hear = (on: boolean, words: string) => { // he listens while focused with words, 1.5 s after it ends
    clearTimeout(hold.current);
    if (on && words.trim()) setListen(chat, true);
    else hold.current = setTimeout(() => setListen(chat, false), 1500);
  };
  const change = (t: string) => { setText(t); setFailed(false); hear(focused, t); if (chat) keepDraft(chat, t); };
  const send = async () => {
    const t = text.trim(), at = picked;
    if ((!t && !at.length) || busy || away) return;
    setBusy(true); setFailed(false); setHeld(false);
    // The words leave the box the moment you send: the thread echoes them right away (and marks them sending), so
    // they are never in the box and the thread at once. A send that comes back failed puts them straight back with
    // a Retry, so nothing typed is lost.
    setText(''); setPicked([]); if (chat) keepDraft(chat, '');
    // A send still unanswered after HOLD_MS is held, not dead: say so while the same request stays in flight, so Retry
    // is only ever offered once it has settled and can never send the words twice.
    const stall = setTimeout(() => setHeld(true), HOLD_MS);
    let ok: unknown = false;
    try { ok = await onSend(t, at.length ? at : undefined); } catch { ok = false; }
    clearTimeout(stall);
    setBusy(false); setHeld(false);
    if (ok === KEPT) { change(t); setPicked(at); }
    else if (ok) { hear(focused, ''); } else { setText(t); setPicked(at); setFailed(true); if (chat) sent(chat, false, t); }
  };
  const call = useCall(talk, async (said) => {
    let ok = false;
    try { ok = !!(await onSend(said)); } catch { ok = false; }
    if (!ok) { setText(said); setFailed(true); if (chat) sent(chat, false, said); }
    return ok;
  });
  if (call.now) return <CallPanel now={call.now} hears={call.route} stop={call.stop} />;
  const choose = (list: FileList | null) => { void pickFiles(list).then((ps) => { if (ps.length) { setFailed(false); setPicked((p) => [...p, ...ps].slice(0, 4)); } }); };
  return (
    <form className={`composer${chips ? ' has-bar' : ''}`} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      {away || held ? <div className="send-away" role="status">{away ? 'Reconnecting… your words stay here until the home computer answers.' : 'Reconnecting… your message will send when the home computer answers.'}</div>
        : failed && <div className="send-failed" role="alert"><span>Not sent — it's kept here.</span><button type="button" className="btn sm" onClick={() => void send()}>Retry</button></div>}
      {picked.length > 0 && <div className="c-files">{picked.map((p, i) => <span key={`${p.name}.${i}`} className="c-file"><b>{p.name}</b><span className="mute">{(p.name.split('.').pop() ?? '').toUpperCase().slice(0, 4)} · {fileSize(p.size)}</span><button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicked((x) => x.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
      <textarea rows={1} value={text} placeholder={placeholder} aria-label={placeholder}
        onFocus={() => { setFocused(true); hear(true, text); }} onBlur={() => { setFocused(false); hear(false, text); }}
        onChange={(e) => change(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      {chips && <div className="c-bar">
        <button type="button" className="c-clip" aria-label="Attach a file" title="Attach a PDF, a document or a photo" onClick={() => picker.current?.click()}><span className="desk-only"><Icon name="clip" size={18} /></span><span className="phone-only"><Icon name="plus" size={20} /></span></button>
        <input ref={picker} type="file" multiple accept={PICK_ACCEPT} hidden tabIndex={-1} aria-hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
        {chips.slice(0, 2).map((c) => <button type="button" key={c.ask} className="c-chip clamp1" onClick={() => change(c.ask)}>{c.label}</button>)}
      </div>}
      {voice}
      {stop && !text.trim() && !picked.length
        ? <button type="button" className="send stop" aria-label="Stop" title="Stop" onClick={stop}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg></button>
        : call.can && !text.trim() && !picked.length && !busy
        ? <button type="button" className="send talk" aria-label={`Talk with ${talk?.name ?? 'Chief'}`} title={`Talk with ${talk?.name ?? 'Chief'}`} onClick={() => void call.start()}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" /></svg></button>
        // A press on Send keeps focus in the box (no blur), so the keyboard stays up after every send; the click still sends.
        : <button className="send" aria-label="Send" onPointerDown={(e) => e.preventDefault()} disabled={!away && ((!text.trim() && !picked.length) || busy)} aria-disabled={away || undefined}>↑</button>}
    </form>
  );
}

// ---------- asks ----------
export const answer = (c: Card, body: Json) => attempt(() => api.answer(c.id, body), body.change ? 'Chief will change the plan' : body.remind ? 'OK, back tomorrow' : body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

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
function CampaignPosts({ text, approved = false }: { text: string; approved?: boolean }) {
  const [copied, setCopied] = useState(-1), [error, setError] = useState('');
  const parts = text.split('\n\n---\n\n');
  const copy = async (text: string, i: number) => {
    try { if (!navigator.clipboard) throw new Error('Copy is unavailable here. Select the post text to copy it.'); await navigator.clipboard.writeText(text); setCopied(i); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not copy. Select the post text to copy it.'); }
  };
  return <div className="ev">{parts.map((part, i) => { const at = part.indexOf('\n'); return <section key={i}><b className="ev-to">{at < 0 ? '' : part.slice(0, at)}</b><div className="ev-body">{at < 0 ? part : part.slice(at + 1)}</div>{approved && parts.length === 2 && at > 0 && <button className="btn" aria-label={`Copy ${part.slice(0, at)}`} onClick={() => void copy(part.slice(at + 1), i)}>{copied === i ? 'Copied' : 'Copy post'}</button>}</section>; })}{error && <p role="alert">{error}</p>}</div>;
}

export function CampaignReceipt({ outcome: c }: { outcome: CampaignOutcome }) {
  const [text, setText] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (!c.approved) return;
    let active = true;
    void api.document(c.source.bot, c.source.path).then(async (d) => {
      const text = String(d.text ?? '').trim();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (hash !== c.source.sha) throw new Error('This is no longer the campaign you approved. Ask Chief for a fresh draft.');
      if (active) setText(text);
    }).catch((e) => active && setError(e?.status ? 'Could not read the approved campaign. Ask Chief to check its file.' : e.message));
    return () => { active = false; };
  }, [c.approved, c.source.bot, c.source.path, c.source.sha]);
  return <div className="card ask campaign"><div className="ask-head"><b>Chief</b></div><p>{c.approved ? 'Campaign approved. Ready to copy; nothing was sent.' : 'Campaign put aside. Nothing was copied or sent.'}</p>
    {error && <p role="alert">{error}</p>}{c.approved && !text && !error && <p role="status">Opening your approved posts…</p>}{text && <CampaignPosts text={text} approved />}
    {c.approved && c.poster && <><Media f={c.poster} big /><a className="btn" href={c.poster.url} download={c.poster.name}>Save poster</a></>}
  </div>;
}

function AskEvidence({ c, open, readAll }: { c: Card; open: boolean; readAll: ReactNode }) {
  const body = c.preview?.body ?? '';
  if (c.mailAction === 'draft') return <div className="ev"><ChatText text={body} /></div>;
  if (c.campaign) return <><CampaignPosts text={body} />{c.campaign.poster ? <Media f={c.campaign.poster} big /> : <p>The poster is not ready here yet.</p>}</>;
  if (c.review) return <div className="ev">{body.split('\n').map((l, i) => {
    const [text, amount] = splitAmount(l);
    return <div key={i} className={`order-row${/^Total/.test(l) ? ' total' : ''}`}>{amount ? <><span className="grow">{text}</span><span>{amount}</span></> : text}</div>;
  })}</div>;
  if (c.evidence === 'lines') return <div className="ev">{body.split('\n').filter(Boolean).map((l, i) => {
    const at = l.indexOf(': ');
    return at > 0 ? <div key={i} className="ev-line"><span>{l.slice(0, at)}</span><b>{l.slice(at + 2)}</b></div> : <div key={i}>{l}</div>;
  })}</div>;
  if (c.evidence === 'draft') {
    return <div className="ev">
      {c.mailFrom && <div className="ev-to">From {c.mailFrom}</div>}
      {c.draftTo && <div className="ev-to">To {c.draftTo}</div>}
      {c.draftSubject && <b className="ev-subject">Subject: {c.draftSubject}</b>}
      {c.draftWhy && <div className="ev-quiet">Because you said “{c.draftWhy}”</div>}
      <div className="ev-body draft-body">{body}</div>
    </div>;
  }
  if (c.hire) return <div className="ev hire-ev">
    {!!c.hire.first_job && <><div className="hire-sect">First job</div><div className="hire-job">{c.hire.first_job}</div></>}
    {!!c.hire.will_do.length && <><div className="hire-sect">Will do</div>{c.hire.will_do.map((l, i) => <div key={`w${i}`} className="hire-li">{l}</div>)}</>}
    {!!c.hire.wont_do.length && <><div className="hire-sect">Won't do</div>{c.hire.wont_do.map((l, i) => <div key={`n${i}`} className="hire-li no">{l}</div>)}</>}
    {!!c.hire.first_step && <><div className="hire-sect">First step for you</div><div className="hire-first"><b className="hire-n">1</b><span>{c.hire.first_step}</span></div></>}
    {c.lines?.filter((line) => line.startsWith('Can use: ')).map((line, i) => <div key={`app${i}`} className="hire-li">{line}</div>)}
    <div className="hire-foot"><Icon name="lock" size={20} /><span>Nothing changes until you say yes.</span></div>
  </div>;
  if (c.lines) return <div className="ev">{c.lines.map((l, i) => <div key={i} className={i && c.kind === 'routine' ? 'ev-quiet' : undefined}>{l}</div>)}</div>;
  if (c.preview) return <div className="ev">
    {c.preview.head && <div className="ev-to">{c.preview.head}</div>}
    <div className={`ev-body${open ? '' : ' clamp3'}`}>{c.preview.body}</div>
    {!open && readAll}
  </div>;
  return null;
}

/** The ask inline in the thread: the name, the status flag with the dot, then the words. No face, no clock —
 *  except a hire, which is the new helper's own header (mock 1): its face left of the title and its role under it. */
function AskHead({ c, who }: { c: Card; who: Helper | undefined }) {
  const by = c.by ?? c.helper, name = by === 'chief' ? 'Chief' : who?.name ?? c.head;
  if (c.hire) return <div className="ask-head hire-head">
    <Face who={{ kind: c.hire.kind, name: c.hire.name }} size={64} />
    <div className="grow"><b>{c.hire.name}</b>{c.hire.role ? <div className="hire-role">{c.hire.role}</div> : <div className="ask-status"><i />{c.status}</div>}</div>
  </div>;
  return <div className="ask-head">
    <Face who={by === 'chief' ? 'chief' : who ?? 'chief'} size={44} />
    <div className="grow"><b>{c.kind === 'plan' ? c.head : name}</b><div className="ask-status"><i />{c.status}</div></div>
  </div>;
}

/** A helper's draft takes the person's own words before the yes: their version replaces the draft, and still nothing
 *  is sent. `box` stands in for the evidence while editing; `yes` carries the words only when they changed, and copies
 *  the words the person sees (their edit when there is one) and opens the draft's link before today's Approve answer. */
function useDraftEdit(c: Card) {
  const [words, setWords] = useState<string | null>(null);
  const changed = words !== null && words.trim() !== c.draftText;
  return {
    can: c.evidence === 'draft' && !!c.draftText, editing: words !== null, empty: words !== null && !words.trim(),
    toggle: () => setWords(words === null ? c.draftText ?? '' : null),
    box: words !== null && <textarea className="input draft-edit" rows={8} value={words} onChange={(e) => setWords(e.target.value)} aria-label="Your version of the message" autoFocus />,
    yes: (body: Json) => {
      if (c.evidence !== 'draft' || c.mailSend) return body;
      const text = changed ? words!.trim() : c.draftText ?? '';
      void navigator.clipboard?.writeText(text).catch(() => { /* the person pastes from the card itself */ });
      if (c.draftLink) window.open(c.draftLink, '_blank', 'noopener');
      return changed ? { ...body, text } : body;
    },
  };
}

type MoreAct = { label: string; run: () => unknown; pressed?: boolean; cls?: string };
/** A card's other choices: in its row on a desk; on a phone they wait behind "⋯", which opens a bottom sheet with
 *  the card's title on top and one full-width row per choice, so a card shows one primary. */
export function More({ title, sub, acts }: { title: string; sub?: string; acts: (MoreAct | false | null | undefined)[] }) {
  const [open, setOpen] = useState(false);
  const shown = acts.filter((a): a is MoreAct => !!a);
  if (!shown.length) return null;
  return <>
    {shown.map((a) => <button key={a.label} className={`btn more-act${a.cls ? ` ${a.cls}` : ''}`} aria-pressed={a.pressed} onClick={() => void a.run()}>{a.label}</button>)}
    <button className="btn more-dots" aria-label="More choices" aria-haspopup="dialog" onClick={() => setOpen(true)}><Icon name="more" size={20} /></button>
    {open && createPortal(<MoreSheet title={title} sub={sub} acts={shown} onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function MoreSheet({ title, sub, acts, onClose }: { title: string; sub?: string; acts: MoreAct[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  return <div className="scrim" onClick={onClose}>
    <div ref={box} className="sheet more-sheet" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="more-head"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      {acts.map((a) => <button key={a.label} className="more-row" onClick={() => { onClose(); void a.run(); }}>{a.label}</button>)}
    </div>
  </div>;
}

/** What an answered card leaves in the thread: one small plain line — what was done and when — where the card was.
 *  An approval outcome instead reads as one muted pill, the action in plain words on the left and the outcome word on
 *  the right ("Placed the order at shop.example   Allowed"), like the reference. A kept memory's own line carries the
 *  way to take it back as an inline text button on the same line. */
export function AnsweredCard({ line, what, word, undo }: { line?: string; what?: string; word?: string; undo?: () => void }) {
  if (word !== undefined) return <div className="card answered receipt" role="status"><span className="receipt-what">{what}</span><span className="receipt-word">{word}</span></div>;
  return <div className="card answered" role="status">{line}{undo && <> <button className="link saved-undo" onClick={undo}>Undo</button></>}</div>;
}

/** The plain-language ask card, in the thread: one decision with the evidence in front of you. A checkout opens the
 *  review before any yes; spending always says the footer note. */
/** A site's own icon, from the site itself; its first letter when the site has none to give. */
export function SiteIcon({ site }: { site: { host: string; icon: string } }) {
  const [ok, setOk] = useState(false); // the site's letter until its icon has loaded (a slow or missing one never shows a blank tile)
  return <span className="site-ic" aria-hidden>{!ok && site.host.replace(/^www\./, '')[0]?.toUpperCase()}<img src={site.icon} alt="" referrerPolicy="no-referrer" hidden={!ok} onLoad={() => setOk(true)} /></span>;
}

/** A helper's sign-in ask: the site's name and icon and one button, which opens the helper's screen to sign in on. */
function SignInCard({ c, onDone, id }: { c: Card; onDone: () => void; id?: string }) {
  const no = () => api.answer(c.id, { answer: 'deny' }).then(onDone, () => toast("Can't reach the home computer right now."));
  return (
    <div className="card ask signin-card" id={id}>
      <div className="ask-head"><SiteIcon site={c.site!} /><div className="grow"><b>{c.head}</b><div className="ask-status"><i />{c.status}</div></div><time className="mute small">{clock(c.at)}</time></div>
      <p className="ask-words">{c.words}</p>
      <div className="btns"><a className="btn go" href={`#/ask/${c.id}`}>{c.choices[0].label}</a><More title={c.head} sub={c.status} acts={[{ label: 'Not now', run: no }]} /></div>
    </div>
  );
}

/** A helper's locked files (mock 3A): a password field per file. What is typed lives only in this card's state and the one
 *  answer that opens the files; it is cleared after every try and never stored, sent to the chat or shown to the crew. */
function UnlockCard({ c, onDone, id }: { c: Card; onDone: () => void; id?: string }) {
  const u = c.unlock!, [typed, setTyped] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [oops, setOops] = useState('');
  const [keep, setKeep] = useState(c.keep?.rule ?? 'job'); // the one plain rule: the copies go when the job ends
  const no = () => api.answer(c.id, { answer: 'deny' }).then(onDone, () => toast("Can't reach the home computer right now."));
  const go = () => {
    setBusy(true); setOops('');
    api.answer(c.id, { answer: 'allow', passwords: u.files.map((f) => typed[f.path] ?? ''), rule: keep })
      .then(onDone, (e) => { setOops(e?.status ? e.message : "Can't reach the home computer right now."); onDone(); })
      .finally(() => { setTyped({}); setBusy(false); });
  };
  return (
    <form className="card ask unlock-card" id={id} onSubmit={(e) => { e.preventDefault(); if (!busy) go(); }}>
      <div className="ask-head hire-head"><Face who={u.helper} size={40} /><div className="grow"><b>{c.head}</b><div className="hire-role">{c.status}</div></div></div>
      {u.files.map((f) => <label key={f.path} className="unlock-field"><span>{f.name}</span>
        <input className="input" type="password" autoComplete="off" placeholder="Password" value={typed[f.path] ?? ''} onChange={(e) => setTyped({ ...typed, [f.path]: e.target.value })} /></label>)}
      <p className="unlock-note"><Icon name="lock" size={16} /><span>{c.words}</span></p>
      {c.keep && <div className="unlock-keep" role="radiogroup" aria-label="How long the unlocked copies stay">
        <span>{c.keep.line}</span>
        {c.keep.options.map((o) => <label key={o.rule} className="keep-opt"><input type="radio" name={`keep-${c.id}`} value={o.rule} checked={keep === o.rule} onChange={() => setKeep(o.rule)} /><span>{o.label}</span></label>)}
      </div>}
      {oops && <div className="send-failed" role="alert">{oops}</div>}
      <div className="btns"><button className="btn go" disabled={busy || u.files.some((f) => !typed[f.path])}>{c.choices[0].label}</button><More title={c.head} sub={c.status} acts={[{ label: 'Not now', run: no }]} /></div>
    </form>
  );
}

/** A deck's style pick: the deck's first slide in each offered look, drawn with the slide-frame preview, one button
 *  per look. The tap names the look; "Not now" waits behind ⋯ like any other card, with tomorrow's reminder. */
function StyleCard({ c, who, onDone, id }: { c: Card; who: Helper | undefined; onDone: () => void; id?: string }) {
  const p = c.pick!;
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone(); else setOops(true); };
  const looks = c.choices.filter((x) => x.body.answer === 'allow');
  const deny = c.choices.find((x) => x.body.answer === 'deny');
  // A deferred "Not now" comes back on its own, like any other card's.
  const remind = deny && deny.label === 'Not now' ? { ...deny.body, remind: true } : null;
  return (
    <div className="card ask style-card" id={id}>
      <AskHead c={c} who={who} />
      <p className="ask-words">{c.words}</p>
      <div className="pick-samples" role="group" aria-label="Sample looks">
        {p.styles.map((s) => <figure key={s.id} className={`slide-frame style-${s.id}`}>
          {p.title && <h3>{p.title}</h3>}
          {p.lines.length > 0 && <ul>{p.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>}
          <figcaption>{s.label}</figcaption>
        </figure>)}
      </div>
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
      <div className="btns">
        {looks.map((x, i) => <button key={x.label} className={`btn${i === 0 ? ' go' : ''}`} onClick={() => act(x.body)}>{x.label}</button>)}
        <More title={c.head} sub={c.status} acts={[
          deny && { label: deny.label, run: () => act(deny.body) },
          remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) }]} />
      </div>
    </div>
  );
}

/** A video link's quality pick, in Chief's colour: the video's own title, where it is from, one radio row per quality (or the
 *  sound alone) with its size, and one Save for the row picked. Nothing downloads before the tap; "Not now" waits behind ⋯. */
function VideoCard({ c, who, onDone, id }: { c: Card; who: Helper | undefined; onDone: () => void; id?: string }) {
  const v = c.video!, [sel, setSel] = useState(v.choices[0].id), [oops, setOops] = useState(false), picked = v.choices.find((x) => x.id === sel) ?? v.choices[0];
  const act = async (body: Json) => { setOops(false); if (await answer(c, body)) onDone(); else setOops(true); }, save = () => act({ answer: 'allow', pick: picked.id });
  const deny = c.choices.find((x) => x.body.answer === 'deny'), remind = deny ? { ...deny.body, remind: true } : null;
  return (
    <div className="card ask stack-ask chief-ask video-ask" id={id} aria-label={c.head} style={{ '--ask-colour': art.colourOf('chief') } as CSSProperties}>
      <AskHead c={c} who={who} />
      <p className="ask-words">{c.head}</p>
      <p className="small">{v.from ? `From ${v.from}. ` : ''}{c.words}</p>
      <div role="radiogroup" aria-label="How to save it">
        {v.choices.map((x) => <button key={x.id} role="radio" aria-checked={sel === x.id} className={`pick ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
          <span className="radio" aria-hidden /><span className="grow">{x.label}</span><span className="pick-size">{x.size}</span></button>)}
      </div>
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={save}>Try again</button></div>}
      <div className="btns">
        <button className="btn go" onClick={save}>{picked.id === 'audio' ? 'Save the sound' : `Save in ${picked.label}`}</button>
        <More title={c.head} sub={c.status} acts={[
          deny && { label: deny.label, run: () => act(deny.body) },
          remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) }]} />
      </div>
    </div>
  );
}

export function AskCard({ c, who, onDone, id }: { c: Card; who: Helper | undefined; onDone: () => void; id?: string }) {
  if (c.kind === 'video') return <VideoCard c={c} id={id} who={who} onDone={onDone} />;
  if (c.kind === 'signin') return <SignInCard c={c} id={id} onDone={onDone} />;
  if (c.kind === 'unlock') return <UnlockCard c={c} id={id} onDone={onDone} />;
  if (c.kind === 'style') return <StyleCard c={c} id={id} who={who} onDone={onDone} />;
  const [reply, setReply] = useState('');
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone(); else setOops(true); };
  const yes = c.choices[0];
  const deny = c.choices.find((x) => x.body.answer === 'deny' && x !== yes);
  // A deferred "Not now" comes back on its own: "Remind me tomorrow" re-asks it from a one-shot routine.
  const remind = !c.mailSend && !c.campaign && !c.remind && deny && deny.label === 'Not now' ? { ...deny.body, remind: true } : null;
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
  const routine = c.kind === 'routine' ? c.lines : undefined;
  const title = routine ? routine[0] : question, sub = routine ? routine[1] : c.status;
  const kind = c.hire?.kind ?? ((c.by ?? c.helper) === 'chief' ? 'chief' : who?.kind ?? 'chief');
  return (
    <div className={`card ask stack-ask${c.campaign ? ' campaign' : ''}${c.kind === 'plan' ? ' plan-ask' : ''}${c.evidence === 'draft' ? ' draft-ask' : ''}${kind === 'chief' ? ' chief-ask' : ''}`} id={id} aria-label={c.head}
      style={{ '--ask-colour': art.colourOf(kind) } as CSSProperties}>
      <AskHead c={c} who={who} />
      {!routine && !c.hire && <p className="ask-words">{question}</p>}
      {edit.box || (routine ? <div className="ask-lines">{routine.map((l, i) => <p key={i} className={`ask-line${i ? ' quiet' : ''}`}>{l}</p>)}</div>
        : <AskEvidence c={c.evidence === 'draft' && c.preview ? { ...c, preview: { ...c.preview, body: c.mailSend ? c.preview.body : flowed(c.preview.body) } } : c} open={false} readAll={<a className="link" href={`#/ask/${c.id}`}>Read all</a>} />)}
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
      {away ? <p className="mute small">You can answer once the home computer is back.</p> : c.kind === 'routine' ? (
        <>
          {when !== null && <form className="row routine-edit" onSubmit={(e) => { e.preventDefault(); if (!stuck) void start(); }}>
            <input className="input grow" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When? For example: every Saturday 10am" aria-label="When" />
          </form>}
          {when !== null && preview && !preview.bad && <div className="mute small routine-note">{preview.words}.{preview.guessed ? ` Did you mean ${preview.words.split(' at ').pop()}?` : ''} First time {preview.first}. {c.zoneNote}</div>}
          {when !== null && preview?.bad && <div className="mute small routine-note">I didn't catch that time. Try “every Monday 9:00”.</div>}
          <div className="btns">
            <button className="btn go" disabled={stuck} onClick={start}>{yes?.label ?? 'Start it'}</button>
            <More title={title} sub={sub} acts={[
              !!c.schedule && { label: when === null ? 'Change time' : 'Keep the time', pressed: when !== null, run: () => setWhen(when === null ? c.schedule || '' : null) },
              deny && { label: deny.label, run: () => act(deny.body) },
              remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) }]} />
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
            <More title={title} sub={sub} acts={[
              { label: change === null ? 'Change it' : 'Keep the plan', pressed: change !== null, run: () => setChange(change === null ? '' : null) },
              deny && { label: deny.label, run: () => act(deny.body) },
              remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) }]} />
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
          <More title={title} sub={sub} acts={[
            deny && { label: deny.label, cls: 'ghost', run: () => act(deny.body) },
            remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) }]} />
        </div>
      ) : yes ? (
        <div className="btns">
          <button className="btn go" disabled={edit.empty || (c.mailSend && !c.mailUncertain) || !!c.mailTo} onClick={() => act(edit.yes(yes.body))}>{yes.label}</button>
          <More title={title} sub={sub} acts={[
            edit.can && { label: edit.editing ? 'Use the original' : 'Edit', pressed: edit.editing, run: edit.toggle },
            deny && { label: deny.label, run: () => act(deny.body) },
            remind && { label: 'Remind me tomorrow', cls: 'quiet', run: () => act(remind) },
            always && { label: always.label, cls: 'ghost always', run: () => act(always.body) }]} />
        </div>
      ) : null}
      {c.kind === 'spend' && <p className="ask-note">Anything that costs money asks you every time.</p>}
      {((c.mailSend && !c.mailUncertain) || c.mailTo) && <p className="ask-note">Approve this email on your paired phone. Nothing sends from this screen.</p>}
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
  const remind = !c.mailSend && rest.find((x) => x.label === 'Not now' && x.body.answer === 'deny');
  const always = c.choices.find((x) => x.body.scope === 'always');
  const edit = useDraftEdit(c);
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={box} className="sheet approve" role="dialog" aria-modal aria-label={c.head} onClick={(e) => e.stopPropagation()}
        style={{ '--ask-colour': art.colourOf(c.hire?.kind ?? ((c.by ?? c.helper) === 'chief' ? 'chief' : who?.kind ?? 'chief')) } as CSSProperties}>
        <div className="approve-art">
          <Face who={c.hire ? { kind: c.hire.kind, name: c.hire.name } : (c.by ?? c.helper) === 'chief' ? 'chief' : who ?? 'chief'} size={96} />
          <button className="btn approve-close" aria-label="Close" onClick={onClose}><span aria-hidden>×</span></button>
        </div>
        <div className="approve-body">
        <div className="approve-status"><span className="st-pill">Needs you</span><span>{(c.by ?? c.helper) === 'chief' ? 'Chief asks' : `Chief asks · ${who?.name ?? 'The crew'}`}</span></div>
        {c.hire && <AskHead c={c} who={who} />}
        {!c.hire && <h2 className="ask-words">{question}</h2>}
        {edit.box || <AskEvidence c={c} open={open} readAll={<button className="link" onClick={() => setOpen(true)}>Read all</button>} />}
        {c.review && c.order && !c.order.known && <div className="mute small">So nothing is counted against the monthly limit.</div>}
        {chiefSays && <div className="chief-says"><Face who="chief" size={20} /><span><b>Chief:</b> {chiefSays}</span></div>}
        {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
        <div className="approve-btns">
          {yes && <button className="btn go big" disabled={edit.empty || (c.mailSend && !c.mailUncertain) || !!c.mailTo} onClick={() => act(edit.yes(yes.body))}>{yes.label}</button>}
          {edit.can && <button className="btn big" aria-pressed={edit.editing} onClick={edit.toggle}>{edit.editing ? 'Use the original' : 'Edit'}</button>}
          {rest.map((x) => <button key={x.label} className="btn big" disabled={c.mailSend && !c.mailUncertain && x.body.answer !== 'deny'} onClick={() => act(x.body)}>{x.label}</button>)}
        </div>
        {remind && <button className="link approve-remind" onClick={() => act({ ...remind.body, remind: true })}>Remind me tomorrow</button>}
        {always && <button className="btn ghost always" onClick={() => act(always.body)}>{always.label}</button>}
        {((c.mailSend && !c.mailUncertain) || c.mailTo) && <p className="ask-note">Approve this email on your paired phone. Nothing sends from this screen.</p>}
        {c.kind === 'spend' && <p className="ask-note"><Icon name="lock" size={20} /><span>Anything that costs money asks you every time.</span></p>}
        </div>
      </div>
    </div>
  );
}
