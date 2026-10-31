// The moments that must be seamless: signing in to ChatGPT, connecting an app, and the home computer being
// out of reach. Each one is a single sheet that walks through clear states, ends in a friendly success, and has a
// plain-words way forward from every failure. ?demo&phase=… pins one state, for review and screenshots.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, demo, paired, trouble, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
import { AiMark, attempt, ChiefArt, Dots, Face, Icon, Laptop, More, Pill, toast, useDialogOwn } from './parts.tsx';
import { appLink } from './typed.ts';

type Phase = 'opening' | 'waiting' | 'code' | 'key' | 'done' | 'work' | 'busy' | 'cancelled' | 'unticked' | 'expired' | 'failed' | 'offline' | 'unavailable' | 'house';
/** ?demo&phase=expired pins a flow to one state, for design review and screenshots. */
const pinned = demo ? (new URLSearchParams(location.search).get('phase') as Phase | null) : null;
/** ?demo&sheet=signin|connect opens that sheet straight away. */
export const sheet = demo ? new URLSearchParams(location.search).get('sheet') : null;

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
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
      <span className="halo"><ChiefArt mood={mood} mascot />
        {app && <span className="app-ic badge-ic"><img className="app-logo" src={app.logo} alt="" /></span>}
        {ai && <span className="badge-ic ai-badge"><AiMark ai={ai} size={38} /></span>}
      </span>
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

// ---------- Sign in ----------
/**
 * "Sign in with X": that account's own page opens in the tap, the person picks their account and says yes, and the
 * page comes straight back to the home computer. Three taps, no code. Crewhouse's own sheet is the truth: it moves
 * on only when crewd has a sign-in that works. The code is the fallback ("Having trouble?", or by itself when the page
 * never comes back). Every other ending has its own words: declined, busy, expired, a work account, offline.
 */
export function SignIn({ ai = A.AIS[0], tab: first, onReady, onClose, onSignedIn }: { ai?: (typeof A.AIS)[number]; tab?: Window | null; onReady: () => void; onClose: () => void; onSignedIn?: () => void }) {
  const name = ai.name;
  const keyed = 'keyEntry' in ai && ai.keyEntry === true;
  const { value, offline } = usePoll(() => api.accounts(), 1500);
  const g = A.account(value, ai.key);
  const [cancelled, setCancelled] = useState(false);
  const [keepWork, setKeepWork] = useState(false);
  const [pasted, setPasted] = useState('');
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cat, setCat] = useState<Json>(null);
  const choose = (id: string) => { setPicking(true); toast('Connecting'); void api.signInWorkspace(ai.key, id).catch((e: any) => toast(e.status === 400 ? e.message : 'That didn’t work. Please try again.')).finally(() => setPicking(false)); };
  const tab = useTab(first);
  const start = (body: { fresh?: boolean; via?: 'code' | 'key' } = {}) => { setCancelled(false); void (async () => {
    if (body.via === 'code') await api.signInCancel(ai.key);
    await api.signIn(ai.key, body);
  })().catch(() => {}); };
  const again = (body: { fresh?: boolean } = {}) => { if (!keyed) tab.fresh(); start(keyed ? { via: 'key' } : body); };
  useEffect(() => { if (!pinned) start(keyed ? { via: 'key' } : {}); }, []);
  const live: Phase = offline ? 'offline' : cancelled ? 'cancelled' : g.state === 'ready' ? (g.work && !keepWork ? 'work' : 'done')
    : g.key ? 'key' : g.signing ? 'code' : g.page ? 'waiting' : g.busy ? 'busy' : g.declined ? 'cancelled' : g.expired ? 'expired' : g.failed ? 'failed' : 'opening';
  const phase = pinned ?? live;
  // A key account needs nothing picked by hand: once its key is saved, the crew runs the model the account comes with, and
  // one line names it. Its own live list is read here only for that name (and for Settings' picker, which is where a person changes it).
  useEffect(() => { if (!keyed || g.state !== 'ready' || cat) return; let live = true; void (async () => {
    for (let i = 0; i < 4 && live; i++) { const c = await api.models(ai.key).catch(() => null); if (c?.models.length || i === 3) return live && setCat(c ?? { models: [], picked: null }); await new Promise((r) => setTimeout(r, 1000)); } // the engine reads its catalog just after a key is saved; an empty list is asked again before the sheet moves on
  })(); return () => { live = false; }; }, [keyed, g.state]);
  // The model in use: the person's own pick, else the one the crew takes by itself. Never a list of engine names to guess from.
  const used = (cat?.models ?? []).find((m: Json) => m.id === (cat.picked ?? cat.dflt))?.name ?? '';
  useEffect(() => { if (phase === 'waiting') tab.goTo(g.page); else if (phase !== 'opening') tab.drop(); }, [phase, g.page]);
  // Signed in: the sheet says so, then gets out of the way; the waiting request is already under way. The one line naming the
  // model stays a few seconds, so a person waiting for the first answer sees which model thinks and where to change it.
  useEffect(() => { if (phase === 'done' && !pinned) { onSignedIn?.(); const t = setTimeout(onReady, keyed ? 5000 : 700); return () => clearTimeout(t); } }, [phase]);
  const cancel = () => { void api.signInCancel(ai.key).catch(() => {}); setCancelled(true); };
  const close = () => { if (phase === 'waiting' || phase === 'opening' || phase === 'code' || phase === 'key') void api.signInCancel(ai.key).catch(() => {}); onClose(); };
  const code = g.signing?.code || 'WB60-FFV06';
  const page = g.signing?.url || (ai.key === 'chatgpt' ? 'https://auth.openai.com/codex/device' : '');
  const at = phase === 'done' || phase === 'work' ? 3 : phase === 'waiting' || phase === 'code' || phase === 'key' ? 1 : 0;
  const notNow = <button className="link" onClick={onClose}>Not now</button>;
  return (
    <Sheet label={`Sign in with ${name}`} onClose={close}>
      {!['offline', 'busy'].includes(phase) && !g.cliLogin && <Progress at={at} steps={phase === 'key' ? ['Get your key', 'Paste it', 'Done'] : [`Open ${name}`, 'Say yes', 'Done']} />}
      <Mood phase={phase === 'code' || phase === 'key' ? 'waiting' : phase} ai={phase === 'offline' ? undefined : ai} />
      {phase === 'opening' && <><h2>Opening {name}…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'key' && <>
        {g.pick ? <>
          <h2>Which workspace should Crewhouse use?</h2>
          <p className="mute">Your {name} key works in more than one workspace. Pick the one Crewhouse should think with.</p>
          <div className="stack ws-pick">{g.pick.map((w: { id: string; name: string }) => <button key={w.id} className="btn go big" disabled={picking} onClick={() => choose(w.id)}>{w.name}</button>)}</div>
        </> : <>
          <h2>Paste your {name} key</h2>
          <p className="mute">Paste the key from your {name} account. {ai.keyPage ? <>It stays on your computer, and {name} charges you for what the crew uses.</> : <>It uses your own {name} plan and stays on your computer.</>}</p>
          {ai.keyPage && <><a className="btn" href={ai.keyPage} target="_blank" rel="noreferrer">Get {/^[aeiou]/i.test(name) ? 'an' : 'a'} {name} key ↗</a>
            <p className="mute small">Make an account, add a little credit, then create a key and copy it here.</p></>}
          <form className="stack" onSubmit={(e) => { e.preventDefault(); setChecking(true); void attempt(async () => { await api.signInPaste(ai.key, pasted); setPasted(''); }).then(() => setChecking(false)); }}>
            <input className="input" value={pasted} disabled={checking} onChange={(e) => setPasted(e.target.value)} placeholder={`${name} key`} aria-label={`${name} key`} type="password" autoComplete="off" />
            <button className="btn go big" disabled={checking || !pasted.trim()}>{checking ? 'Checking…' : <>Sign in with {name}</>}</button>
          </form>
        </>}
        {g.key?.error && <p className="warn-line">{g.key.error}</p>}
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'waiting' && <>
        <h2>Say yes on {name}'s page</h2>
        <p className="mute">{ai.key === 'chatgpt' ? <>Pick your account, then tap <b>Continue</b>.</> : <>Follow {name}'s instructions on its page.</>} Come back here after; this moves on by itself.</p>
        {!tab.open() && <a className="btn go big" href={g.page || '#'} target="_blank" rel="noreferrer">Open {name} ↗</a>}
        <Pill tone="wait" live>Waiting for {name}…</Pill>
        {ai.key === 'chatgpt' && <button className="link" onClick={() => start({ via: 'code' })}>Having trouble? Use a code instead</button>}
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'code' && <>
        <h2>Let's try it with a code</h2>
        <p className="mute">Type this on {name}'s page instead. Come back after; this moves on by itself.</p>
        <button className="code" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Code copied'), () => {})} aria-label={`Code ${code.split('').join(' ')}. Tap to copy.`}>{code}<span>Tap to copy</span></button>
        {page && <a className="btn go big" href={page} target="_blank" rel="noreferrer">Open {name} ↗</a>}
        {ai.key === 'chatgpt' && <a className="link" href="https://chatgpt.com/#settings/Security" target="_blank" rel="noreferrer">Open {name} settings</a>}
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>You're signed in!</h2><p>The crew thinks with your own {name} now. Your password stayed with {name}.</p>
        {keyed && <p className="mute small">{used ? `It thinks with ${used}.` : `It uses the model your ${name} key comes with.`}</p>}
        {keyed && <button className="link" onClick={() => { onClose(); location.hash = `#/settings/ai/${ai.key}`; }}>Pick another model</button>}</>}
      {phase === 'work' && <><h2>That looks like your work {name}</h2>
        <p className="mute">Signed in as <b>{g.work || 'a work account'}</b>. Your work's rules would apply to your helpers. Use your personal {name} instead?</p>
        <button className="btn go big" onClick={() => attempt(async () => { await api.signOut(ai.key); setKeepWork(false); again({ fresh: true }); })}>Use my personal account</button>
        <button className="link" onClick={() => { setKeepWork(true); onReady(); }}>Keep this one</button></>}
      {phase === 'cancelled' && <><h2>No problem</h2><p className="mute">Nothing was changed. You can sign in whenever you like.</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{notNow}</>}
      {phase === 'busy' && <><h2>One moment</h2><p className="mute">Another sign-in is already in progress. Finish or cancel it, then try again.</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{ai.key === 'chatgpt' && <button className="link" onClick={() => start({ via: 'code' })}>Use a code instead</button>}</>}
      {phase === 'expired' && <><h2>That ran out of time</h2><p className="mute">Sign-ins only wait a few minutes, to keep your account safe. Let's start a fresh one.</p>
        <button className="btn go big" onClick={() => again()}>Start again</button>{notNow}</>}
      {phase === 'failed' && g.cliLogin && (() => { const w = A.cliLoginWords(g.cliLogin, name); return <><h2>{w.head}</h2><p className="mute">{w.body}</p>
        {w.cmd && <div className="fr-cmds"><code className="fr-cmd chat-code">{w.cmd}</code></div>}
        <button className="btn go big" onClick={() => again()}>{w.action}</button>{notNow}</>; })()}
      {phase === 'failed' && !g.cliLogin && <><h2>That didn't go through</h2><p className="mute">{g.recovery || <>{name} didn't finish the sign-in. No harm done; let's try once more.</>}</p>
        <button className="btn go big" onClick={() => again()}>Try again</button>{notNow}</>}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
    </Sheet>
  );
}

/**
 * In a chat, right under Chief's line, while the crew can't think yet: the sign-in,
 * or, for a plan without helpers, the ways forward. Taps: Sign in (1), her account (2), Continue (3).
 */
/** The sign-in card, in the ask-card anatomy (§4.11): one recommended account as the one button (`A.aiList`'s first:
 *  the account this computer was signed in to, else ChatGPT), every other provider the kit offers one tap away under
 *  "Use another account". The links a provider owns (its own site, its plans) sit under its own branch; no
 *  provider's name is written into another's card. */
/** The thread sign-in card's flag lives in the adapter (A.NEEDS_SIGNIN), shared with the header and the chats row so
 *  the two cannot drift; re-exported here for the card and the app shell. */
export { NEEDS_SIGNIN } from './adapter.ts';
export function AccountCard({ accounts, inChat, onReady }: { accounts: Json[] | null; inChat?: boolean; onReady: () => void }) {
  const [signing, setSigning] = useState<Window | null | false>(sheet === 'signin' ? null : false);
  const [signKey, setSignKey] = useState<string | null>(null);
  const list = A.aiList(accounts);
  const [{ ai, g }, ...others] = [...list.mine, ...list.more];
  // Nobody signed in yet: MiniMax's key sheet is a tap on the card itself, not behind "Use another account".
  const upfront = list.mine.some((r) => r.g.state === 'ready') ? [] : others.filter((r) => r.ai.key === 'minimax'), tucked = others.filter((r) => !upfront.includes(r));
  const pick = (r: typeof ai, cls: string) => <button key={r.key} className={cls} onClick={() => { setSignKey(r.key); setSigning('keyEntry' in r && r.keyEntry === true ? null : openTab()); }}><AiMark ai={r} size={24} /><span className="grow">Sign in with {r.name}</span><Icon name="next" /></button>;
  const signAi = others.find((r) => r.ai.key === signKey)?.ai ?? ai;
  // Not before the accounts are known: Chief's header says the same sign-in wait from the same test (chiefLocal).
  if ((!accounts || (g.state === 'ready' && !g.notIncluded)) && signing === false) return null;
  if (g.notIncluded) return (
    <div className="card ask">
      <div className="ask-head"><Face who="chief" size={28} /><div className="grow"><b>Chief</b><div className="ask-status"><i />Needs a bigger plan</div></div></div>
      <p className="ask-words">Your {ai.name} plan doesn't include helpers yet</p>
      {!inChat && <p className="mute small">Everything else in {ai.name} is fine. A bigger {ai.name} plan includes it.</p>}
      <div className="btns">
        {ai.plans && <a className="btn go" href={ai.plans} target="_blank" rel="noreferrer">See {ai.name} plans ↗</a>}
        <button className="btn ghost always" onClick={() => attempt(async () => { await api.retryAccount(ai.key); onReady(); }, 'Trying again')}>I've changed my plan</button>
      </div>
    </div>
  );
  return (
    <div className="card ask">
      <div className="ask-head"><Face who="chief" size={28} /><div className="grow"><b>Chief</b><div className="ask-status"><i />{g.state === 'ready' && !g.notIncluded ? 'Signed in' : A.NEEDS_SIGNIN}</div></div></div>
      <p className="ask-words">{g.recovery || (g.state === 'ready' ? <>You're signed in to {ai.name}.</> : 'keyEntry' in ai && ai.keyEntry === true ? <>Paste your {ai.name} key. Your job starts when it is saved.</> : <>Say yes once on your AI's page. Your job starts when you come back.</>)}</p>
      {g.state !== 'ready' && <div className="ai-picks">{pick(ai, 'btn go')}{upfront.map(({ ai: r }) => pick(r, 'btn'))}</div>}
      <details className="more-ways">
        <summary><span className="grow">Use another account</span><span className="ai-stack">{tucked.map(({ ai: r }) => <AiMark key={r.key} ai={r} size={22} />)}</span><i aria-hidden>›</i></summary>
        <div className="ai-picks">{tucked.map(({ ai: r }) => pick(r, 'btn'))}</div>
      </details>
      {signing !== false && <SignIn ai={signAi} tab={signing} onReady={() => { setSigning(false); onReady(); }} onSignedIn={onReady} onClose={() => setSigning(false)} />}
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
  const warn = app.warns && <p className="warn-line">Google shows a warning for apps it hasn't reviewed — a personal app always gets it. Tap <b>Advanced</b>, then <b>Go to Crewhouse</b>.</p>;
  const notNow = <button className="link" onClick={onClose}>Not now</button>;
  return (
    <Sheet label={`Connect ${app.name}`} onClose={onClose}>
      {!['offline', 'unavailable', 'house'].includes(phase) && <Progress at={at} steps={[`Open ${who}`, 'Say yes', 'Done']} />}
      <Mood phase={phase} app={app} />
      {phase === 'opening' && <><h2>Opening {who}'s page…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Say yes on {who}'s page</h2>
        <p className="mute">Pick your account, then tap <b>{who === 'Google' ? 'Continue' : 'Allow'}</b>. It's {who}'s own page, so your password stays with them.</p>
        {warn}
        {!tab.open() && url && <a className="btn go big" href={url} target="_blank" rel="noreferrer">Open {who} ↗</a>}
        <Pill tone="wait" live>Waiting for {who}…</Pill>
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>{app.name} is connected</h2><p>{app.does}</p>{helper && <p className="mute">{helper} is carrying on with it now.</p>}
        <button className="btn go big" onClick={onDone}>Done</button></>}
      {phase === 'cancelled' && <><h2>No problem</h2><p className="mute">Nothing was connected{helper ? `, and ${helper} will manage without it` : ''}.
        {app.warns ? ` Google shows that warning for every app it hasn't reviewed — a personal app always gets it. Crewhouse is your app, running on your own computer. Tap Advanced, then Go to Crewhouse.` : ` You can connect ${app.name} any time.`}</p>
        <button className="btn go big" onClick={again}>Try again</button>{notNow}</>}
      {phase === 'unticked' && <><h2>Almost: tick the box</h2><p className="mute">{app.name} still isn't ticked. Tap Try again, then tick {app.name} on Google's page.</p>
        <button className="btn go big" onClick={again}>Try again</button>{notNow}</>}
      {phase === 'expired' && <><h2>That page timed out</h2><p className="mute">{who}'s page only waits a few minutes. Let's open a fresh one.</p>
        <button className="btn go big" onClick={again}>Start again</button>{notNow}</>}
      {phase === 'failed' && (poll.value?.step
        // Google answered that one of the four setup steps isn't done: say which, and point to it.
        ? <><h2>A Google setup step is missing</h2><p className="mute">{poll.value.error}</p>
          <a className="btn go big" href="#/settings" onClick={onClose}>Open Settings</a>{notNow}</>
        : <><h2>That didn't go through</h2><p className="mute">{poll.value?.error ?? `${who} didn't finish connecting. No harm done; let's try once more.`}</p>
          <button className="btn go big" onClick={again}>Try again</button>{notNow}</>)}
      {phase === 'offline' && <OfflineWords onClose={onClose} />}
      {phase === 'house' && <><h2>Switch Google on</h2><p className="mute">It's a one-time setup, about twenty minutes, and then you can connect Calendar, Gmail and Drive.</p>
        <a className="btn go big" href="#/settings" onClick={onClose}>Open Settings</a>{notNow}</>}
      {phase === 'unavailable' && <><h2>Coming very soon</h2><p className="mute">Connecting {app.name} arrives with the next Crewhouse update.</p>
        <button className="btn go big" onClick={onClose}>OK</button></>}
    </Sheet>
  );
}

/**
 * Connect apps: Composio's own sign-in page opens in the tap; the person picks an account and says yes there, and the
 * sheet turns to done by itself. Nothing is typed here, and nothing connects until that page says yes.
 */
export function ComposioSheet({ state, onChange, onClose }: { state: Json; onChange: () => void; onClose: () => void }) {
  const [phase, setPhase] = useState<'opening' | 'waiting' | 'done' | 'failed'>(state?.state === 'on' ? 'done' : 'opening');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const tab = useRef<Window | null>(null);
  const start = () => {
    setPhase('opening'); tab.current = openTab();
    api.composioConnect().then((r) => { setUrl(r?.url ?? ''); if (tab.current && r?.url) tab.current.location.href = r.url; setPhase(r?.state === 'on' ? 'done' : 'waiting'); })
      .catch((e) => { tab.current?.close(); setError(e?.status === 503 ? 'Connect apps is still starting. Try again in a moment.' : "Can't reach the home computer right now. Check it's on, then try again."); setPhase('failed'); });
  };
  useEffect(() => { if (state?.state !== 'on') start(); }, []);
  const poll = usePoll(() => api.composio(), 1500, phase === 'waiting');
  useEffect(() => {
    const s = poll.value?.state;
    if (s === 'on') { setPhase('done'); onChange(); }
    else if (s === 'failed') { setError(poll.value?.error ?? ''); setPhase('failed'); }
    else if (s === 'off') setPhase('failed');
  }, [poll.value]);
  const cancel = () => { void api.composioOff().catch(() => {}); onChange(); onClose(); };
  return (
    <Sheet label="Connect apps" onClose={onClose}>
      {phase === 'opening' && <><h2>Opening the sign-in page…</h2><div className="dotdot" aria-hidden><i /><i /><i /></div><button className="link" onClick={cancel}>Cancel</button></>}
      {phase === 'waiting' && <>
        <h2>Say yes on the sign-in page</h2>
        <p className="mute">Sign in once to Composio and pick the apps you want. Your password stays with Composio, and Chief can use the apps you pick.</p>
        {url && <a className="btn go big" href={url} target="_blank" rel="noreferrer">Open the sign-in page ↗</a>}
        <Pill tone="wait" live>Waiting for Composio…</Pill>
        <button className="link" onClick={cancel}>Cancel</button>
      </>}
      {phase === 'done' && <><h2>Your apps are connected</h2><p>Chief can use the apps you picked. You can turn them off here any time.</p>
        <button className="btn go big" onClick={onClose}>Done</button></>}
      {phase === 'failed' && <><h2>That didn't go through</h2><p className="mute">{error || "Composio didn't finish signing you in. No harm done; let's try once more."}</p>
        <button className="btn go big" onClick={start}>Try again</button><button className="link" onClick={onClose}>Not now</button></>}
    </Sheet>
  );
}

/** An app that takes the person's own key (X): pasted here, sealed by crewd, never shown again. */
export function KeyApp({ app, onDone, onClose }: { app: A.App; onDone: () => void; onClose: () => void }) {
  const [key, setKey] = useState(''), [said, setSaid] = useState(''), [busy, setBusy] = useState(false);
  const save = (e: { preventDefault(): void }) => {
    e.preventDefault(); setBusy(true); setSaid('');
    api.setKey(app.id, key).then(() => { setKey(''); onDone(); }, (x) => { setBusy(false); setSaid(x?.status === 400 ? String(x.message) : "Can't reach the home computer right now. Check it's on, then try again."); });
  };
  return (
    <Sheet label={`Add ${app.name}`} onClose={onClose}>
      <h2>Add your {app.name} key</h2>
      <p className="mute">{app.does} Paste the Bearer Token from your own {app.name} developer page. It is kept sealed on your computer.</p>
      <form className="stack" onSubmit={save}>
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={`${app.name} API key`} aria-label={`${app.name} API key`} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        {said && <p className="warn-line" role="alert">{said}</p>}
        <button className="btn go big" disabled={busy || !key.trim()}>Save key</button>
      </form>
      <button className="link" onClick={onClose}>Not now</button>
    </Sheet>
  );
}

/** The in-chat offer, only when a task needs the app: one ask card (§4.4, connect). "Connect {App}" opens the app's
 *  page in that tap. */
export function ConnectCard({ c, helper, state, onDone, id }: { c: A.Card; helper?: string; state: Json; onDone: () => void; id?: string }) {
  const [open, setOpen] = useState<Window | null | false>(sheet === 'connect' ? null : false);
  const app = c.app!;
  const who = A.crew(state).find((x) => x.id === c.helper);
  const no = () => api.answer(c.id, { answer: 'deny' }).then(onDone, () => toast("Can't reach the home computer right now."));
  const yes = () => void api.answer(c.id, { answer: 'allow' }).catch(() => {}).then(onDone);
  return (
    <div className="card ask" id={id}>
      <div className="ask-head">
        {who ? <Face who={{ ...who, mood: 'ask' }} size={28} /> : <span className="app-ic"><img className="app-logo" src={app.logo} alt="" /></span>}
        <div className="grow"><b>{who?.name ?? helper ?? 'The crew'}</b><div className="ask-status"><i />{c.status}</div></div>
        <time className="mute small">{A.clock(c.at)}</time>
      </div>
      <p className="ask-words">{c.words}</p>
      {app.warns && <p className="warn-line">Google shows a warning for apps it hasn't reviewed — a personal app always gets it. Tap <b>Advanced</b>, then <b>Go to Crewhouse</b>.</p>}
      <div className="btns">
        <button className="btn go" onClick={() => setOpen(A.needsHouse(state, app) ? null : openTab())}>Connect {app.name}</button>
        <More title={c.words} sub={c.status} acts={[{ label: 'Not now', run: no }]} />
      </div>
      {open !== false && <ConnectApp app={app} helper={helper} state={state} tab={open} ask={c.id} onConnected={yes} onClose={() => setOpen(false)} onDone={() => setOpen(false)} />}
    </div>
  );
}

// ---------- pairing the public app with the person's own computer ----------
/** The first-run layout (Stack J01, J13): a face and a wide headline on the left, what to do on the right; on a phone one
 *  column. `top` is the step chips (above the headline on a phone, in the right column on a computer); `mid` centres a
 *  phone's column. Text meant for one size alone takes `on-phone` or `on-desk`. */
export function Split({ top, mark, title, lead, mid, children, className = '' }: { top?: ReactNode; mark?: ReactNode; title: ReactNode; lead?: ReactNode; mid?: boolean; children?: ReactNode; className?: string }) {
  return (
    <div className={`fr${mid ? ' mid' : ''} ${className}`}>
      <section className="fr-l">
        {top && <div className="on-phone fr-top">{top}</div>}
        {mark && <span className="fr-mark">{mark}</span>}
        <h1 className="fr-h">{title}</h1>
        {lead && <p className="fr-lead">{lead}</p>}
      </section>
      <section className="fr-r">{top && <div className="on-desk fr-top">{top}</div>}{children}</section>
    </div>
  );
}

/** A first-run screen laid over whatever is open (pairing from Settings or the public shell). */
function FullPage({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogOwn(box, onClose);
  return createPortal(<div ref={box} className="fr-page" role="dialog" aria-modal aria-label={label}>{children}</div>, document.body);
}

const Steps3 = ({ at }: { at: number }) => <ol className="fr-steps" aria-label={`Step ${at + 1} of 3`}>
  {['Computer', 'Words', 'Done'].map((w, i) => <li key={w} className={i === at ? 'now' : i < at ? 'did' : ''}>{i < at ? <Icon name="check" size={18} /> : i === at ? `${i + 1} ` : ''}{w}</li>)}
</ol>;

// Chrome on Android has BarcodeDetector; iOS Safari has none, so there only the typed code shows.
const canScan = () => 'BarcodeDetector' in window;

/** The back camera on the computer's QR: BarcodeDetector reads each frame, and the camera stops on a read, on Back and
 *  on unmount. A refused camera goes back to the typed box (`onRefused`). */
function Scanner({ onCode, onBack, onRefused }: { onCode: (qr: string) => void; onBack: () => void; onRefused: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let open = true, frame = 0, stream: MediaStream | undefined;
    const stop = () => { open = false; cancelAnimationFrame(frame); stream?.getTracks().forEach((t) => t.stop()); };
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s;
      if (!open) return stop();
      video.current!.srcObject = s;
      await video.current!.play();
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      const look = async () => {
        const [hit] = await detector.detect(video.current!).catch(() => []);
        if (!open) return;
        if (hit?.rawValue) { stop(); onCode(hit.rawValue); return; }
        frame = requestAnimationFrame(() => void look());
      };
      void look();
    }).catch(() => { if (open) { stop(); onRefused(); } });
    return stop;
  }, []);
  return <>
    <h2>Point at the code</h2>
    <p className="mute">The code on your computer's screen, under Add a phone.</p>
    <video ref={video} className="pair-scan" playsInline muted aria-label="Camera" />
    <button className="link" onClick={onBack}>Back</button>
  </>;
}

/** The demo's way to the person's own crew: the computer shows a code (Settings, Phones, Add a phone) whose QR is a link to
 *  its own web app, so the phone's camera opens that app and it pairs on its own (`offerHere`). Here, a code can also be
 *  scanned or pasted (a relay code, or the computer's 12-letter one); a link to the computer's app opens it. Then the two
 *  words to check there. Paired, the same installed app opens again on their real crew. ?demo&phase=waiting|done pins a step. */
export function PairSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);
  const [scan, setScan] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const join = (how: (link: typeof import('./link.ts')) => Promise<void>) => { setBusy(true); setProblem(''); void (async () => {
    const link = await import('./link.ts');
    await how(link);
    setDone(true);
    setTimeout(() => void link.leave(true), 1200);
  })().catch((e: Error) => { setProblem(e.message); setWords(null); setBusy(false); }); };
  /** What was scanned, pasted or opened: the computer's app link goes to that app; anything else pairs from here. */
  const open = (code: string, how: (link: typeof import('./link.ts'), code: string) => Promise<void>) => { const to = appLink(code); if (to) location.assign(to); else join((link) => how(link, code)); };
  const pair = () => open(text, (link, c) => link.pair(c, setWords));
  const scanned = (qr: string) => { setScan(false); open(qr, (link, c) => link.scanned(c, setWords)); };
  // Opened by the computer's QR: the offer is in the address, so pair now, and take it out of the history.
  useEffect(() => { if (pinned) return; void import('./link.ts').then((link) => { const offer = link.offerHere(); if (offer) { history.replaceState(null, '', '/#/pair'); join((l) => l.scanned(offer, setWords)); } }); }, []);
  const phase = pinned === 'waiting' || pinned === 'done' ? pinned : done ? 'done' : words ? 'waiting' : 'code';
  const said = words ?? 'maple lantern';
  // The pairing already started can't be taken back from here, so Cancel starts this page over.
  const cancel = () => { history.replaceState(null, '', '/#/'); location.reload(); };
  const top = <Steps3 at={phase === 'done' ? 2 : phase === 'waiting' ? 1 : 0} />;
  return (
    <FullPage label="Pair with your computer" onClose={onClose}>
      {phase === 'code' && <Split top={top} mark={<span className="on-desk"><Face who="chief" size={96} /></span>} title="Pair with your computer"
        lead="Your crew lives on your own computer. This phone opens it from there.">
        {scan ? <Scanner onCode={scanned} onRefused={() => { setScan(false); setCamOff(true); }} onBack={() => setScan(false)} /> : <>
          <ol className="fr-how">
            <li>On your computer, open Crewhouse.</li>
            <li>Go to <b>Settings</b>, then <b>Phones</b>, then <b>Add a phone</b>.</li>
            <li>Scan the code with this phone's camera. It opens Crewhouse right here.</li>
          </ol>
          {busy && <span className="fr-wait" role="status"><i className="fr-spin" />Connecting…</span>}
          {canScan() && <button className="btn soft" disabled={busy} onClick={() => { setCamOff(false); setScan(true); }}>Scan the code here instead</button>}
          <label className="fr-label">Or paste the code the computer shows
            <textarea className="input pair-code" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (text.trim() && !busy) pair(); } }}
              placeholder="For example VDXK-G97P-AQDB" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
          {camOff && <p className="fr-note">Camera is off for this page. Paste the code instead.</p>}
          {problem && <p className="pair-problem" role="alert">{problem}</p>}
          <details className="fr-note"><summary>The computer shows no web address, or you're away from home</summary>
            <p>A phone's browser needs a secure web address for your computer. In <b>Settings</b>, <b>Phones</b> on the computer, tap <b>Turn on</b> under the web app. It uses the free connector app: install it on the computer and on this phone, signed in to the same account. Or paste the address of your own server there instead.</p></details>
          <div className="fr-acts"><button className="btn go big" disabled={busy || !text.trim()} onClick={pair}>{busy ? 'Connecting…' : 'Pair'}</button>
            <button className="btn soft big" onClick={onClose}>Not now</button></div>
        </>}
      </Split>}
      {phase === 'waiting' && <Split mid top={top} mark={<Face who="chief" size={96} />} title="Check these two words" lead="Your computer shows two words too. If they match, tap Yes there.">
        <b className="pair-words">{said}</b>
        <span className="fr-wait" role="status"><i className="fr-spin" />Waiting for your computer…</span>
        <button className="btn soft big" onClick={cancel}>Cancel</button>
      </Split>}
      {phase === 'done' && <Split mid top={top} mark={<span className="on-desk"><Face who="chief" size={96} /></span>} title="Paired." lead="This is your crew now. Opening it…">
        <span className="fr-crew" aria-hidden>{(['bunny', 'scout', 'chief', 'scribe', 'tracer'] as const).map((k) => <Face key={k} who={k === 'chief' ? 'chief' : { kind: k, name: k }} size={k === 'chief' ? 88 : 64} />)}</span>
        <button className="btn go big" onClick={() => void import('./link.ts').then((l) => l.leave(true))}>Open my crew</button>
      </Split>}
    </FullPage>
  );
}

// ---------- the home computer out of reach ----------
function OfflineWords({ onClose }: { onClose: () => void }) {
  return <><h2>Can't reach the home computer</h2><p className="mute">It may be asleep, switched off, or offline. Your helpers live there, so they'll carry on the moment it's back. I'll keep trying, and pick up right here.</p>
    <Pill tone="off">Trying again…</Pill><button className="link" onClick={onClose}>Close for now</button></>;
}

/** Full screen when this page opened without the person's authority (a bare bookmark or typed address, whose every
 *  read crewd refuses with 403 no-authority): the computer is up, so never the offline screen and no retry loop —
 *  one plain screen in the same tokens that says to open Crewhouse from this computer's app menu. */
export function NoAuthority() {
  return <Split mid mark={<Face who="chief" size={96} />} title="Open Crewhouse from this computer’s app menu"
    lead="This page opened in the browser on its own, so it can’t reach your crew. Your helpers are waiting on this computer — open Crewhouse from the app menu and everything picks up right here." />;
}

/** Full screen when Crewhouse can't be reached at all (J13a): never a blank page or an error code. A paired app
 *  keeps a way out: pairing again reuses the code flow and only replaces the kept grant once the new one succeeds. */
export function Unreachable({ retry }: { retry: () => void }) {
  const [n, setN] = useState(RETRY);
  const [pairing, setPairing] = useState(false);
  useEffect(() => { const t = setInterval(() => setN((x) => (x <= 1 ? (retry(), RETRY) : x - 1)), 1000); return () => clearInterval(t); }, [retry]);
  return (<>
    <Split mid mark={<Face who="chief" size={96} />} title="The home computer isn't answering"
      lead="It may be asleep, switched off or offline. Your crew lives there, so everything picks up the moment it's back.">
      <div className="fr-tip"><Icon name="check" size={22} /><span>Check it's on and connected to the internet.</span></div>
      <button className="btn go big" onClick={() => { setN(RETRY); retry(); }}>Try now</button>
      {paired && <button className="btn soft big" onClick={() => setPairing(true)}>Pair again</button>}
      <p className="fr-note">Trying again in {n} second{n === 1 ? '' : 's'}</p>
    </Split>
    {pairing && <PairSheet onClose={() => setPairing(false)} />}
  </>);
}
const RETRY = 15;

/** This device was taken off the crew on the home computer (J13c): its kept sign-in is gone, so the way back is to pair again. */
export function Removed({ onPair }: { onPair: () => void }) {
  return <Split mid mark={<span className="fr-lock"><Icon name="lock" size={44} /></span>} title="This device was removed" lead="It was taken off the crew on the home computer. Pair it again to come back.">
    <div className="fr-back on-desk"><span className="st-label"><span>To come back</span></span>
      <ol>{['On the home computer, open Settings, then Phones.', 'Add this device again.', 'Check the two words match.'].map((t, i) => <li key={t}><i>{i + 1}</i>{t}</li>)}</ol></div>
    <button className="btn go big" onClick={onPair}>Pair again</button>
  </Split>;
}
