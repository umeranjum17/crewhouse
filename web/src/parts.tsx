// The shared pieces: dot art, the ASCII moments, ask cards and the approval sheet, media, steps, the composer.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, trouble, type Json } from './api.ts';
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
/** Run an action; a failure becomes a friendly toast, never a stack trace. */
export async function attempt(fn: () => Promise<unknown>, ok?: string) {
  try { await fn(); if (ok) toast(ok); return true; } catch (e: any) { toast(FRIENDLY[trouble(e)]); return false; }
}
const FRIENDLY = {
  missing: "That isn't ready yet. It arrives with the next Crewhouse update.",
  offline: "Can't reach the home computer right now. Check it's on, then try again.",
  failed: 'That didn’t work. Please try again.',
};

// ---------- dot art ----------
export function Dots({ rows, pal, d = 6, label }: { rows: art.Bitmap; pal: art.Palette; d?: number; label?: string }) {
  return (
    <div className="dots" style={{ ['--w' as any]: rows[0].length, ['--d' as any]: `${d}px` }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {rows.flatMap((r, y) => [...r].map((k, x) => <b key={`${y}.${x}`} style={pal[k] ? { background: pal[k] } : undefined} />))}
    </div>
  );
}

/** Blinks now and then, so the crew feels alive; still when the person prefers less motion. */
function useBlink(on: boolean) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let t: any;
    const next = () => { t = setTimeout(() => { setBlink(true); t = setTimeout(() => { setBlink(false); next(); }, 170); }, 2600 + Math.random() * 2600); };
    next();
    return () => clearTimeout(t);
  }, [on]);
  return blink;
}

/** Set by the shell as it renders, so the art matches day or night without waiting a frame. */
let night = false;
export const setNight = (n: boolean) => { night = n; };

export function ChiefArt({ mood = 'idle', d = 6, dark }: { mood?: art.Mood; d?: number; dark?: boolean }) {
  const blink = useBlink(mood !== 'happy' && mood !== 'rest');
  return <Dots rows={art.chief(blink ? 'blink' : mood)} pal={dark ?? night ? art.CHIEF_PAL_NIGHT : art.CHIEF_PAL} d={d} label="Chief" />;
}
export function PalArt({ kind, mood = 'idle', d = 4, name }: { kind: art.Kind; mood?: art.Mood; d?: number; name?: string }) {
  const blink = useBlink(mood === 'idle' || mood === 'work');
  return <Dots rows={art.pal(kind, blink ? 'blink' : mood)} pal={art.palPalette(kind)} d={d} label={name} />;
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

export function Logo({ night }: { night?: boolean }) {
  return (
    <span className="logo" aria-label="Crewhouse">
      <Dots rows={art.HOUSE} pal={art.HOUSE_PAL} d={2.6} />
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

export function Composer({ placeholder, onSend, draft = '' }: { placeholder: string; onSend: (t: string) => Promise<unknown> | void; draft?: string }) {
  const [text, setText] = useState(draft);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (draft) { setText(draft); box.current?.focus(); } }, [draft]);
  const send = () => { const t = text.trim(); if (!t) return; setText(''); void onSend(t); };
  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea ref={box} rows={1} value={text} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <button className="send" aria-label="Send" disabled={!text.trim()}>↑</button>
    </form>
  );
}

// ---------- asks ----------
const answer = (c: Card, body: Json) => attempt(() => api.answer(c.id, body), body.answer === 'deny' ? 'OK, not now' : 'Done. Carrying on.');

/** The plain-language ask card on Home and in a chat. "Read it first" opens the approval sheet. */
export function AskCard({ c, who, onDone }: { c: Card; who: Helper | undefined; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const act = async (body: Json) => { if (await answer(c, body)) onDone(); };
  const [yes, ...rest] = c.choices;
  return (
    <div className="card ask">
      <div className="ask-head">
        {who && <Face who={{ ...who, mood: 'ask' }} size={36} />}
        <div><b>{c.head}</b><div className="mute small">{clock(c.at)}</div></div>
      </div>
      <p className="ask-words">{c.words}</p>
      {c.reply ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) act({ text: reply.trim() }); }}>
          <input className="input grow" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Tell ${who?.name ?? 'them'} what to do`} />
          <button className="btn go" disabled={!reply.trim()}>Send</button>
        </form>
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

/** The approval moment: who, what and where, exactly what goes out, and three choices. */
export function AskSheet({ c, who, chiefSays, onClose }: { c: Card; who: Helper | undefined; chiefSays?: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const act = async (body: Json) => { if (await answer(c, body)) onClose(); };
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet approve" role="dialog" aria-modal aria-label={c.head} onClick={(e) => e.stopPropagation()}>
        <div className="approve-face">
          {who && <span className="halo"><PalArt kind={who.kind} mood="ask" d={6} name={who.name} /></span>}
          <Pill tone="wait">{who?.name ?? 'The crew'} · {c.kind === 'spend' ? 'needs a quick OK' : 'needs your OK'}</Pill>
        </div>
        <h2>{c.words}</h2>
        {c.preview && (
          <div className={`preview ${open ? 'open' : ''}`}>
            {c.preview.head && <div className="mute small">{c.preview.head}</div>}
            <div>{c.preview.body}</div>
            {!open && <button className="link pink" onClick={() => setOpen(true)}>Read all</button>}
          </div>
        )}
        {chiefSays && <div className="chief-says"><Face who="chief" size={30} /><span><b>Chief:</b> {chiefSays}</span></div>}
        {c.kind === 'spend' && <p className="mute small">Anything that costs money asks you every time.</p>}
        <div className="approve-btns">
          {c.choices.map((x, i) => <button key={x.label} className={`btn ${i === 0 ? 'go big' : ''}`} onClick={() => act(x.body)}>{x.label}</button>)}
        </div>
      </div>
    </div>
  );
}
