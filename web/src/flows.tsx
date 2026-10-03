// The moments that must be seamless: signing in to ChatGPT, connecting an app, and the home computer being
// out of reach. Each one is a single sheet that walks through clear states, ends in a friendly success, and has a
// plain-words way forward from every failure. ?demo&phase=… pins one state, for review and screenshots.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, demo, trouble, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { AiMark, AskHead, attempt, ChiefArt, Dots, Face, Laptop, Pill, toast, useDialogOwn } from './parts.tsx';

type Phase = 'opening' | 'waiting' | 'code' | 'done' | 'work' | 'busy' | 'cancelled' | 'unticked' | 'expired' | 'failed' | 'offline' | 'unavailable' | 'house';
/** ?demo&phase=expired pins a flow to one state, for design review and screenshots. */
const pinned = demo ? (new URLSearchParams(location.search).get('phase') as Phase | null) : null;
/** ?demo&sheet=signin|connect opens that sheet straight away. */
export const sheet = demo ? new URLSearchParams(location.search).get('sheet') : null;

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  // A portal, so a sheet opened from inside a card still covers the whole screen. The keyboard belongs to it while
  // it's open, the same as every other sheet (parts.tsx useDialogOwn).
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  return createPortal(<div className="scrim" onClick={onClose}><div ref={box} className="sheet flow" role="dialog" aria-modal aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</div></div>, document.body);
}

/** Three little steps across the top, so nobody wonders where they are. */
function Progress({ at, steps }: { at: number; steps: string[] }) {
  return (
    <ol className="progress" aria-label={`Step ${Math.min(at + 1, steps.length)} of ${steps.length}`}>
      {steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}><i>{i < at ? '✓' : i + 1}</i>{s}</li>)}
    </ol>
  );
}

function Mood({ phase, app, ai }: { phase: Phase; app?: A.App; ai?: { key: string; bg: string } }) {
  const mood: art.Mood = phase === 'done' ? 'happy' : phase === 'offline' ? 'rest' : phase === 'waiting' ? 'idle' : phase === 'opening' ? 'work'
    : phase === 'failed' || phase === 'expired' || phase === 'unavailable' ? 'error' : 'ask';
  return (
    <div className="flow-face">
      <span className="halo"><ChiefArt mood={mood} d={5} /></span>
      {app && <span className="app-ic badge-ic" style={{ background: app.bg }}>{app.mark}</span>}
      {ai && <span className="badge-ic ai-badge"><AiMark ai={ai} size={38} /></span>}
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

/**
 * A tab for the provider's own page, opened in the tap itself: a tab opened after crewd answers would be blocked as a
 * pop-up, costing a second tap. It shows nothing until crewd has the page, then goes there (`goTo`).
 */
export function openTab(): Window | null {
  if (demo) return null;
  const w = window.open('', '_blank');
  if (w) w.document.title = 'Opening…';
  return w;
}
function useTab(first: Window | null | undefined) {
  const tab = useRef(first ?? null);
  const went = useRef('');
  const goTo = (url: string) => { if (url && tab.current && !tab.current.closed && went.current !== url) { went.current = url; tab.current.location.href = url; } };
  const fresh = () => { tab.current = openTab(); went.current = ''; };
  /** The blank tab is not needed after all (a code instead, or it ended before there was a page): close it. */
  const drop = () => { if (tab.current && !went.current) { tab.current.close(); tab.current = null; } };
  return { tab, goTo, fresh, drop, open: () => !!tab.current && !tab.current.closed && !!went.current };
}

// ---------- Sign in with ChatGPT ----------
/**
 * "Sign in with ChatGPT": ChatGPT's own page opens in the tap, the person picks their account and taps Continue, and
 * the page comes straight back to the home computer. Three taps, no code. Crewhouse's own sheet is the truth: it moves
 * on only when crewd has a sign-in that works. The code is the fallback ("Having trouble?", or by itself when the page
 * never comes back). Every other ending has its own words: declined, busy, expired, a work account, offline.
 */
export function SignIn({ ai = A.AIS[0], tab: first, onReady, onClose }: { ai?: { key: string; name: string; bg: string }; tab?: Window | null; onReady: () => void; onClose: () => void }) {
  const name = ai.name;
  const { value, offline } = usePoll(() => api.accounts(), 1500);
  const g = A.account(value, ai.key);
  const [cancelled, setCancelled] = useState(false);
  const [keepWork, setKeepWork] = useState(false);
  const tab = useTab(first);
  const start = (body: { fresh?: boolean; via?: 'code' } = {}) => { setCancelled(false); void api.signIn(ai.key, body).catch(() => {}); };
  const again = (body: { fresh?: boolean } = {}) => { tab.fresh(); start(body); };
  useEffect(() => { if (!pinned) start(); }, []);
  const live: Phase = offline ? 'offline' : cancelled ? 'cancelled' : g.state === 'ready' ? (g.work && !keepWork ? 'work' : 'done')
    : g.signing ? 'code' : g.page ? 'waiting' : g.busy ? 'busy' : g.declined ? 'cancelled' : g.expired ? 'expired' : g.failed ? 'failed' : 'opening';
  const phase = pinned ?? live;
  useEffect(() => { if (phase === 'waiting') tab.goTo(g.page); else if (phase !== 'opening') tab.drop(); }, [phase, g.page]);
  // Signed in: the sheet says so, then gets out of the way; the waiting request is already under way.
  useEffect(() => { if (phase === 'done' && !pinned) { const t = setTimeout(onReady, 1600); return () => clearTimeout(t); } }, [phase]);
  const cancel = () => { void api.signInCancel(ai.key).catch(() => {}); setCancelled(true); };
  const close = () => { if (phase === 'waiting' || phase === 'opening' || phase === 'code') void api.signInCancel(ai.key).catch(() => {}); onClose(); };
  const code = g.signing?.code || 'WB60-FFV06';
  const page = g.signing?.url || (ai.key === 'chatgpt' ? 'https://auth.openai.com/codex/device' : '');
  const at = phase === 'done' || phase === 'work' ? 3 : phase === 'waiting' || phase === 'code' ? 1 : 0;
  const notNow = <button className="link" onClick={onClose}>Not now</button>;
  return (
    <Sheet label={`Sign in with ${name}`} onClose={close}>
      {!['offline', 'busy'].includes(phase) && <Progress at={at} steps={[`Open ${name}`, 'Say yes', 'Done']} />}
      <Mood phase={phase === 'code' ? 'waiting' : phase} ai={phase === 'offline' ? undefined : ai} />
      {phase === 'opening' && <><h2>Opening {name}…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Say yes on {name}'s page</h2>
        <p className="mute">{ai.key === 'chatgpt' ? <>Pick your account. Then tap <b>Continue</b>. If {name} shows <b>“Codex”</b>, that is the part that your helpers use.</> : <>Follow {name}'s instructions on its page.</>} Then come back here. This screen changes by itself.</p>
        {!tab.open() && <a className="btn go big" href={g.page || '#'} target="_blank" rel="noreferrer">Open {name} ↗</a>}
        <Pill tone="wait" live>Waiting for {name}…</Pill>
        {ai.key === 'chatgpt' && <button className="link" onClick={() => start({ via: 'code' })}>Is there a problem? Use a code instead</button>}
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'code' && <>
        <h2>Use a code</h2>
        <p className="mute">Type this code on {name}'s page. Then come back here. This screen changes by itself.</p>
        <button className="code" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Code copied'), () => {})} aria-label={`Code ${code.split('').join(' ')}. Tap to copy.`}>{code}<span>Tap to copy</span></button>
        {page && <a className="btn go big" href={page} target="_blank" rel="noreferrer">Open {name} ↗</a>}
        {ai.key === 'chatgpt' && <div className="mute small">If {name} says <b>device code sign-in is off</b>, do these steps:<ol><li>In {name}, open Settings → Security.</li><li>Set <b>Device code authorization</b> to on.</li><li>Tap Open {name} again.</li></ol>({name} shows this message only after you sign in.)</div>}
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>You are signed in.</h2><p>The crew now uses your own {name}. Your password stays with {name}.</p>
        <button className="btn go big" onClick={onReady}>Start</button></>}
      {phase === 'work' && <><h2>This is possibly your work {name}</h2>
        <p className="mute">You signed in as <b>{g.work || 'a work account'}</b>. The rules of your work would apply to your helpers. Do you want to use your personal {name}?</p>
        <button className="btn go big" onClick={() => attempt(async () => { await api.signOut(ai.key); setKeepWork(false); again({ fresh: true }); })}>Use my personal account</button>
        <button className="link" onClick={() => { setKeepWork(true); onReady(); }}>Keep this one</button></>}
      {phase === 'cancelled' && <><h2>OK</h2><p className="mute">Nothing changed. You can sign in at any time.</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{notNow}</>}
      {phase === 'busy' && <><h2>One moment</h2><p className="mute">Another sign-in is already in progress. Finish it or cancel it. Then try again.</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{ai.key === 'chatgpt' && <button className="link" onClick={() => start({ via: 'code' })}>Use a code instead</button>}</>}
      {phase === 'expired' && <><h2>The time limit ended</h2><p className="mute">A sign-in waits only a few minutes. This keeps your account safe. Start a new sign-in.</p>
        <button className="btn go big" onClick={() => again()}>Start again</button>{notNow}</>}
      {phase === 'failed' && <><h2>That did not work</h2><p className="mute">{g.recovery || <>{name} did not complete the sign-in. Nothing changed. Try again.</>}</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{notNow}</>}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
    </Sheet>
  );
}

/**
 * In a chat, right under Chief's line, while the crew can't think yet: the sign-in (with the one word ChatGPT's page
 * will use), or, for a plan without helpers, the ways forward. Taps: Sign in (1), her account (2), Continue (3).
 */
/** The sign-in card, in the ask-card anatomy (§4.11) with the ChatGPT button as primary. */
export function AccountCard({ g, inChat, onReady }: { g: ReturnType<typeof A.account>; inChat?: boolean; onReady: () => void }) {
  const [signing, setSigning] = useState<Window | null | false>(sheet === 'signin' ? null : false);
  const [noAccount, setNoAccount] = useState(false);
  const ai = A.AIS[0];
  if (g.notIncluded) return (
    <div className="card ask">
      <div className="ask-head"><Face who="chief" size={28} /><div className="grow"><b>Chief</b><div className="ask-status"><i />Needs a bigger plan</div></div></div>
      <p className="ask-words">Your {ai.name} plan does not include helpers yet</p>
      {!inChat && <p className="mute small">Everything else in {ai.name} is fine. {ai.name} Plus includes it.</p>}
      <div className="btns">
        <a className="btn go" href="https://chatgpt.com/#pricing" target="_blank" rel="noreferrer">See {ai.name} plans ↗</a>
        <button className="btn ghost always" onClick={() => attempt(async () => { await api.retryAccount(ai.key); onReady(); }, 'Trying again')}>I've changed my plan</button>
      </div>
    </div>
  );
  return (
    <div className="card ask">
      <div className="ask-head"><Face who="chief" size={28} /><div className="grow"><b>Chief</b><div className="ask-status"><i />Needs a sign-in</div></div></div>
      <p className="ask-words">{g.recovery || <>{ai.name} asks you once. If it shows <b>"Codex"</b>, that is the part that your helpers use.</>}</p>
      <div className="btns">
        <button className="btn go big" onClick={() => setSigning(openTab())}><AiMark ai={ai} size={24} />Sign in with {ai.name}</button>
        <button className="link" onClick={() => { setNoAccount(true); window.open('https://chatgpt.com/', '_blank'); }}>No {ai.name} account? Make a free one</button>
      </div>
      {noAccount && <p className="mute small">{ai.name} opened in a new tab. Sign up with Google or Apple. Then come back here and tap Sign in.</p>}
      {signing !== false && <SignIn tab={signing} onReady={() => { setSigning(false); onReady(); }} onClose={() => setSigning(false)} />}
    </div>
  );
}

// ---------- Connect an app ----------
/**
 * Connecting an app: its own page opens in the tap (Google, Notion or Canva), the person says yes there, and the sheet
 * turns to done by itself. Calendar and Gmail warn about Google's "unverified app" screen before it appears. Google's
 * apps before Google is set up say so instead of opening a broken page.
 */
export function ConnectApp({ app, helper, state, tab: first, ask, onConnected, onDone, onClose }: { app: A.App; helper?: string; state: Json; tab?: Window | null; ask?: number; onConnected?: () => void; onDone: () => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>(pinned ?? 'opening');
  const [url, setUrl] = useState(pinned ? 'https://accounts.google.com/' : '');
  const tab = useTab(first);
  const who = A.signsInWith(app);
  const start = () => {
    setPhase('opening');
    api.connect(app.id).then((r) => { setUrl(r?.url ?? ''); tab.goTo(r?.url ?? ''); setPhase(r?.state === 'on' ? 'done' : 'waiting'); })
      .catch((e) => { tab.drop(); setPhase(e?.status === 409 ? 'house' : trouble(e) === 'missing' ? 'unavailable' : trouble(e) === 'offline' ? 'offline' : 'failed'); });
  };
  const again = () => { tab.fresh(); start(); };
  useEffect(() => { if (!pinned) start(); }, []);
  const poll = usePoll(() => api.connection(app.id), 1500, !pinned && phase === 'waiting');
  useEffect(() => {
    const s = poll.value?.state;
    if (s === 'on') setPhase('done');
    else if (s === 'expired' || s === 'unticked' || s === 'declined') setPhase(s === 'declined' ? 'cancelled' : s);
    else if (s === 'failed') setPhase('failed');
    else if (s === 'cancelled') setPhase('cancelled');
    else if (poll.offline) setPhase('offline');
  }, [poll.value, poll.offline]);
  useEffect(() => { if (phase === 'done' && !pinned) onConnected?.(); }, [phase]);
  const cancel = () => { void api.disconnect(app.id).catch(() => {}); setPhase('cancelled'); };
  const at = phase === 'done' ? 3 : phase === 'waiting' ? 1 : 0;
  const warn = app.warns && <p className="warn-line">Google shows a warning for apps that it did not review. A personal app always gets this warning. Tap <b>Advanced</b>. Then tap <b>Go to Crewhouse</b>.</p>;
  const notNow = <button className="link" onClick={onClose}>Not now</button>;
  return (
    <Sheet label={`Connect ${app.name}`} onClose={onClose}>
      {!['offline', 'unavailable', 'house'].includes(phase) && <Progress at={at} steps={[`Open ${who}`, 'Say yes', 'Done']} />}
      <Mood phase={phase} app={app} />
      {phase === 'opening' && <><h2>Opening {who}'s page…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Say yes on {who}'s page</h2>
        <p className="mute">Pick your account. Then tap <b>{who === 'Google' ? 'Continue' : 'Allow'}</b>. This is {who}'s own page, so your password stays with {who}.</p>
        {warn}
        {!tab.open() && url && <a className="btn go big" href={url} target="_blank" rel="noreferrer">Open {who} ↗</a>}
        <Pill tone="wait" live>Waiting for {who}…</Pill>
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>{app.name} is connected</h2><p>{app.does}</p>{helper && <p className="mute">{helper} continues the job now.</p>}
        <button className="btn go big" onClick={onDone}>Done</button></>}
      {phase === 'cancelled' && <><h2>OK</h2><p className="mute">I did not connect anything{helper ? `. ${helper} will continue without it` : ''}.
        {app.warns ? ` Google shows that warning for each app that it did not review. A personal app always gets it. Crewhouse is your app, and it runs on your own computer. Tap Advanced. Then tap Go to Crewhouse.` : ` You can connect ${app.name} any time.`}</p>
        <button className="btn go big" onClick={again}>Try again</button>{notNow}</>}
      {phase === 'unticked' && <><h2>Almost: tick the box</h2><p className="mute">The {app.name} box is not ticked. Tap Try again. Then tick {app.name} on Google's page.</p>
        <button className="btn go big" onClick={again}>Try again</button>{notNow}</>}
      {phase === 'expired' && <><h2>The time limit ended</h2><p className="mute">{who}'s page waits only a few minutes. Open a new page.</p>
        <button className="btn go big" onClick={again}>Start again</button>{notNow}</>}
      {phase === 'failed' && (poll.value?.step
        // Google answered that one of the four setup steps isn't done: say which, and point to it.
        ? <><h2>A Google setup step is missing</h2><p className="mute">{poll.value.error}</p>
          <a className="btn go big" href="#/settings" onClick={onClose}>Open Settings</a>{notNow}</>
        : <><h2>That did not work</h2><p className="mute">{poll.value?.error ?? `${who} did not complete the connection. Nothing changed. Try again.`}</p>
          <button className="btn go big" onClick={again}>Try again</button>{notNow}</>)}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
      {phase === 'house' && <><h2>Switch Google on</h2><p className="mute">This is a one-time setup of about twenty minutes. Then you can connect Calendar, Gmail and Drive.</p>
        <a className="btn go big" href="#/settings" onClick={onClose}>Open Settings</a>{notNow}</>}
      {phase === 'unavailable' && <><h2>This comes soon</h2><p className="mute">You can connect {app.name} after the next Crewhouse update.</p>
        <button className="btn go big" onClick={onClose}>OK</button></>}
    </Sheet>
  );
}

/** The offer in Chief's chat, only when a task needs the app: one ask card (§4.4, connect), Chief's like every request. "Connect {App}" opens the app's
 *  page in that tap. */
export function ConnectCard({ c, helper, state, onDone }: { c: A.Card; helper?: string; state: Json; onDone: () => void }) {
  const [open, setOpen] = useState<Window | null | false>(sheet === 'connect' ? null : false);
  const app = c.app!;
  const no = () => api.answer(c.id, { answer: 'deny' }).then(onDone, () => toast('I cannot reach the home computer now.'));
  const yes = () => void api.answer(c.id, { answer: 'allow' }).catch(() => {}).then(onDone);
  return (
    <div className="card ask">
      <AskHead c={c} />
      <p className="ask-words">{c.words}</p>
      {app.warns && <p className="warn-line">Google shows a warning for apps that it did not review. A personal app always gets this warning. Tap <b>Advanced</b>. Then tap <b>Go to Crewhouse</b>.</p>}
      <div className="btns">
        <button className="btn go" onClick={() => setOpen(A.needsHouse(state, app) ? null : openTab())}>Connect {app.name}</button>
        <button className="btn" onClick={no}>Not now</button>
      </div>
      {open !== false && <ConnectApp app={app} helper={helper} state={state} tab={open} ask={c.id} onConnected={yes} onClose={() => setOpen(false)} onDone={() => setOpen(false)} />}
    </div>
  );
}

// ---------- the home computer out of reach ----------
function OfflineWords({ onClose }: { onClose: () => void }) {
  return <><h2>I cannot reach the home computer</h2><p className="mute">It may be asleep, off, or offline. Your helpers live there. They continue when the computer is back. I will try again and continue from here.</p>
    <Pill tone="off">Trying again…</Pill><button className="link" onClick={onClose}>Close for now</button></>;
}

/** Full screen when Crewhouse can't be reached at all: never a blank page or an error code. */
export function Unreachable({ retry }: { retry: () => void }) {
  const [n, setN] = useState(5);
  useEffect(() => { const t = setInterval(() => setN((x) => (x <= 1 ? (retry(), 5) : x - 1)), 1000); return () => clearInterval(t); }, [retry]);
  return (
    <div className="unreachable">
      <div className="asleep">
        <pre className="art zzz" aria-hidden>{'      z\n    z\n  z'}</pre>
        <Dots rows={art.HOUSE.map((r, i) => (i === 6 ? r.replace(/e/g, 'p') : r))} pal={art.HOUSE_PAL} d={9} label="Crewhouse, asleep" />
      </div>
      <h1>The home computer does not answer</h1>
      <p className="lead">It may be asleep, off, or offline. Crewhouse and your helpers live there. Everything continues when the computer is back.</p>
      <div className="card tips">
        <div><Face who="chief" size={34} /><span>Make sure that the home computer is on and connected to the internet.</span></div>
      </div>
      <button className="btn go big" onClick={() => { setN(5); retry(); }}>Try now</button>
      <p className="mute small">Trying again in {n}s</p>
    </div>
  );
}
