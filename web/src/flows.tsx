// The moments that must be seamless: signing in to ChatGPT, connecting an app, and the home computer being
// out of reach. Each one is a single sheet that walks through clear states, ends in a friendly success, and has a
// plain-words way forward from every failure: opening, waiting, done, cancelled, expired, offline, unavailable.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, demo, trouble, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { ChiefArt, Dots, Face, Laptop, Pill, toast } from './parts.tsx';

type Phase = 'opening' | 'waiting' | 'done' | 'cancelled' | 'expired' | 'failed' | 'offline' | 'unavailable';
/** ?demo&phase=expired pins a flow to one state, for design review and screenshots. */
const pinned = demo ? (new URLSearchParams(location.search).get('phase') as Phase | null) : null;

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  // A portal, so a sheet opened from inside a card still covers the whole screen.
  return createPortal(<div className="scrim" onClick={onClose}><div className="sheet flow" role="dialog" aria-modal aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</div></div>, document.body);
}

/** Three little steps across the top, so nobody wonders where they are. */
function Progress({ at, steps }: { at: number; steps: string[] }) {
  return (
    <ol className="progress" aria-label={`Step ${Math.min(at + 1, steps.length)} of ${steps.length}`}>
      {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}><i>{i < at ? '✓' : i + 1}</i>{s}</li>)}
    </ol>
  );
}

function Mood({ phase, app }: { phase: Phase; app?: A.App }) {
  const mood: art.Mood = phase === 'done' ? 'happy' : phase === 'offline' ? 'rest' : phase === 'waiting' ? 'idle' : phase === 'opening' ? 'work' : 'ask';
  return (
    <div className="flow-face">
      <span className="halo"><ChiefArt mood={mood} d={5} /></span>
      {app && <span className="app-ic badge-ic" style={{ background: app.bg }}>{app.mark}</span>}
      {phase === 'opening' && <Laptop />}
      {phase === 'done' && <pre className="art sparkle" aria-hidden>{'✦  ·  ✧  ·  ✦'}</pre>}
    </div>
  );
}

/** A poll that knows when the home computer stops answering. */
function usePoll<T>(fn: () => Promise<T>, ms: number, on = true) {
  const [value, setValue] = useState<T | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const pull = () => fn().then((v) => { if (alive) { setValue(v); setOffline(false); } }).catch((e) => alive && trouble(e) === 'offline' && setOffline(true));
    pull();
    const t = setInterval(pull, ms);
    return () => { alive = false; clearInterval(t); };
  }, [on, ms]);
  return { value, offline };
}

// ---------- Sign in with ChatGPT ----------
export function SignIn({ me, owner, onReady, onClose }: { me: number; owner: string; onReady: () => void; onClose: () => void }) {
  const { value, offline } = usePoll(() => api.accounts(), 2000);
  const g = A.chatgpt(value, me);
  const [cancelled, setCancelled] = useState(false);
  const started = useRef(false);
  const start = () => { started.current = true; setCancelled(false); api.signIn(me, 'codex').catch(() => {}); };
  const live: Phase = offline ? 'offline' : cancelled ? 'cancelled' : g.state === 'ready' ? 'done' : g.state === 'unavailable' ? 'unavailable'
    : g.signing?.code ? 'waiting' : g.expired ? 'expired' : g.failed ? 'failed' : 'opening';
  const phase = pinned ?? live;
  useEffect(() => { if (!pinned && live === 'opening' && g.state === 'signed-out' && !g.signing && !started.current) start(); }, [live, g.state]);
  const cancel = () => { void api.signInCancel(me, 'codex').catch(() => {}); started.current = true; setCancelled(true); };
  const close = () => { if (phase === 'waiting' || phase === 'opening') void api.signInCancel(me, 'codex').catch(() => {}); onClose(); };
  const code = g.signing?.code || 'WB60-FFV06';
  const url = g.signing?.url || 'https://auth.openai.com/codex/device';
  const at = phase === 'done' ? 3 : phase === 'waiting' ? 1 : 0;
  return (
    <Sheet label="Sign in with ChatGPT" onClose={close}>
      {!['offline', 'unavailable'].includes(phase) && <Progress at={at} steps={['Get code', 'Sign in', 'Done']} />}
      <Mood phase={phase} />
      {phase === 'opening' && <><h2>Getting your sign-in code…</h2><p className="mute">This takes a few seconds.</p><div className="dotdot" aria-hidden><i /><i /><i /></div>
        <button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Type this code on ChatGPT's page</h2>
        <button className="code" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Code copied'), () => {})} aria-label={`Code ${code.split('').join(' ')}. Tap to copy.`}>{code}<span>Tap to copy</span></button>
        <a className="btn go big" href={url} target="_blank" rel="noreferrer">Open ChatGPT ↗</a>
        <p className="mute small">Sign in the way you always do (Google, Apple or email), then type the code. Come back here after; this moves on by itself.</p>
        <Pill tone="wait">Waiting for ChatGPT…</Pill>
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>You're signed in!</h2><p>The crew thinks with your own ChatGPT now. Your password stayed with ChatGPT.</p>
        <button className="btn go big" onClick={onReady}>Let's go</button></>}
      {phase === 'cancelled' && <><h2>No problem</h2><p className="mute">Nothing was changed. You can sign in whenever you like.</p>
        <button className="btn go big" onClick={start}>Try again</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'expired' && <><h2>That code ran out</h2><p className="mute">Codes only last a few minutes, to keep your account safe. Here's a fresh one whenever you're ready.</p>
        <button className="btn go big" onClick={start}>Get a new code</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'failed' && <><h2>That didn't go through</h2><p className="mute">ChatGPT didn't finish the sign-in. No harm done; let's try once more.</p>
        <button className="btn go big" onClick={start}>Try again</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
      {phase === 'unavailable' && <><h2>Almost ready</h2><p className="mute">ChatGPT sign-in isn't switched on at the home computer yet. Ask {owner} to open Crewhouse there once, and you're good to go.</p>
        <button className="btn go big" onClick={onClose}>OK</button></>}
    </Sheet>
  );
}

// ---------- Connect an app ----------
/**
 * Connecting an app: open the app's own sign-in page, wait while the person says yes there, then a friendly done.
 * Until crewd has connections (docs/ui-contract.md) this says so kindly instead of pretending.
 */
export function ConnectApp({ app, helper, onDone, onClose }: { app: A.App; helper?: string; onDone: () => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>(pinned ?? 'opening');
  const [url, setUrl] = useState(pinned ? 'https://accounts.google.com/' : '');
  const who = A.signsInWith(app);
  const start = () => {
    setPhase('opening');
    api.connect(app.id).then((r) => { setUrl(r?.url ?? ''); setPhase(r?.state === 'on' ? 'done' : 'waiting'); })
      .catch((e) => setPhase(trouble(e) === 'missing' ? 'unavailable' : trouble(e) === 'offline' ? 'offline' : 'failed'));
  };
  useEffect(() => { if (!pinned) start(); }, []);
  const poll = usePoll(() => api.connection(app.id), 2000, !pinned && phase === 'waiting');
  useEffect(() => {
    const s = poll.value?.state;
    if (s === 'on') setPhase('done');
    else if (s === 'expired') setPhase('expired');
    else if (s === 'failed' || s === 'cancelled') setPhase('cancelled');
    else if (poll.offline) setPhase('offline');
  }, [poll.value, poll.offline]);
  const cancel = () => { void api.disconnect(app.id).catch(() => {}); setPhase('cancelled'); };
  const at = phase === 'done' ? 3 : phase === 'waiting' ? 1 : 0;
  return (
    <Sheet label={`Connect ${app.name}`} onClose={onClose}>
      {!['offline', 'unavailable'].includes(phase) && <Progress at={at} steps={[`Open ${who}`, 'Say yes', 'Done']} />}
      <Mood phase={phase} app={app} />
      {phase === 'opening' && <><h2>Opening {who}'s page…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Say yes on {who}'s page</h2>
        <p className="mute">Sign in as you normally do, then tap <b>Allow</b>. It's {who}'s own page, so your password stays with them.</p>
        {url && <a className="btn go big" href={url} target="_blank" rel="noreferrer">Open {who} ↗</a>}
        <Pill tone="wait">Waiting for {who}…</Pill>
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>{app.name} is connected</h2><p>{app.does}</p>{helper && <p className="mute">{helper} is carrying on with it now.</p>}
        <button className="btn go big" onClick={onDone}>Done</button></>}
      {phase === 'cancelled' && <><h2>No problem</h2><p className="mute">Nothing was connected{helper ? `, and ${helper} will manage without it` : ''}. You can connect {app.name} any time.</p>
        <button className="btn go big" onClick={start}>Try again</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'expired' && <><h2>That page timed out</h2><p className="mute">{who}'s page only waits a few minutes. Let's open a fresh one.</p>
        <button className="btn go big" onClick={start}>Start again</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'failed' && <><h2>That didn't go through</h2><p className="mute">{who} didn't finish connecting. No harm done; let's try once more.</p>
        <button className="btn go big" onClick={start}>Try again</button><button className="link" onClick={onClose}>Not now</button></>}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
      {phase === 'unavailable' && <><h2>Coming very soon</h2><p className="mute">Connecting {app.name} arrives with the next Crewhouse update. {helper ? `Until then, ${helper} will find another way.` : 'Your helpers will ask for it right in the chat when it can.'}</p>
        <button className="btn go big" onClick={onClose}>OK</button></>}
    </Sheet>
  );
}

/** The in-chat offer, only when a task could use the app. */
export function ConnectCard({ c, helper, onDone }: { c: A.Card; helper?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const no = () => api.answer(c.id, { answer: 'deny' }).then(onDone, () => toast("Can't reach the home computer right now."));
  return (
    <div className="card connect">
      <span className="app-ic" style={{ background: c.app!.bg }}>{c.app!.mark}</span>
      <span className="grow">{c.words}</span>
      <button className="btn go" onClick={() => setOpen(true)}>Connect</button>
      <button className="btn ghost" onClick={no} aria-label="Not now">✕</button>
      {open && <ConnectApp app={c.app!} helper={helper} onClose={() => setOpen(false)}
        onDone={() => { setOpen(false); void api.answer(c.id, { answer: 'allow' }).catch(() => {}).then(onDone); }} />}
    </div>
  );
}

// ---------- the home computer out of reach ----------
function OfflineWords({ onClose }: { onClose: () => void }) {
  return <><h2>Can't reach the home computer</h2><p className="mute">It may be asleep, switched off, or offline. Your helpers live there, so they'll carry on the moment it's back. I'll keep trying, and pick up right here.</p>
    <Pill tone="off">Trying again…</Pill><button className="link" onClick={onClose}>Close for now</button></>;
}

/** Full screen when Crewhouse can't be reached at all: never a blank page or an error code. */
export function Unreachable({ retry, owner }: { retry: () => void; owner: boolean }) {
  const [n, setN] = useState(5);
  useEffect(() => { const t = setInterval(() => setN((x) => (x <= 1 ? (retry(), 5) : x - 1)), 1000); return () => clearInterval(t); }, [retry]);
  return (
    <div className="unreachable">
      <div className="asleep">
        <pre className="art zzz" aria-hidden>{'      z\n    z\n  z'}</pre>
        <Dots rows={art.HOUSE.map((r, i) => (i === 6 ? r.replace(/e/g, 'p') : r))} pal={art.HOUSE_PAL} d={9} label="The house, asleep" />
      </div>
      <h1>The home computer isn't answering</h1>
      <p className="lead">It may be asleep, switched off, or offline. Crewhouse and your helpers live there, so everything picks up again the moment it's back.</p>
      <div className="card tips">
        <div><Face who="chief" size={34} /><span>{owner ? 'Check the home computer is on and connected to the internet.' : 'Ask whoever looks after the home computer to check it is on.'}</span></div>
      </div>
      <button className="btn go big" onClick={() => { setN(5); retry(); }}>Try now</button>
      <p className="mute small">Trying again in {n}s</p>
    </div>
  );
}
