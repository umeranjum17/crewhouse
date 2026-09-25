// The shared pieces: dot art, the ASCII moments, ask cards and the approval sheet, media, steps, the composer.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { api, trouble, type Json } from './api.ts';
import { draftOf, keepDraft, sent } from './draft.ts';
import { cycle, type Focused } from './dialog.ts';
import * as art from './art.ts';
import { bannerStops } from './tokens.ts';
import { clock, type Card, type FileView, type Helper, type Step } from './adapter.ts';

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
export function Dots({ rows, pal, d = 6, label }: { rows: art.Bitmap; pal: art.Palette; d?: number; label?: string }) {
  return (
    <div className="dots" style={{ ['--w' as any]: rows[0].length, ['--d' as any]: `${d}px` }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {rows.flatMap((r, y) => [...r].map((k, x) => <b key={`${y}.${x}`} className={pal[k] ? 'on' : undefined} style={pal[k] ? { background: pal[k] } : undefined} />))}
    </div>
  );
}

/** Blinks now and then (Chief's moustache twitches too), so the crew feels alive; still when the person prefers less motion. */
function useBlink(on: boolean, twitch = false) {
  const [beat, setBeat] = useState<'' | 'blink' | 'twitch'>('');
  useEffect(() => {
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t: any;
    const next = () => { t = setTimeout(() => { setBeat(twitch && Math.random() < 0.3 ? 'twitch' : 'blink'); t = setTimeout(() => { setBeat(''); next(); }, 170); }, 2600 + Math.random() * 2600); };
    next();
    return () => clearTimeout(t);
  }, [on, twitch]);
  return beat;
}

/** Set by the shell as it renders, so the art matches day or night without waiting a frame. */
let night = false;
export const setNight = (n: boolean) => { night = n; };

/** Chief. `d` is sized for the old 14-dot head, so callers keep their footprint; small sizes get the 12-dot cut. */
export function ChiefArt({ mood = 'idle', d = 6, dark }: { mood?: art.Mood; d?: number; dark?: boolean }) {
  const beat = useBlink(mood === 'idle', true);
  const m = beat || mood;
  const dd = (d * 14) / 22, small = dd < 2.4;
  return <Dots rows={small ? art.chiefSmall(m) : art.chief(m)} pal={dark ?? night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={small ? (dd * 22) / 12 : dd} label="Chief" />;
}
export function PalArt({ kind, mood = 'idle', d = 4, name }: { kind: art.Kind; mood?: art.Mood; d?: number; name?: string }) {
  const beat = useBlink(mood === 'idle' || mood === 'work');
  return <Dots rows={art.pal(kind, beat === 'blink' ? 'blink' : mood)} pal={art.palPalette(kind)} d={(d * 12) / 18} label={name} />;
}

/** A round face: Chief or a pal, with a ring when it's working (green) or needs you (amber). */
export function Face({ who, size = 44, ring = '' }: { who: Helper | 'chief' | { kind: art.Kind; name: string; mood?: art.Mood }; size?: number; ring?: string }) {
  const chief = who === 'chief';
  const soft = chief ? '#fff7e8' : art.PALS[who.kind].soft;
  return (
    <span className={`face ${ring}`} style={{ width: size, height: size, background: soft }}>
      {chief ? <ChiefArt d={size / 22} /> : <PalArt kind={who.kind} mood={who.mood} d={size / 17} name={who.name} />}
    </span>
  );
}

/** The mark is Chief himself (the app icon's 12-dot cut), then the dot wordmark. */
export function Logo({ night }: { night?: boolean }) {
  return (
    <span className="logo" aria-label="Crewhouse">
      <Dots rows={art.chiefSmall()} pal={night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={2.3} />
      <Dots rows={art.WORD} pal={night ? art.WORD_PAL_NIGHT : art.WORD_PAL} d={2.3} />
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

/** The boot splash: block letters over a living field of glyphs, and Chief waking the crew. */
export function Splash({ done }: { done: boolean }) {
  const t = useTicker(110);
  const [gone, setGone] = useState(false);
  useEffect(() => { if (done) { const x = setTimeout(() => setGone(true), 450); return () => clearTimeout(x); } }, [done]);
  if (gone) return null;
  const w = art.BANNER[0].length;
  const words = 'Waking the crew…';
  return (
    <div className={`splash ${done ? 'out' : ''}`} role="status" aria-label="Opening Crewhouse">
      <pre className="art field" aria-hidden>{art.field(t, 200, 72)}</pre>
      <div className="splash-in">
        <pre className="art banner" aria-hidden>
          {art.BANNER.map((line, y) => <div key={y}>{[...line].map((c, x) => <i key={x} style={{ color: c === '█' ? art.mix(bannerStops, x / w) : 'var(--shadow)' }}>{c}</i>)}</div>)}
        </pre>
        <ChiefArt mood="work" d={7} dark />
        <Laptop />
        <div className="splash-line">{words.slice(0, Math.min(words.length, 4 + t))}<span className="cur" /></div>
      </div>
    </div>
  );
}

/** A finished job: ASCII confetti and a happy Chief, for a couple of seconds. */
export function Celebrate({ title, onDone }: { title: string; onDone: () => void }) {
  const t = useTicker(90);
  useEffect(() => { const x = setTimeout(onDone, 2600); return () => clearTimeout(x); }, [onDone]);
  return (
    <div className="celebrate" onClick={onDone} role="status">
      <pre className="art confetti" aria-hidden>
        {art.confetti(t).map((r, y) => <div key={y}>{[...r].map((c, x) => <i key={x} style={{ color: art.CONFETTI_COLORS[(x + y) % art.CONFETTI_COLORS.length] }}>{c}</i>)}</div>)}
      </pre>
      <div className="celebrate-card">
        <ChiefArt mood="happy" d={6} />
        <b>Done!</b>
        <span>{title}</span>
      </div>
    </div>
  );
}

// ---------- small things ----------
export function Pill({ tone = 'ok', children }: { tone?: 'ok' | 'wait' | 'off'; children: ReactNode }) {
  return <span className={`pill ${tone}`}><i />{children}</span>;
}

export function Media({ f, big }: { f: FileView; big?: boolean }) {
  const [play, setPlay] = useState(false);
  if (f.kind === 'image') return <a href={f.url} target="_blank" rel="noreferrer" className="media"><img src={f.url} alt={f.name} /></a>;
  if (f.kind === 'video') {
    return play
      ? <video className="media" src={f.url} controls autoPlay />
      : <button className={`media cover ${big ? 'big' : ''}`} onClick={() => setPlay(true)} aria-label={`Play ${f.name}`}><span>{f.name}</span><i>▶</i></button>;
  }
  return <a href={f.url} target="_blank" rel="noreferrer" className="doc"><span className="doc-ic">▤</span><span className="grow">{f.name}</span><b>Open</b></a>;
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
          <i /><span className="grow">{s.text}</span>
          {onUndo && s.undo && <button className="link" onClick={() => onUndo(s)}>Undo</button>}
          <time>{s.now ? 'now' : clock(s.at)}</time>
        </div>
      ))}
    </div>
  );
}

/**
 * The message box. `chat` ties it to one conversation's held draft. A send that doesn't go through keeps the words
 * here with a Retry: nothing a person typed is ever thrown away (web/src/draft.ts).
 */
export function Composer({ placeholder, onSend, chat }: { placeholder: string; onSend: (t: string) => Promise<unknown> | unknown; chat?: string }) {
  const [text, setText] = useState(() => (chat ? draftOf(chat).text : ''));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = (t: string) => { setText(t); setFailed(false); if (chat) keepDraft(chat, t); };
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    let ok = false;
    try { ok = !!(await onSend(t)); } catch { ok = false; }
    setBusy(false);
    if (ok) { setText(''); setFailed(false); if (chat) keepDraft(chat, ''); } else { setFailed(true); if (chat) sent(chat, false, text); }
  };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      {failed && <div className="send-failed" role="alert">Not sent — it's kept here. <button type="button" className="link inline" onClick={() => void send()}>Retry</button></div>}
      <textarea rows={1} value={text} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => change(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <button className="send" aria-label="Send" disabled={!text.trim() || busy}>↑</button>
    </form>
  );
}

// ---------- asks ----------
const answer = (c: Card, body: Json) => attempt(() => api.answer(c.id, body), body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

/** The plain-language ask card on Home and in a chat. A checkout opens the review before any yes. */
export function AskCard({ c, who, onDone }: { c: Card; who: Helper | undefined; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onDone(); else setOops(true); };
  const [yes, ...rest] = c.choices;
  const deny = c.choices.find((x) => x.body.answer === 'deny');
  return (
    <div className="card ask">
      <div className="ask-head">
        {who && <Face who={{ ...who, mood: 'ask' }} size={36} />}
        <div><b>{c.head}</b><div className="mute small">{clock(c.at)}</div></div>
      </div>
      <p className="ask-words">{c.words}</p>
      {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
      {c.reply ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) act({ text: reply.trim() }); }}>
          <input className="input grow" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Tell ${who?.name ?? 'them'} what to do`} />
          <button className="btn go" disabled={!reply.trim()}>Send</button>
        </form>
      ) : c.review ? (
        <div className="btns">
          <a className="btn go" href={`#/ask/${c.id}`}>Review order</a>
          {deny && <button className="btn" onClick={() => act(deny.body)}>{deny.label}</button>}
        </div>
      ) : (
        <div className="btns">
          <button className="btn go" onClick={() => act(yes.body)}>{yes.label}</button>
          {c.preview && <a className="btn" href={`#/ask/${c.id}`}>Read it first</a>}
          {!c.preview && rest.length > 1 && <a className="btn" href={`#/ask/${c.id}`}>More</a>}
          <button className="btn" onClick={() => act({ answer: 'deny' })}>Not now</button>
        </div>
      )}
    </div>
  );
}

/** The approval moment: who, what and where, exactly what goes out, and the choices. A checkout reviews the whole
 *  order here, with a yes that names it; an order without a readable total offers no yes at all. */
export function AskSheet({ c, who, chiefSays, onClose }: { c: Card; who: Helper | undefined; chiefSays?: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [oops, setOops] = useState(false);
  const last = useRef<Json | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  const act = async (body: Json) => { last.current = body; setOops(false); if (await answer(c, body)) onClose(); else setOops(true); };
  const heading = c.review && c.preview?.head ? c.preview.head : c.words;
  const lines = c.review && c.preview?.body ? c.preview.body.split('\n') : [];
  return (
    <div className="scrim" onClick={onClose}>
      <div ref={box} className="sheet approve" role="dialog" aria-modal aria-label={c.head} onClick={(e) => e.stopPropagation()}>
        <div className="approve-face">
          {who && <span className="halo"><PalArt kind={who.kind} mood="ask" d={6} name={who.name} /></span>}
          <Pill tone="wait">{who?.name ?? 'The crew'} · {c.kind === 'spend' ? 'wants to spend money' : 'needs your OK'}</Pill>
        </div>
        <h2>{heading}</h2>
        {c.review ? (
          <div className="order">
            {lines.map((l, i) => /^Total/.test(l) ? <b key={i} className="order-total">{l}</b> : <div key={i}>{l}</div>)}
            {c.order && !c.order.known && <div className="mute small">So nothing is counted against the monthly limit.</div>}
          </div>
        ) : c.preview && (
          <div className={`preview ${open ? 'open' : ''}`}>
            {c.preview.head && <div className="mute small">{c.preview.head}</div>}
            <div>{c.preview.body}</div>
            {!open && <button className="link pink" onClick={() => setOpen(true)}>Read all</button>}
          </div>
        )}
        {chiefSays && <div className="chief-says"><Face who="chief" size={30} /><span><b>Chief:</b> {chiefSays}</span></div>}
        {c.kind === 'spend' && <p className="mute small">Anything that costs money asks you every time.</p>}
        {oops && <div className="send-failed" role="alert">That didn't go through. <button type="button" className="link inline" onClick={() => last.current && act(last.current)}>Try again</button></div>}
        <div className="approve-btns">
          {c.choices.map((x, i) => <button key={x.label} className={`btn ${i === 0 ? 'go big' : ''}`} onClick={() => act(x.body)}>{x.label}</button>)}
        </div>
      </div>
    </div>
  );
}
