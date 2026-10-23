// Crewhouse, direction C "Pocket Pals" with A's night mode and ASCII moments. Every screen reads the adapter's
// plain-words view models (adapter.ts), never crewd's raw rows.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { qrMatrix } from '@byokit/ui-core';
import { api, demo, mintFiles, pairable, paired, subscribe, trouble, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
type Helper = ReturnType<typeof A.crew>[number];
import { AiMark, answer, AskCard, AnsweredCard, AskSheet, InboxAlert, InboxDown, CampaignReceipt, attempt, Celebrate, setAway, setFaceMoods, ChiefArt, Composer, Face, Icon, Media, ChatText, PalArt, Pill, Splash, Steps, Toasts, toast, PreviewCard, PreviewPanel, DoneCard, KEPT, tint, peekShared, dropShared, type Pick as Picked } from './parts.tsx';
import { keepDraft } from './draft.ts';
import type { IconName } from './icons.ts';
import { Screen, ScreenPeek, SiteSignIn } from './screen.tsx';
import { glowOf, hear, useOffice } from './office.tsx';
import { AccountCard, ComposioSheet, ConnectApp, ConnectCard, NEEDS_SIGNIN, NoAuthority, openTab, PairSheet, Removed, Sheet, sheet, SignIn, Split, Unreachable } from './flows.tsx';
import { pushPossible, pushState, setBadge, startWorker, turnOffNotifications, turnOnNotifications } from './pwa.ts';
import { remember, resume } from './resume.ts';
import { nextRun, parseSchedule } from '../../src/routines.ts';
import * as K from './kept.ts';

/** The kept week (web/src/kept.ts): what this browser last heard from the computer, shown read-only while it can't be
 *  reached. Demo keeps nothing. */
let week: K.Kept | null = null;
const keptWeek = (): K.Kept => (week ??= demo ? K.empty('') : K.readKept(paired?.host ?? location.origin));
const keepWeek = (f: (k: K.Kept) => K.Kept) => { if (!demo) week = K.writeKept(f(keptWeek())); };

// A grant the home computer took back leaves this flag (link.ts `forgotten`); the shell says so until the person pairs again.
const REMOVED = 'crewhouse.removed';
const removed = (() => { try { return sessionStorage.getItem(REMOVED) === '1'; } catch { return false; } })();
const clearRemoved = () => { try { sessionStorage.removeItem(REMOVED); } catch { /* nothing kept */ } };
type View = 'home' | 'chief' | 'jobs' | 'room' | 'crew' | 'add' | 'helper' | 'things' | 'routines' | 'settings' | 'ai' | 'apps' | 'ask' | 'share' | 'pair' | 'computer';
/** The cloud's screens wait for BYOKit's cloud kit: a build made with CREWHOUSE_CLOUD=1 shows them. */
const cloudOn = process.env.CREWHOUSE_CLOUD !== '0';
type Route = { view: View; id?: string; tab?: string; m?: string; file?: string; title?: string };
const ANCHOR = /^m(\d+)$/;
function parseRoute(): Route {
  if (location.pathname === '/share' && !location.hash.startsWith('#/pair')) return { view: 'share' }; // the phone's Share sheet (web/manifest.webmanifest)
  if (demo && location.hash.includes('byokit-link:')) return { view: 'pair' }; // the computer's QR opened this page (link.ts `offerHere`)
  const [a, b, c, d] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'h' && b) return { view: 'helper', id: b, tab: ANCHOR.test(c) ? 'chat' : c || 'chat', m: ANCHOR.test(c) ? c : undefined };
  // #/f/<helper>/<file>/<title>: the chat that delivered it, with the workbook open beside it (web/src/parts.tsx).
  if (a === 'f' && b && c) return { view: 'helper', id: b, tab: 'chat', file: decodeURIComponent(c), title: d ? decodeURIComponent(d) : undefined };
  if (a === 'ask' && b) return { view: 'ask', id: b };
  if (a === 'pair' && demo) return { view: 'pair' };
  if (a === 'chief' && ANCHOR.test(b ?? '')) return { view: 'chief', m: b };
  if (a === 'things' && /^t\d+$/.test(b ?? '')) return { view: 'things', id: b };
  if (a === 'routines' && /^\d+$/.test(b ?? '')) return { view: 'routines', id: b };
  if (a === 'crew' && b === 'add') return { view: 'add' };
  if (a === 'settings' && b === 'ai' && c) return { view: 'ai', id: c };
  if (a === 'settings' && ['you', 'memory', 'rules', 'accounts', 'phones'].includes(b ?? '')) return { view: 'settings', tab: b };
  if (a === 'computer' && cloudOn) return { view: 'computer' };
  if (a === 'skills') return { view: 'apps' };
  return { view: (['chief', 'jobs', 'room', 'crew', 'things', 'routines', 'settings', 'apps'].includes(a) ? a : 'home') as View };
}
const go = (hash: string) => { location.hash = hash; };
let moved = false; // this session has navigated inside the app, so Back has somewhere to go back to
/** Back returns where you came from: the previous screen when there is one, else Chats. */
const back = () => { if (moved && history.length > 1) history.back(); else go('#/'); };
/** ?splash keeps the boot splash up, for design review. */
const hrefOf = (id: string) => (id === 'chief' ? '#/chief' : id === 'room' ? '#/room' : `#/h/${id}`);
/** A locked-file card lives in Chief's thread only, so its rows and links open there, never the approval sheet. */
const askHref = (c: A.Card) => (c.kind === 'unlock' ? '#/chief' : `#/ask/${c.id}`);
/** Chief's own trail (his learned notes, each with Undo): his thread's header carries the link. */
const CHIEF_TRAIL = '#/h/chief/did';
/** Chief's profile, one page: his hero's helmet and name open it. */
const CHIEF_PROFILE = '#/h/chief/details';
/** Chief's one word on every screen (hero, Home's card, his tile, the rail): a sign-in wait, out of reach, or his status. */
const chiefWord = (live: A.OfficeView, out?: boolean, offline?: boolean) => out ? NEEDS_SIGNIN : offline ? 'Out of reach for now' : A.chiefStatus(live).word;
/** Which chat each composer writes into: its held draft lives in web/src/draft.ts. */
const typeInto = (id: string) => ({ chat: id });

type Ctx = { state: Json; live: A.OfficeView; tick: number; refresh: () => void; night: boolean; offline: boolean; accounts: Json[] | null };

/** What Chief knows from the app itself, not the state: the computer out of reach, his composer, the sign-in.
 *  The sign-in wait is the thread card's own test (AccountCard: no account ready to think with), once accounts are known. */
function chiefLocal(ctx: Pick<Ctx, 'accounts' | 'offline'>, listen = false): A.ChiefLocal {
  const g = A.aiList(ctx.accounts).mine[0].g;
  return { offline: ctx.offline, listen, signedOut: !!ctx.accounts && (g.state !== 'ready' || g.notIncluded) };
}

// ---------- first run ----------
function useAccounts(poll: number, tick = 0) {
  const [list, setList] = useState<Json[] | null>(null);
  const pending = useRef<Promise<Json[]> | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      pending.current ??= api.accounts().finally(() => { pending.current = null; });
      void pending.current.then((l) => alive && setList(l)).catch(() => {});
    };
    pull();
    const t = poll ? setInterval(pull, poll) : undefined;
    return () => { alive = false; clearInterval(t); };
  }, [poll, tick]);
  return list;
}

/** Before Chief's first chat: the AI engine installing or starting, in the kit's own words, or why it failed,
 *  with Try again. Progress is the kit's phase, never a timer. */
function GettingReady({ view, refresh }: { view: { failed: boolean; words: string }; refresh: () => void }) {
  return (
    <Split mid className="getting-ready" mark={<Face who="chief" size={128} />} title={view.failed ? "Your crew couldn't get ready" : 'Getting your crew ready'} lead={view.words || undefined}>
      <span role="status" aria-live="polite">{view.failed
        ? <button className="btn go big" onClick={() => attempt(async () => { await api.retryEngine(); refresh(); })}>Try again</button>
        : <span className="fr-wait"><i className="fr-spin" />Setting up…</span>}</span>
    </Split>
  );
}

/** Shared from another app on the phone (the Share sheet): Chief asks what to do with it, one blue primary first. The
 *  words come on the link and the photos (up to four) from the share cache; both go with whatever the person picks. */
function Share({ refresh, connected = true }: { refresh: () => void; connected?: boolean }) {
  const q = new URLSearchParams(location.search);
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  const more = Number(q.get('more') ?? 0);
  const [pics, setPics] = useState<Picked[] | null>(null);
  const [other, setOther] = useState(false);
  useEffect(() => { void peekShared().then(setPics); }, []);
  const home = () => { void dropShared(); history.replaceState(null, '', '/#/chief'); dispatchEvent(new HashChangeEvent('hashchange')); };
  const send = async (what: string) => {
    const said = text ? `${what}\n\nWhat I shared:\n${text}` : what;
    if (await attempt(() => api.post('chief', said, (pics ?? []).map(({ type, data }) => ({ type, data }))), undefined, true)) { refresh(); home(); } return true;
  };
  if (!text && pics && !pics.length) return <Split mid mark={<Face who="chief" size={96} />} title="Nothing came through" lead="Try sharing it again." />;
  const tile = <div className="share-tile"><span className="st-label"><span>Shared with Crewhouse</span></span>
    {!!text && <div className="said">{text}</div>}
    {!!pics?.length && <div className="share-pics">{pics.map((p, i) => <img key={i} src={`data:${p.type};base64,${p.data}`} alt={`Photo ${i + 1}`} />)}</div>}
    {!text && !pics?.length && <span className="fr-mark"><Icon name="image" size={32} /></span>}
    {more > 0 && <div className="mute small">Only the first 4 photos came through.</div>}</div>;
  return (
    <Split className="share" mark={<Face who="chief" size={96} />} title={connected ? 'Got it. What shall the crew do with this?' : 'Got it. Connect to send it'}
      lead={connected ? undefined : 'What you shared is kept on this device until you pair with your computer.'}>
      {tile}
      {connected
        ? <div className="share-acts">
          <button className="btn go big" disabled={!pics} onClick={() => send('Add this to my calendar and remind me the day before')}>Add to my calendar + remind me</button>
          <button className="btn soft big" disabled={!pics} onClick={() => send('Just remember this for me')}>Just remember it</button>
          <button className="btn soft big" disabled={!pics} onClick={() => setOther(true)}>Something else…</button>
          {other && <Composer placeholder="What shall the crew do with it?" onSend={send} />}
        </div>
        : <div className="share-acts"><button className="btn go big" onClick={() => go('#/pair')}>Connect to send</button></div>}
    </Split>
  );
}

// ---------- home ----------
/** A helper that has gone quiet: stop it, take the wheel, or leave it be. */
const leftAlone = new Map<string, number>();
function Stuck({ h, refresh }: { h: A.Helper; refresh: () => void }) {
  const [, redraw] = useState(0);
  if (!h.stuckFor || leftAlone.get(h.id) === h.quietSince) return null;
  return (
    <div className="stuck">
      <span>{h.name} has been quiet for {h.stuckFor} minute{h.stuckFor === 1 ? '' : 's'}. Shall I stop, or would you like to take control?</span>
      <div className="btns">
        <button className="btn" onClick={() => attempt(async () => { await api.reset(h.id); refresh(); }, `Stopped ${h.name}`)}>Stop</button>
        {h.computer && <button className="btn" onClick={() => attempt(async () => { await api.takeOver(h.id); refresh(); go(`#/h/${h.id}/screen`); })}>Take control</button>}
        <button className="btn ghost" onClick={() => { leftAlone.set(h.id, h.quietSince); redraw((n) => n + 1); }}>Leave it</button>
      </div>
    </div>
  );
}

/** A running helper's own controls, in its chat: Stop, Take control (a helper with a computer), and the way back to its screen once you hold it. */
function LiveControl({ h, word, refresh }: { h: A.Helper; word: string; refresh: () => void }) {
  return (
    <div className="live-ctl" role="group" aria-label={`Control ${h.name}`}>
      <span className="grow"><i className={h.driving ? 'dot you' : 'dot'} aria-hidden />{h.driving ? 'You have control' : word}</span>
      {h.computer && <button className="btn go" onClick={() => attempt(async () => { if (!h.driving) await api.takeOver(h.id); refresh(); go(`#/h/${h.id}/screen`); })}>{h.driving ? 'Open screen' : 'Take control'}</button>}
      <button className="btn" onClick={() => attempt(async () => { await api.reset(h.id); refresh(); }, `Stopped ${h.name}`)}>Stop</button>
    </div>
  );
}

/** The phone's chats, with Chief and the crew pinned before the recent helpers. */
/** The owner's row until the house is fully set up: how many of the three jobs are left. None of them is this
 *  device's to do once paired — their calls are refused over the link — so the row waits for the computer. */
function SetupRow({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { if (!paired) api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  const { left } = A.homeSetup(state, accounts, link);
  if (paired || !left) return null;
  return <a className="card nudge" href="#/settings"><span className="grow">Getting set up: {left} {left === 1 ? 'thing' : 'things'} left</span><b>›</b></a>;
}

/** Needs-you rows only open the review sheet; nothing commits from them. */
function NeedsRows({ state, cards }: { state: Json; cards: A.Card[] }) {
  const crew = A.crew(state);
  return (
    <>
      {cards.map((c) => (
        <a key={c.id} className="needs-row list-row" href={askHref(c)}>
          <Face who={crew.find((h) => h.id === c.helper) ?? { kind: 'bunny', name: c.helper }} size={36} />
          <span className="grow"><b className="clamp1">{c.head}</b><span className="small clamp1">{c.words}</span></span>
          <span className="chat-end"><time>{A.briefTime(c.at)}</time><i className="need-dot" /></span>
        </a>
      ))}
    </>
  );
}

/** Chief's thread's header (J03): his face and name, what he does — or, while he cannot work, the one wait that says why
 *  (the sign-in card's own test, or the computer out of reach) — and the gear to his profile. One header at every width:
 *  the tab bar and the side menu carry Home. */
function ChiefHead({ ctx }: { ctx: Ctx }) {
  const out = chiefLocal(ctx).signedOut && !ctx.offline, wait = out || ctx.offline;
  return <header className="home-bar is-chat chief-head">
    <a className="ch-art" href={CHIEF_PROFILE} aria-label="Chief's profile"><Face who="chief" size={44} /></a>
    <span className="grow"><h2 className="ch-name"><a href={CHIEF_PROFILE}>Chief</a></h2><p className={`ch-status${wait ? ' wait' : ''}`}>{wait ? chiefWord(ctx.live, out, ctx.offline) : 'Hands out the jobs'}</p></span>
    <a className="icon-btn st-gear" href={CHIEF_PROFILE} aria-label="Chief's profile"><Icon name="settings" size={20} /></a>
  </header>;
}

/** The desk's right column beside Chief's chat (J03): the question that matters most (not one his thread already shows),
 *  with its exact lines and buttons, then what was made in this chat and what else the crew did today. The job the
 *  thread follows is its live card, never repeated here. */
function ChiefRail({ state, live, refresh }: { state: Json; live: A.OfficeView; refresh: () => void }) {
  const ask = live.needs.find((c) => c.helper !== 'chief'); // Needs you's own order; Chief's own asks already sit inline in his thread beside it, never twice on one screen
  const who = ask ? A.crew(state).find((h) => h.id === (ask.by ?? ask.helper)) : undefined;
  const crew = A.crew(state), today = A.alsoToday(state);
  return <>
    {ask && <section className="home-section desk-ask" aria-label="Needs you">
      <div className="section-head"><span className="label">{ask.head}</span><span className="m-needs" data-n="1"><i />Needs you</span></div>
      <AskCard c={ask} who={who} onDone={refresh} />
    </section>}
    {today.length > 0 && <section className="home-section" aria-label="Also today"><div className="label">Also today</div>
      {today.map((r) => { const h = crew.find((x) => x.id === r.helper);
        return <a key={r.helper + r.title} className="st-card" href={hrefOf(r.helper)} style={{ background: h ? art.colourOf(h.kind) : undefined }}>
          {h && <Face who={h} size={44} />}<span className="grow"><span className="st-top"><b className="semi">{r.title}</b><span className="st-pill">{r.word}</span></span><span className="st-sub">{r.sub}</span></span></a>; })}
    </section>}
  </>;
}

/** Made in this chat: each file made in this chat as a card with its kind and time, opening in its reader. Chief's
 *  come from his chat's own lines (A.chatThings, as his Things page), a helper's from its finished jobs. */
function MadeHere({ made }: { made: A.ChatThing[] }) {
  if (!made.length) return null;
  return <section className="home-section made-here"><div className="label">Made in this chat</div>
    {made.map((x) => <a className="made-row" key={x.key} href={x.href.startsWith('#') ? x.href : '#/things'}><span className="file-chip">{x.chip}</span>
      <span className="grow"><b>{x.name}</b><span>{[x.f && A.KIND_WORD[x.f.kind], x.at ? A.clock(x.at) : ''].filter(Boolean).join(' · ')}</span></span><Icon name="next" /></a>)}
  </section>;
}

/** An empty list, said warmly: a small mark and a plain line, never a blank box. */
/** The demo's one way out: pair this app with the person's own computer (flows.tsx PairSheet, at #/pair). */
const PairRow = () => <div className="card nudge pair-row"><span className="grow"><b>You're trying a demo crew.</b> Your own crew lives on your computer.</span><a className="btn go" href="#/pair">Pair — yes, let's go</a></div>;

const Empty = ({ children }: { children: ReactNode }) => <div className="frame-empty">{children}</div>;

/** Home (Stack J02): the greeting, then Chief's card — what he has for you, or his own word, and his box — then Today,
 *  one row per job a helper is on or finished today, in the helper's colour, then Hand me a job. On a phone Chief's
 *  asks are Today's first rows (only Chief asks: a crew row never does); on a computer they sit in the column beside,
 *  under "Chief has N things for you", and Today leaves them out so no ask shows twice. Chief's thread is its own page. */
function Home(ctx: Ctx) {
  const { state, live, refresh, tick, accounts } = ctx;
  const out = chiefLocal(ctx).signedOut && !ctx.offline;
  const toChief = async (t: string, files?: { name: string; type: string; data: string }[]) => { const ok = await attempt(() => api.post('chief', t, undefined, undefined, files), undefined, true); if (ok) { refresh(); go('#/chief'); } return ok; };
  const jobs = useMemo(() => new Map(A.work(state).map((w) => [w.helper, w])), [state]);
  const n = live.counts.needs, name = A.displayName(state.person), crew = A.crew(state), kept = A.things(state).length;
  const word = chiefWord(live, out, ctx.offline), plainWord = /^(Free|At work|Waiting)$/.test(word);
  // Under "Chief has N things for you", what he has (two named, the rest counted; a helper gone quiet counts too, its
  // Stop card waiting in his thread); else his latest line, or on the first day what he does.
  const quiet = live.crew.filter((c) => c.stuck && c.seat === 'working');
  const said = A.chats(state, { signedOut: out })[0], heads = [...live.needs.map((c) => c.head.replace(/\?$/, '')), ...quiet.map((c) => `${c.name} has gone quiet`)];
  const line = n ? (heads.length > 2 ? `${heads.slice(0, 2).join('. ')}. And ${heads.length - 2} more.` : `${heads.join('. ')}.`)
    : said.at > 0 ? said.line : crew.length ? '' : "Hand me a job. I'll bring the right helper on, and ask you first.";
  // A held job (resting, or waiting on a sign-in) is not crewd's current task, so it comes from the job list.
  const held = new Map<string, string>((state.tasks as Json[]).filter((t) => t.state === 'paused').map((t) => [t.bot, A.plain(t.title)]));
  const today = A.roster(live.crew).filter((c) => jobs.has(c.id) || held.has(c.id) || glowOf(c, live).cls === 'done');
  return (
    <div className={`page stack stack-home${n ? ' has-asks' : ''}`}>
      <header className="st-head">
        <span className="grow"><h1 className="wide">{A.greeting().replace(/^Good (.)/, (_, c: string) => c.toUpperCase())}{name ? `, ${name}.` : '.'}</h1>
          <span className="st-date">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></span>
        <a className="icon-btn st-gear" href="#/settings" aria-label="Settings"><Icon name="settings" size={20} /></a>
        <button className="btn st-hand" onClick={() => document.querySelector<HTMLTextAreaElement>('.sh-chief textarea')?.focus()}><Icon name="plus" size={20} />Hand Chief a job</button>
      </header>
      <div className="st-body">
        <div className="st-pri">
          {demo && <PairRow />}
          <AccountCard accounts={accounts} onReady={refresh} />
          <SetupRow state={state} accounts={accounts} tick={tick} />
          <NewsOffer tick={tick} />
          {A.resting(state) && <div className="card nudge st-rest"><Icon name="clock" size={22} /><span className="grow"><b className="semi">{A.resting(state)}.</b>
            <span>{today.some((c) => held.has(c.id)) ? `${today.filter((c) => held.has(c.id)).map((c) => c.name).join(' and ')}'s job waits, then picks up by itself.` : "I'll pick things back up then."} Nothing moves to another AI without you.</span></span></div>}
          {A.gettingReady(state) && <div className="card nudge"><span className="grow">{A.gettingReady(state)}</span></div>}
          {A.update(state) && <div className="card nudge"><span className="grow">{A.update(state)!.words}</span><a className="btn go" href={A.update(state)!.url} target="_blank" rel="noreferrer">Download</a></div>}
          <section className="sh-chief" aria-label="Chief">
            <a className="sh-top" href="#/chief"><Face who="chief" size={64} />
              <span className="grow"><b className="semi">{n ? A.chiefHas(live) : plainWord ? `Chief is ${word.toLowerCase()}` : 'Chief'}</b>{!n && !plainWord && <span className="st-word">{word}</span>}{line && <span className="st-line">{line}</span>}</span></a>
            {n > 0 && <div className="sh-acts"><a className="btn go" href="#/jobs">Open Jobs</a><a className="btn" href="#/chief">Chat with Chief</a></div>}
            <Composer placeholder={crew.length ? 'Tell Chief anything…' : 'Give Chief a job…'} onSend={toChief} {...typeInto('chief')} />
          </section>
          {crew.length ? (n > 0 || today.length > 0) && <>
            <div className="st-label"><span>Today</span></div>
            <div className="st-today">
              {live.needs.map((c) => <AskRow key={c.id} c={c} state={state} />)}
              {today.map((c) => <TodayRow key={c.id} c={c} live={live} job={jobs.get(c.id)} held={held.get(c.id)} />)}
            </div>
          </> : <>
            <div className="st-label"><span>Your crew</span></div>
            <div className="st-empty"><b className="wide">No helpers yet.</b><span>Pick a job below. Chief brings a helper on for it, and you say yes first.</span></div>
          </>}
          {kept > 0 && <a className="st-kept" href="#/things"><span className="st-fan" aria-hidden><i /><i /><i /></span><span className="grow"><b className="semi">Kept</b><span>{kept} finished {kept === 1 ? 'job' : 'jobs'} and their files</span></span><Icon name="next" /></a>}
          <JobList state={state} refresh={refresh} />
        </div>
        {!n && !crew.length && <aside className="st-asks st-how" aria-label="How it works"><div className="st-label"><span>How it works</span></div>
          <ol>{['You tell Chief a job, in your own words.', 'Chief brings a helper on for it. You say yes first.', 'Nothing is sent, paid or deleted without you.'].map((t) => <li key={t}>{t}</li>)}</ol>
          <p><Icon name="lock" size={20} />You can see or forget anything the crew remembers.</p></aside>}
        {n > 0 && <aside className="st-asks" aria-label={A.chiefHas(live)}>
          <div className="st-label"><span>{A.chiefHas(live)}</span></div>
          {live.needs.map((c) => <HomeAsk key={c.id} c={c} state={state} onDone={refresh} />)}
          {quiet.map((c) => <a key={c.id} className="st-cc" href="#/chief"><span className="st-cc-top"><Face who={c} size={40} /><span className="st-pill needs-k">{A.WORDS.needs}</span></span>
            <b className="semi">{c.name} has gone quiet</b><span>Stop the job, or take control, in Chief's chat.</span></a>)}
        </aside>}
      </div>
    </div>
  );
}

/** A helper on the Jobs page: its name, its one status, and its job's line. */
function CrewCard({ c, live, job }: { c: A.OfficeMember; live: A.OfficeView; job?: A.Work }) {
  const glow = glowOf(c, live), { line, meta } = A.cardLines(c, live, job);
  return <a className="st-card" href={hrefOf(c.id)} style={{ background: art.colourOf(c.kind) }} aria-label={`${c.name}: ${glow.word}`}>
    <Face who={c} size={48} />
    <span className="grow"><span className="st-top"><b className="semi">{c.name}</b><span className={`st-pill ${glow.cls}`}>{glow.word}</span></span>
      {line !== glow.word && <span className="st-sub">{line}</span>}{meta && <span className="st-sub">{meta}</span>}</span>
  </a>;
}

/** One of Today's rows (Stack J02): the job a helper is on, or the one it finished today, in the helper's colour — the
 *  job, then who has it and how far — under the one status every screen reads (office.tsx glowOf). Crew never ask the
 *  person: a waiting row says "Waiting for Chief". */
function TodayRow({ c, live, job, held }: { c: A.OfficeMember; live: A.OfficeView; job?: A.Work; held?: string }) {
  const glow = glowOf(c, live), done = job || held ? undefined : A.landed(c, live);
  const how = job ? (A.waitsOnYou(c) ? A.WAIT_CHIEF : job.line) : held ? c.status : done?.files[0] ? `Made “${done.files[0].name}”` : '';
  return <a className="st-card" href={hrefOf(c.id)} style={{ background: art.colourOf(c.kind) }} aria-label={`${c.name}: ${glow.word}`}>
    <Face who={c} size={44} />
    <span className="grow"><span className="st-top"><b className="semi">{job?.title ?? held ?? done?.title}</b><span className={`st-pill ${glow.cls}`}>{glow.word}</span></span>
      <span className="st-sub">{how ? `${c.name} · ${how}` : c.name}</span></span>
  </a>;
}

/** One of Chief's asks in the computer's side column (Stack J02): who, what he asks and why in one line, then the way on.
 *  Home commits nothing: the yes opens the review sheet, where it is said for real; Not now answers no. */
function HomeAsk({ c, state, onDone }: { c: A.Card; state: Json; onDone: () => void }) {
  const who = c.hire ? { kind: c.hire.kind, name: c.hire.name } : A.crew(state).find((h) => h.id === (c.by ?? c.helper)) ?? 'chief';
  const yes = c.choices[0], deny = c.choices.find((x) => x.body.answer === 'deny' && x !== yes);
  const line = c.hire ? [c.hire.role, c.hire.first_job && `First job: ${c.hire.first_job}`, 'Nothing changes until you say yes'].filter(Boolean).join('. ') + '.'
    : c.kind === 'spend' ? `${c.question ?? c.words} Anything that costs money asks every time.` : c.question ?? c.words;
  return <article className="st-cc" aria-label={`${c.head}: ${A.WORDS.needs}`}>
    <span className="st-cc-top"><Face who={who} size={40} /><span className="st-pill needs-k">{A.WORDS.needs}</span></span>
    <b className="semi">{c.head}</b>{line !== c.head && <span>{line}</span>}
    <span className="st-cc-acts"><a className="btn go" href={askHref(c)}>{c.review ? 'Review order' : yes?.label ?? 'Answer…'}</a>
      {deny && <button className="btn" onClick={() => void answer(c, deny.body).then((ok) => ok && onDone())}>{deny.label}</button>}</span>
  </article>;
}

/** One of Chief's asks as a Today row on a phone: what he asks, in pink, under "Needs you"; a tap opens it. */
function AskRow({ c, state }: { c: A.Card; state: Json }) {
  const who = c.hire ? { kind: c.hire.kind, name: c.hire.name } : A.crew(state).find((h) => h.id === (c.by ?? c.helper)) ?? 'chief';
  const of = c.hire?.first_job ? ` · first job: ${c.hire.first_job}` : c.helper !== 'chief' && typeof who === 'object' ? ` · for ${who.name}` : '';
  return <a className="st-card st-ask" href={askHref(c)} aria-label={`${c.head}: ${A.WORDS.needs}`}>
    <Face who={who} size={44} />
    <span className="grow"><span className="st-top"><b className="semi">{c.head}</b><span className="st-pill needs-k">{A.WORDS.needs}</span></span>
      <span className="st-sub">Chief asks{of}</span></span>
  </a>;
}

/** Chief's thread: his bar, the pinned Needs you and his chat, with (on a desk) the side column of who is on what. */
function ChiefPage(ctx: Ctx & { m?: string }) {
  const { state, live, refresh } = ctx;
  return <div className="page chat-page home-chat"><div className="home-top"><ChiefHead ctx={ctx} /></div><Chat {...ctx} id="chief" hero m={ctx.m} rail={<ChiefRail state={state} live={live} refresh={refresh} />} /></div>;
}

/** The standing "hand me a job" list (docs/ui-contract.md, `ideas[]`): what the crew offers to do end to end, money back
 *  first. A row fills Chief's box with the words and never sends; a job still waiting on an app says what it needs and
 *  leads to the apps screen instead of dead-ending. A row offering a helper not hired yet brings them on first, then
 *  fills that helper's box. Home shows them last: one column on a phone, two on a computer. */
function JobList({ state, refresh }: { state: Json; refresh: () => void }) {
  // ponytail: Home offers the first four (crewd's own order: a goal, money back, then everyday jobs); Chief's box takes any other.
  const rows = A.jobs(state).slice(0, 4);
  const hand = (ask: string) => { keepDraft('chief', ask); go('#/chief'); };
  // The gallery hire, then the words in Chief's box for the new helper ("Reel, …"): nothing starts until they send.
  const hire = async (template: string, ask: string) => {
    const name = state.templates.find((t: Json) => t.id === template)?.display ?? template;
    if (await attempt(() => api.recruit(template, name), `${name} joined the crew`)) { refresh(); keepDraft('chief', `${name}, ${ask}`); go('#/chief'); }
  };
  if (!rows.length) return null;
  return (
    <section className="home-section jobs" aria-label="Hand me a job">
      <div className="st-label"><span>Hand me a job</span></div><div className="st-ideas">
      {rows.map((j) => {
        const body = <><span className="grow"><b>{j.label}</b>{j.needs.length > 0 && <span>{A.jobNeeds(j.needs)}</span>}</span><Icon name={j.needs.length ? 'next' : 'plus'} size={20} /></>;
        return j.needs.length ? <a key={j.bot + j.label} className="st-idea" href="#/apps">{body}</a>
          : <button key={j.bot + j.label} className="st-idea" onClick={() => (j.hire ? hire(j.hire, j.ask) : hand(j.ask))}>{body}</button>;
      })}
      </div>
    </section>
  );
}

/** The starters live in Chief's empty chat: a tap fills the box with the words, it never sends. */
function ChiefIdeas({ state, chat, picked }: { state: Json; chat: string; picked: () => void }) {
  return <><p className="ideas-intro">I can bring in Research Rae for research, Writer Will for writing or Video Vic for videos.</p><div className="chips center">{A.ideas(state).map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft(chat, i.ask); picked(); }}>{art.STAR} {i.label}</button>
  ))}</div></>;
}

/** Chief's pitch, then what to try: a tap sends the idea as the first job; How it works answers right here. */
function FirstTry({ state, send }: { state: Json; send: (t: string) => Promise<unknown> }) {
  const [how, setHow] = useState(false);
  return <>
    <div className="chips center">
      {A.firstIdeas(state).map((i) => <button key={i.label} className="chip" onClick={() => void send(i.label)}>{i.icon} {i.label}</button>)}
      <button className="chip" aria-expanded={how} onClick={() => setHow(!how)}>How does this work?</button>
    </div>
    {how && <div className="line them"><div className="line-by"><span className="who">Chief</span></div><div className="bubble-text"><ChatText text={A.howItWorks.map((l) => `- ${l}`).join('\n')} latest /></div></div>}
  </>;
}

/** A helper's starters in its own fresh chat: its own ready rows only, never another helper's. A tap fills Chief's box
 *  ("Penny, …", which goes straight to Penny); it never sends. */
function HelperIdeas({ state, chat, name }: { state: Json; chat: string; name: string }) {
  const rows = A.ideas(state).filter((i: Json) => i.bot === chat).slice(0, 3); // three starters; the rest wait in Hand me a job
  if (!rows.length) return null;
  return <div className="chips center">{rows.map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft('chief', `${name}, ${i.ask}`); go('#/chief'); }}>{art.STAR} {i.label}</button>
  ))}</div>;
}

// ---------- a chat ----------
function PairQR({ text, label }: { text: string; label?: string }) {
  const rows = useMemo(() => qrMatrix(text, { border: 1 }), [text]);
  return <svg viewBox={`0 0 ${rows.length} ${rows.length}`} role="img" aria-label={label ?? 'Scan to pair a phone'} shapeRendering="crispEdges">
    <rect width="100%" height="100%" fill="white" />
    <path fill="black" d={rows.flatMap((row, y) => row.map((dark, x) => dark ? `M${x} ${y}h1v1h-1z` : '')).join('')} />
  </svg>;
}
/** Where no phone is paired yet: the app download as a QR plus the same link as plain text. Gone once a phone is paired. */
function AppDownloadQR({ android }: { android?: boolean }) {
  return <div className="card pair" aria-label="Get the app">
    <div className="qr"><PairQR text={A.APP_DOWNLOAD_URL} label="Scan to get the app" /></div>
    <div className="grow"><b>{android ? 'Android phone? Get the app instead' : 'Get the app'}</b><p className="small">Scan with your phone camera to get the app</p>
      <p className="mute small" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{A.APP_DOWNLOAD_URL}</p>
    </div>
  </div>;
}
/** The public web app's first screen with no computer paired (mock C): Chief asks where he should work.
 *  On my computer opens the Pair sheet (#/pair); a cloud, or Chief on the phone alone, is set up in the phone app, so
 *  both rows say so. Cloud first is the release default. */
function Where({ pairing }: { pairing: boolean }) {
  const [app, setApp] = useState(false);
  const w = A.where(cloudOn);
  return <div className="where">
    <div className="where-say"><ChiefArt mascot /><div><b>Chief</b><p>{w.hello}</p></div></div>
    {w.line && <p className="where-line">{w.line}</p>}
    {w.rows.map((r, i) => <button key={r.key} className={`where-opt${i ? '' : ' first'}`} onClick={() => r.key === 'computer' ? go('#/pair') : setApp(true)}>
      <span className="where-mark"><Icon name={r.key} size={20} /></span><span className="grow"><b>{r.title}</b><span className="mute small">{r.sub}</span></span><i aria-hidden>›</i>
    </button>)}
    <div className="where-note"><Icon name="shield" size={18} /><p>{w.note}</p></div>
    <p className="where-foot">{w.later}</p>
    {pairing && <PairSheet onClose={back} />}
    {app && <Sheet label={w.app} onClose={() => setApp(false)}><h2>{w.app}</h2><AppDownloadQR /><button className="link" onClick={() => setApp(false)}>Not now</button></Sheet>}
  </div>;
}
function PhoneCard({ offer, reload }: { offer: Json; reload: () => void }) {
  const [current, setCurrent] = useState<Json>(offer);
  const [now, setNow] = useState(Date.now());
  const active = useRef(Date.now());
  const busy = useRef(false);
  useEffect(() => { if (offer.token !== current.token) setCurrent(offer); }, [offer.token]);
  const renew = async () => {
    if (busy.current) return;
    busy.current = true;
    try { setCurrent(await api.refreshPhone(current.message)); reload(); } catch { active.current = 0; toast('Could not show a new code'); }
    finally { busy.current = false; }
  };
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (now >= current.expires && now - active.current < 10 * 60_000 && !offer.waiting && !offer.joined) void renew(); }, [now, current.expires, offer.waiting, offer.joined]);
  const left = Math.max(0, Math.ceil((current.expires - now) / 1000));
  return <div className="card pair" aria-label="Add a phone" onPointerDown={() => { active.current = Date.now(); }}>
    {offer.joined ? <b>Paired: {offer.joined}</b> : offer.waiting ? <div className="grow"><b>{offer.waiting.name} would like to join</b><p>Do these two words match the phone? <b>{offer.waiting.words}</b></p><p className="mute small">This phone will answer the crew and give them jobs, as you.</p><div className="btns"><button className="btn go" onClick={() => attempt(async () => { await api.answerPhone(offer.waiting.id, true, offer.token); reload(); })}>Yes, they match</button><button className="btn" onClick={() => attempt(async () => { await api.answerPhone(offer.waiting.id, false, offer.token); reload(); })}>No</button></div></div> : <>
      {left ? <div className="qr"><PairQR text={current.qr} /></div> : <div className="qr expired">Code expired</div>}
      <div className="grow"><b>Add a phone</b><p className="small">Scan this in the phone app or type the code.</p>
        <p className="mute small">This phone will answer the crew and give them jobs, as you.</p>
        {left > 0 ? <><p className="small">Or type this code with the phone on this computer's Wi‑Fi: <b className="pair-typed">{current.typed}</b> <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(current.typed)}>Copy</button></p><p className="mute small">Works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</p></> : <button className="btn go" onClick={() => { active.current = Date.now(); void renew(); }}>Show a new code</button>}
      </div></>}
  </div>;
}
/** A crew message's card: the connect prompt for an app, or the ask's own card. */
function cardFor(c: A.Card, h: Helper | undefined, state: Json, refresh: () => void) {
  const id = `ask${c.id}`; // the thread lands on the newest open ask by this id when a footer would push it off the top
  const who = A.crew(state).find((x) => x.id === (c.by ?? c.helper)) ?? h;
  return c.kind === 'connect' ? <ConnectCard key={c.id} id={id} c={c} helper={who?.name} state={state} onDone={refresh} /> : <AskCard key={c.id} id={id} c={c} who={who} onDone={refresh} />;
}
function Chat({ id, m, state, tick, refresh, accounts, offline, hero, rail }: Ctx & { id: string; m?: string; hero?: boolean; rail?: ReactNode }) {
  const [page, setPage] = useState<Json>(null);
  const [pending, setPending] = useState<{ text: string; after: number; at: number; files?: boolean } | null>(null);
  const [partial, setPartial] = useState('');
  const [reading, setReading] = useState(0); // the line a call with Chief is reading aloud
  // The live line's own feed: crewd's pushed events with the moment they were heard, and which replies are streaming.
  const [heard, setHeard] = useState<Json[]>([]);
  const [writing, setWriting] = useState(new Map<number, number>());
  const stirred = useRef(new Map<number, number>()); // task → when anything about it last arrived; the clock re-renders
  const [now, setNow] = useState(0);
  const [seed, setSeed] = useState(0); // a starter chip fills the box from outside; remount reads the draft back
  // A search landing on an old line loads a window around it; once you send, the anchor goes and the thread reads to the end.
  const [around, setAround] = useState(m ? Number(m.slice(1)) : 0);
  // Keep the opening unread boundary after the thread's read acknowledgment.
  const mark = useRef<number | null>(null);
  const load = useCallback((ar = around) => api.bot(id, ar || undefined).then((p) => {
    mark.current ??= A.newDivider(p, id); setPage(p); keepWeek((k) => K.keepChat(k, id, p));
  }).catch(() => setPage((cur: Json) => cur ?? keptWeek().chats[id] ?? null)), [id, around]);
  useEffect(() => { void load(); }, [load, tick]);
  const base = A.lines(page, id, state);
  const said = A.savedNotes(page?.trail ?? [], hero ? A.trayNotes(state, base) : base, page?.profile, page?.messages ?? []);
  // In a helper's chat, a file delivered on its own line reads inside the helper's next words, the way it hands it over.
  const bare = (l?: A.Line) => l?.from === 'note' && !l.text && l.files.length > 0;
  const lines = id === 'chief' ? said : said.flatMap((l, i) => bare(l) && said[i + 1]?.from === 'them' ? []
    : bare(said[i - 1]) && l.from === 'them' ? [{ ...l, files: [...l.files, ...said[i - 1].files] }] : [l]);
  const echoed = pending && !(page?.messages ?? []).some((x: Json) => x.author === 'person' && x.id > pending.after && (A.plain(x.text) === A.plain(pending.text) || (!!pending.files && /\[file [a-z0-9-]+ files\/\S+/.test(x.text))));
  const waiting = pending && !(page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.id > pending.after);
  useEffect(() => { setHeard([]); setWriting(new Map()); }, [id]);
  useEffect(() => subscribe((e) => {
    if (typeof e.data?.task === 'number') stirred.current.set(e.data.task, Date.now());
    if (e.kind === 'reply.partial' && typeof e.data?.task === 'number') setWriting((w) => (w.has(e.data.task) ? w : new Map(w).set(e.data.task, Date.now())));
    if (typeof e.seq === 'number') setHeard((h) => [...h.slice(-300), { ...e, seen: Date.now() }]);
    if (e.bot !== id) return;
    if (e.kind === 'reply.partial') setPartial(/\bstub [\w-]+:/.test(e.data.text) ? '' : e.data.text);
    if (e.kind === 'message' && e.data?.author === 'bot') setPartial('');
  }), [id]);
  const crewNames = A.crew(state);
  // The card's own sign-in test silences the live line too (ch-signin-wait-truth): while no account is ready, Chief's
  // thread shows the card, never an "at work" row above it, so thread and header say one thing.
  const signedOut = id === 'chief' && chiefLocal({ accounts, offline }).signedOut;
  // Chief's send is at work in every office header too, from the send until he answers (A.office's `sent`).
  const sentTo = waiting && pending ? pending.at : undefined;
  useEffect(() => { if (id !== 'chief') return; A.setChiefSend(sentTo); return () => A.setChiefSend(undefined); }, [id, sentTo]);
  // Out of reach, the chat reads as it was kept: no live line, since nothing it shows is still running (A.officeAway).
  const ln = page && !offline && state.bots?.find((x: { id: string }) => x.id === id)?.controls !== 'person' ? A.liveLine({ id, name: crewNames.find((x) => x.id === id)?.name ?? 'Chief', crew: crewNames, writing, heard, last: stirred.current,
    tasks: [...(page.tasks ?? []), ...(id === 'chief' ? state.tasks ?? [] : [])], events: [...(page.trail ?? []), ...(state.events ?? [])],
    sent: sentTo, signedOut }) : null;
  const ticking = !!ln && ln.took === undefined && ln.state !== 'waiting';
  // A helper's read-along card does not repeat the request the thread already shows above it (Chief's hand-off line).
  const askedAbove = id !== 'chief' && !!ln?.title && lines.some((l) => l.from === 'chief' && A.plain(l.text).includes(A.plain(ln?.title ?? '')));
  // While Chief works the box's send becomes a stop square: the same reset a helper's Stop uses, its line then says so.
  const stopChief = () => void attempt(async () => { await api.reset('chief'); refresh(); });
  // The engine can say nothing for tens of seconds while the model writes a big file: never a silent gap,
  // so a run with no event for 4 s says "still working" on the live line, beside its one clock; the next event clears it.
  const quiet = ln?.state === 'working' && ln.heard !== undefined && Date.now() - ln.heard >= QUIET_MS;
  // The clock beside the step moves on each whole second of the job, so the thread never sits still.
  // A live line waiting on the person carries no clock and stays still.
  useEffect(() => {
    if (!ticking) return;
    const t = setTimeout(() => setNow(Date.now()), 1005 - ((Date.now() - ln!.since) % 1000));
    return () => clearTimeout(t);
  }, [ticking, ln?.since, now]);
  useEffect(() => { if ((page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.text === partial)) setPartial(''); }, [page, partial]);
  const phoneOffer = id === 'chief' ? A.phoneOffer(page) : null;
  const cards = page ? A.cards(state).filter((c) => c.helper === id) : [];
  const box = useRef<HTMLDivElement>(null);
  // Whether the thread is at its newest line, so a line arriving while the person reads up never yanks them down.
  // Only a scroll up lets go of it: a scroll event is read a frame after the box moved, and a composer that grew in
  // that frame (typing, the phone's keyboard) once read as reading up and left the live line under the fold for good.
  const pinned = useRef(true), top = useRef(0), seenH = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 || (pinned.current && el.scrollTop >= top.current);
    top.current = el.scrollTop;
    if (pinned.current) { seenH.current = el.scrollHeight; setNewBelow(false); }
  };
  // The person's own hand in this thread: from the first touch on, the thread never moves itself again.
  const touched = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const driving = () => { touched.current = true; };
    el.addEventListener('scroll', onScroll, { passive: true });
    for (const e of ['pointerdown', 'wheel', 'touchmove', 'click', 'keydown']) el.addEventListener(e, driving, { passive: true });
    onScroll();
    return () => { el.removeEventListener('scroll', onScroll); for (const e of ['pointerdown', 'wheel', 'touchmove', 'click', 'keydown']) el.removeEventListener(e, driving); };
  }, []);
  // A new chat opens at its own newest line, whatever the last thread was left at; its open ask may be landed on again.
  const asked = useRef(''), askedAt = useRef(-1);
  useEffect(() => { pinned.current = true; top.current = 0; seenH.current = 0; asked.current = ''; askedAt.current = -1; touched.current = false; setNewBelow(false); }, [id]);
  // Every thread scrolls in its own lines column (phone and desk alike), so the box holds itself at its newest line.
  // A scrollIntoView here once dragged the whole page up with it, hiding Chief's hero. An anchored landing scrolls
  // to the line instead. Every chat opens at its newest line under a hero that stays in place (096); a new
  // line follows only while the person is still at the bottom. A card that grows after it lands (a form
  // opening, an image loading) moves the bottom too, so the box is watched for its own size changes, not just renders.
  useEffect(() => {
    if (around) return;
    const el = box.current;
    if (!el) return;
    // The newest open ask is new to this view on a thread open or when it just arrived: while it is off the top, land
    // on it instead of the bottom, because the cards below it (a sign-in, a stuck helper) can push the ask that needs them out of
    // sight. Landing stops at the person's own hand and at the first new line the thread takes; a thread they are
    // reading an older part of is pinned off and never moved.
    const newestAsk = cards.at(-1), askId = newestAsk ? `ask${newestAsk.id}` : '', card = askId ? el.querySelector<HTMLElement>(`#${askId}`) : null;
    if (askId && asked.current !== askId) { asked.current = askId; askedAt.current = lines.length; touched.current = false; }
    // The ask's own arrival: the thread as it stands while it is still the newest thing that happened. A line, a
    // stream or the person's own hand since then means the thread has moved on and must keep its bottom.
    const land = !!askId && askedAt.current === lines.length && !partial && !echoed;
    const stick = () => {
      // Read the box first: its scroll event comes a frame late, and a stick in that frame (the live clock's tick) undid a scroll up.
      onScroll();
      // Reading up: a line landing below raises the New pill instead of moving anything.
      if (!pinned.current) { if (el.scrollHeight !== seenH.current) setNewBelow(true); return; }
      seenH.current = el.scrollHeight;
      setNewBelow(false);
      el.scrollTop = el.scrollHeight;
      const over = card?.isConnected ? card.getBoundingClientRect().top - el.getBoundingClientRect().top : 0;
      if (land && !touched.current && over < 0) { el.scrollTop += over; pinned.current = false; }   // on the ask now, not the bottom
    };
    stick();
    const raf = requestAnimationFrame(stick);
    const ro = new ResizeObserver(stick);
    ro.observe(el);   // the box itself shrinks under a growing composer
    const seen = new WeakSet<Element>();
    const watch = () => { for (const c of Array.from(el.children)) if (!seen.has(c)) { seen.add(c); ro.observe(c); } };
    watch();
    const mo = new MutationObserver(() => { watch(); stick(); });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class', 'style'] });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
  }, [lines.length, around, !!echoed, ln?.state, ln?.todos.length, partial, quiet, cards.at(-1)?.id]);
  // The landing itself: the matched line, centred, with the one motion that explains where you are.
  useEffect(() => {
    if (!around || !lines.length) return;
    const el = document.getElementById(`m${around}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('land');
    const t = setTimeout(() => el.classList.remove('land'), 1300);
    return () => clearTimeout(t);
  }, [around, lines.length]);
  const crew = A.crew(state);
  const h = crew.find((x) => x.id === id);
  const b = state.bots.find((x: Json) => x.id === id);
  const live = b?.task;
  // Seen: the chat's unread dot goes once its newest line is on screen.
  const newest = lines.at(-1)?.id;
  useEffect(() => { if (newest && b?.unread) void api.read(id).then(refresh).catch(() => {}); }, [newest, b?.unread, id, refresh]);
  const trail = live && page ? A.steps(page.trail ?? [], live.id, true) : [];
  // Each ask's card sits at the end of the turn that raised it, before the next message the person sent (A.cardSlots).
  const slots = A.cardSlots(lines, cards);
  // Chief's thread: each job he handed a helper, as one chip after the turn that handed it on (A.handChips).
  const hands = id === 'chief' ? A.handChips(state, lines) : null;
  // A helper's ended job is already a chip on this thread, so its end line is not said twice.
  const chipped = !!ln?.task && (!!hands?.tail.some((c) => c.task === ln.task) || [...(hands?.before.values() ?? [])].some((cs) => cs.some((c) => c.task === ln.task)));
  const receipts = page ? A.answeredReceipts(state).filter((r) => r.helper === id) : [];
  // An answered card leaves a muted outcome in time order, above the result it let through (A.receiptSlots).
  const receiptSlots = A.receiptSlots(lines, receipts);
  const last = lines.at(-1);
  // The newest answer reads in full, never folded; older long answers keep the 700-char fold behind More.
  const newestAnswer = [...lines].reverse().find((l) => (l.from === 'them' || l.from === 'chief') && (l.text || l.detail))?.id;
  const answered = newestAnswer !== undefined || !!partial;
  // The Add-your-phone card waits below Chief's first answer, never between the first ask and the answer, and never at
  // the thread's foot: the thread holds its newest line, so a footer card filled a phone screen after every send and
  // hid the echo, the live line and the reply above it.
  const firstAnswer = id === 'chief' ? lines.find((l) => l.from === 'them' && l.text)?.id : undefined;
  // The newest finished sheet or page in Chief's thread is a Done card until the person speaks again, opens it or says
  // Later (Stack J16a); a person's line after it ends the moment.
  const [kept, setKept] = useState(keptDone);
  const made = (f: A.FileView) => (f.kind === 'sheet' || f.kind === 'page') && !f.review && !A.sentFile(f);
  const doneLine = id === 'chief' ? lines.findLast((l) => l.from === 'me' || l.files.some(made)) : undefined;
  const doneFile = doneLine?.from === 'me' ? undefined : doneLine?.files.find((f) => made(f) && !kept.includes(f.url));
  const doneBy = doneFile && makerOf(state, A.fileSource(doneFile.url)?.bot ?? '');
  const keep = (f: A.FileView, later: boolean) => {
    const put = (urls: string[]) => { try { localStorage.setItem(KEPT_DONE, JSON.stringify(urls.slice(-200))); } catch { /* this visit only */ } setKept(urls); };
    put([...kept, f.url]);
    if (later) toast(`Kept: ${f.name}`, { label: 'Undo', run: () => put(kept) });
  };
  // A quick end goes unsaid only when its reply is in the thread to say it; a reply the thread drops leaves the end line.
  const replied = !!ln?.task && (page?.messages ?? []).some((x: Json) => x.task_id === ln.task && x.author === 'bot' && lines.some((l) => l.id === x.id));
  // The New pill's tap: back to the newest line and pinned again — the same hand a send is.
  const jump = () => {
    pinned.current = true; touched.current = false;
    const el = box.current;
    if (el) { el.scrollTop = el.scrollHeight; seenH.current = el.scrollHeight; }
    setNewBelow(false);
  };
  // The inbox alert being answered (its line id): Answer sets it; a sent answer or ✕ clears it.
  const [answering, setAnswering] = useState<number>();
  const send = async (said: string, files?: { name: string; type: string; data: string }[]) => {
    // An answer to an inbox alert's question carries it as a quote: the person sees what they answered, and Chief reads
    // the exact question (his earlier lines reach him only in short).
    const ask = answering !== undefined && answering === last?.id && said ? last.inbox?.ask : undefined, t = ask ? `> ${ask}\n\n${said}` : said;
    // A send is the person's own hand reaching the newest line: re-pin at once so the echo
    // bubble and the live line are visible in the first frame, even from scrolled-up reading.
    pinned.current = true; touched.current = false;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    setPending({ text: t || (files ?? []).map((f) => f.name).join(', '), files: !!files?.length, after: page?.messages?.at(-1)?.id ?? 0, at: Date.now() });
    setPartial('');
    // The first words of a new install, if short, answer Chief's "What shall I call you?"; anything longer is already the first job.
    const named = id === 'chief' && !state.person.onboarded && !files?.length && A.asName(t);
    const ok = await attempt(() => named ? api.onboard(t, undefined, undefined, true) : api.post(id, t, undefined, undefined, files?.map(({ name, type, data }) => ({ name, type, data }))), undefined, true);
    if (ok) { setAround(0); setAnswering(undefined); void load(0); refresh(); } else setPending(null);
    return ok;
  };
  const name = h?.name ?? 'Chief';
  // An inbox alert's Answer: the person's own box, under an "Answering Chief" strip naming the question.
  const answerTo = answering !== undefined && answering === last?.id ? last.inbox?.ask : undefined;
  const answerBox = () => { setAnswering(last?.id); box.current?.closest('.chat')?.querySelector<HTMLTextAreaElement>('.dock textarea')?.focus(); };
  // Take back a memory the crew just kept: crewd's own undo for a note, or drop the sentence from the shared record.
  const undoMemory = (l: A.Line) => attempt(async () => {
    if (l.memory !== undefined) await api.undoMemory(id, l.memory);
    else if (l.saved) { const p = await api.profile(); await api.setProfile(A.profileText(A.profileParts(p.text ?? '').filter((x) => x !== l.saved))); }
    void load(); refresh();
  }, 'Undone');
  // A fresh chat shows starters: nothing yet, or only the hidden "X joined the crew" note from recruiting.
  const fresh = !lines.length || (lines.length === 1 && lines[0].from === 'note' && lines[0].text.startsWith(`${name} joined the crew`));
  // Lines that arrive while you watch rise in; the thread you open with is simply there.
  const opened = useRef<number | null>(null);
  if (opened.current === null && page) opened.current = page.messages?.at(-1)?.id ?? 0;
  // The top of the thread (crewd sends the newest 200): who this is, before the first line.
  const start = !!page && !around && (page.messages?.length ?? 0) < 200;
  let day = '';
  const dayOf = (t?: number) => { if (!t) return null; const d = A.dayLabel(t); if (d === day) return null; day = d; return <div className="day" role="separator"><span>{d}<span className="day-time"> {A.timeOf(t)}</span></span></div>; };
  return (
    <div className={`chat${live && h ? ' with-live' : ''}`}>
      <div className="lines" ref={box}>
        {start && !hero && (id === 'chief' || fresh) && <div className="chat-intro">
          <span className="halo">{h ? <PalArt kind={h.kind} mood={h.mood} id={h.id} d={4.4} name={h.name} /> : <ChiefArt mood="idle" d={3.6} />}</span>
          <b>{name}</b><span>{h ? h.role : 'Runs the crew and answers to you'}</span>
        </div>}
        {!page && <div className="skeleton" aria-busy="true" aria-label="Opening the chat"><i /><i /><i /></div>}
        {fresh && page && (id === 'chief'
          ? <ChiefIdeas state={state} chat={id} picked={() => setSeed((n) => n + 1)} />
          : <HelperIdeas state={state} chat={id} name={name} />)}
        {lines.map((l, i) => {
          const speaker = l.helper ? A.crew(state).find((x) => x.id === l.helper) : undefined;
          // A card raised earlier in this turn shows above this line: the ask that ends a turn sits after its reply.
          // An answered card's muted outcome shows just above this line, in time order (A.receiptSlots).
          const before = [
            ...(slots.before.get(i) ?? []).map((c) => cardFor(c, h, state, refresh)),
            ...(receiptSlots.before.get(i) ?? []).map((r) => <AnsweredCard key={`a${r.id}`} line={r.line} what={r.what} word={r.word} rule={r.rule} />),
            ...(hands?.before.get(i) ?? []).map((c) => <HandOff key={`h${c.task}`} c={c} state={state} />),
          ];
          // Chief's hand-off reads as the plain task: the line above already says "Chief to <name>".
          const content = <>{l.inbox ? <div className="bubble-text inbox-bubble"><InboxAlert inbox={l.inbox} at={l.at} answer={l.id === last?.id && l.inbox.ask ? answerBox : undefined} /></div>
            : l.mailDown ? <div className="bubble-text inbox-bubble"><InboxDown cause={l.mailDown} /></div>
            : l.text && !(doneBy && l.id === doneLine?.id) && <div className="bubble-text"><ChatText text={l.detail ? l.text.replace(/^From Chief: /, '') : l.text} latest={l.id === newestAnswer} /></div>}
            {l.files.map((f) => f === doneFile && doneBy ? <DoneCard key={f.url} f={f} who={doneBy} text={l.text || f.name} settle={(later) => keep(f, later)} />
              : <Media key={f.url} f={f} big forget who={id === 'chief' ? makerOf(state, A.fileSource(f.url)?.bot ?? '') : undefined} />)}</>;
          const wrap = l.memory !== undefined || l.saved
            ? <div className="line-wrap">{dayOf(l.at)}<AnsweredCard line={l.text} undo={() => undoMemory(l)} /></div>
            : <div className="line-wrap">{dayOf(l.at)}
          <div id={`m${l.id}`} className={`line ${l.from}${l.event ? ' chat-event' : ''}${l.unsure ? ' unsure' : ''}${l.recap ? ' recap' : ''}${l.id > (opened.current ?? Infinity) ? ' fresh' : ''}${l.id === reading ? ' reading' : ''}`}>
            {l.from !== 'note' && <div className="line-by">{(hero || id !== 'chief') && l.from !== 'me' && <Face who={id === 'chief' ? speaker ?? 'chief' : l.from === 'chief' ? 'chief' : speaker ?? h!} size={hero ? 36 : 28} />}<span className="who">{l.from === 'me' ? 'You' : l.from === 'chief' ? (id === 'chief' ? 'Chief' : `Chief to ${name}`) : speaker?.name ?? name}</span><time className="sr">{l.at ? A.clock(l.at) : ''}</time></div>}
            {l.by && <span className="note-by" aria-hidden />}
            {id === 'chief' || !l.text || l.from === 'note' ? content : <div className="helper-bubble">{content}</div>}
            {l.retry && <button type="button" className="btn sm try-again" onClick={() => void send(l.retry!)}>Try again</button>}
            {answered && phoneOffer?.message === l.id && <PhoneCard offer={phoneOffer} reload={() => void load()} />}
          </div></div>;
          const shown = start && i === 0 && l.from === 'note' && l.text.startsWith(`${name} joined the crew`);
          return <Fragment key={l.id}>{before}{l.id === mark.current && <div className="new-divider" role="separator"><span>New</span></div>}{shown ? null : wrap}
            {l.id === firstAnswer && <AddPhonePrompt accounts={accounts} tick={tick} />}</Fragment>;
        })}
        {id === 'chief' && A.campaignOutcomes(state).map((c) => <CampaignReceipt key={c.id} outcome={c} />)}
        {echoed && <div className="line me fresh sending"><div className="line-by"><span className="who">You</span></div><div className="bubble-text"><ChatText text={pending.text} latest /></div></div>}
        {!!partial && <div className="line them streaming" aria-live="polite"><div className="line-by"><Face who={id === 'chief' ? 'chief' : h!} size={hero ? 36 : 28} /><span className="who">{name}</span></div><div className="bubble-text"><ChatText text={partial} latest /></div></div>}
        {hands?.tail.map((c) => <HandOff key={`h${c.task}`} c={c} state={state} />)}
        {ln && <LiveRow ln={ln} quiet={quiet} chipped={chipped} replied={replied} asked={askedAbove} who={A.crew(state).find((x) => x.id === ln.helper) ?? (id === 'chief' ? undefined : h)} />}
        {A.building(lines, live) && <div className="line them" role="status"><div className="line-by"><span className="who">{name}</span></div><div className="building-card" aria-label="Building it"><i aria-hidden /><i aria-hidden /><div className="bubble-text">Building it. I’ll share it here.</div></div></div>}
        {id === 'chief' && A.firstChips(lines, state) && <FirstTry state={state} send={send} />}
        {last?.choices.length ? <div className="chips">{last.choices.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div> : null}
        {slots.tail.map((c) => cardFor(c, h, state, refresh))}
        {receiptSlots.tail.map((r) => <AnsweredCard key={`a${r.id}`} line={r.line} what={r.what} word={r.word} rule={r.rule} />)}
        {A.stuckIn(crewNames, id).map((x) => <Stuck key={x.id} h={x} refresh={refresh} />)}
        <AccountCard accounts={accounts} inChat onReady={() => { void load(); refresh(); }} />
        {h?.seat === 'waiting' && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. {name} carries on then.</span></div>}
        {newBelow && <button className="new-pill" onClick={jump} aria-label="Jump to the newest line">↓ New</button>}
      </div>
      <aside className={`working-on${rail ? ' tonight-rail' : ''}`}>
        {rail}
        {id !== 'chief' && h && <>
          <HelperPortrait h={h} />
          {A.made(state, id).length > 0 && <><h2 className="label">What {name} made</h2><div className="st-made">{A.made(state, id).map((f) => <Media key={f.url} f={f} />)}</div></>}
          <h2 className="label">{name}'s job</h2>{page && <JobSection page={page} />}
        </>}
        {!rail && live && h && <section className="working-on-frame"><div className="label">Working on</div><div className="list-group"><div className="work-title"><b>{A.plain(live.title)}</b><span className="small">{h.status}</span></div>{trail.length > 0 && <Steps steps={trail} max={3} />}<a className="link" href={`#/h/${id}/did`}>What happened ›</a></div></section>}
        {id === 'chief' && <MadeHere made={hero ? A.madeInChat(state, page)
          : A.things(state).filter((x) => x.helper === id).map((x) => ({ key: `t${x.id}`, name: x.title, by: '', at: x.at, f: x.files[0], href: `#/things/t${x.id}`, chip: '—', ...(x.files[0] && A.fileTarget(x.files[0])) }))} />}
      </aside>
      <div className="dock">{answerTo && <div className="reply-to"><div className="grow"><b>Answering Chief</b><span>{answerTo}</span></div><button type="button" className="icon-btn" aria-label="Not answering" onClick={() => setAnswering(undefined)}>×</button></div>}
        <Composer key={seed} placeholder={answerTo ? 'Your answer for Chief…' : id === 'chief' ? 'Tell Chief anything…' : `Talk to ${name}…`} onSend={send} stop={id === 'chief' && (ln?.state === 'working' || ln?.state === 'reading') ? stopChief : undefined} chips={hero ? [] : undefined} talk={{ chat: id, name, lines, reading: setReading }} {...typeInto(id)} /></div>
    </div>
  );
}

/** Is a finished job's result already on the screen? A helper's own chat shows it; so does Chief's thread (Home's chat
 *  view, or `#/chief`) for a job he handed over, where its chip turns to done. */
function resultOpen(state: Json, t: A.Thing) {
  const here = parseRoute();
  if (here.view === 'helper') return here.id === t.helper;
  return here.view === 'chief' && state.tasks.some((x: Json) => x.id === t.id && x.origin === 'chief');
}

/** Chief's hand-off as the person sees it: what the helper may do and the one limit, in crewd's words from its grants
 *  (A.limitOf), then "Asked Penny" with the job's state, into the helper's chat. */
function HandOff({ c, state }: { c: A.HandChip; state: Json }) {
  const h = A.crew(state).find((x) => x.id === c.helper);
  if (!h) return null;
  return <div className="line them hand-off"><div className="line-by" aria-hidden />
    {c.limit && <p className="bubble-text hand-limit">{c.limit}</p>}
    <a className={`hand${c.done ? ' done' : ''}`} href={hrefOf(h.id)}><Face who={h} size={32} /><span>Asked <b>{h.name}</b></span>
      {c.done ? <span className="hand-ok" aria-hidden>✓</span> : c.working && <i className="hand-dot" aria-hidden />}<span className={`hand-word${c.done ? '' : ' sr'}`}>{c.word}</span><span className="chev" aria-hidden>›</span></a>
  </div>;
}

const LIVE_WORD: Record<A.LiveLine['state'], string> = { reading: A.WORDS.work, working: A.WORDS.work, needs: A.WORDS.needs, waiting: A.WORDS.wait,
  done: A.WORDS.done, failed: A.WORDS.failed, unsure: A.WORDS.unsure };
/** The live job card under a thread (J03): who is on it in their colour, the job's title and status, a clock counting up,
 *  and the job as a check list — done, doing, still to do — with the small tool calls kept behind the expand. At the
 *  end, one quiet line with how long it took. A job passed to a helper opens that helper's chat. */
const QUIET_MS = 4000;
function LiveRow({ ln, quiet, chipped, replied, asked, who }: { ln: A.LiveLine; quiet: boolean; chipped: boolean; replied: boolean; asked: boolean; who?: A.Helper }) {
  // A crew member waiting on the person reads the neutral "Waiting"; only Chief's own line says "Needs you".
  const word = ln.stopped ? 'Stopped' : ln.state === 'needs' && !ln.chief ? A.WORDS.wait : LIVE_WORD[ln.state];
  // Chief's own reply done in under a second says nothing worth a line: "Done · 0 s" goes, once the reply is there; a failed one waits for its reply, so the line never shows alone before it.
  if (ln.took !== undefined) return chipped || (!ln.helper && !ln.stopped && !replied && ln.state !== 'done') || (ln.state === 'done' && ln.took < 1000 && !ln.helper && replied) ? null : <div className={`live-end ${ln.state}`} role="status">
    <span>{ln.helper ? `${ln.who} · ${word.toLowerCase()}` : word} · {A.took(ln.took)}{ln.count ? ` · ${ln.count} ${ln.count === 1 ? 'step' : 'steps'}` : ''}</span>{ln.helper && <a className="link" href={`#/h/${ln.helper}`}>Open chat ›</a>}</div>;
  const at = ln.todos.findIndex((s) => s.state === 'doing');
  return <div className={`line them live-line ${ln.state}`}><div className="line-by" aria-hidden><Face who="chief" size={36} /></div>
    <div className="live-body" style={ln.helper && who ? { background: art.colourOf(who.kind) } : undefined}>
      <div className="live-top"><Face who={who ?? 'chief'} size={40} />{!asked && <b className="grow">{A.plain(ln.title ?? ln.who)}</b>}<span className="st-pill">{word}</span></div>
      <div className="live-head"><span className="live-word"><i aria-hidden /><span>{ln.who}{at >= 0 && ln.todos.length > 1 ? ` · step ${at + 1} of ${ln.todos.length}` : ''}{ln.state === 'waiting' ? null : <> · <span aria-hidden>{A.took(Date.now() - ln.since)}</span></>}{quiet && <span role="status"> · still working</span>}</span></span></div>
      <ol className="live-todos" aria-live="polite">{ln.todos.map((s) => <li key={`${s.at}-${s.text}`} className={s.state}>
        <span className={`tick ${s.state}`} aria-hidden>{s.state === 'done' ? '✓' : ''}</span><span>{s.text}</span></li>)}</ol>
      {!!ln.next && <p className="live-next">Next: {ln.next}</p>}
      {!!ln.detail.length && <details className="live-detail"><summary>Show the small steps ({ln.detail.length})</summary>
        <ol>{ln.detail.map((s) => <li key={`${s.at}-${s.text}`}><time className="time">{A.clock(s.at)}</time><span>{s.text}</span></li>)}</ol></details>}
      {ln.helper && <a className="btn live-open" href={`#/h/${ln.helper}`}>Open</a>}
    </div>
  </div>;
}

function Room(ctx: Ctx) {
  const { state, tick, refresh } = ctx;
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.room().then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const lines = A.room(page, state);
  const newestRoom = [...lines].reverse().find((l) => l.text)?.id;
  const helpers = A.crew(state);
  const cards = A.cards(state).filter((c) => (page?.asks ?? []).some((a: Json) => a.id === c.id));
  return <div className="page chat-page room-page st-helper-chat"><header className="chat-head sticky-top"><a href="#/" className="back">‹</a><span className="row">{helpers.slice(0, 3).map((h) => <Face key={h.id} who={h} size={30} />)}</span><div className="grow"><b>The crew</b><div className="mute small">Who asked whom</div></div></header>
    <div className="chat"><div className="lines">{lines.length ? lines.map((l: ReturnType<typeof A.room>[number]) => <div className={`line ${l.author === 'person' ? 'me' : l.author === 'note' ? 'note' : 'them'}${l.standup ? ' standup' : ''}`} key={l.id}>
      {l.who && l.author !== 'note' && <div className="row">{l.author !== 'person' && <Face who={l.who.id === 'chief' ? 'chief' : l.who} size={30} />}<b>{l.standup ? 'Chief’s standup' : l.from && l.to ? `${l.from} to ${l.to}` : l.author === 'person' ? 'You to ' + l.who.name : l.who.name}</b></div>}
      {l.text && <div className="bubble-text helper-bubble"><ChatText text={l.text} latest={l.id === newestRoom} /></div>}{l.files.map((f: ReturnType<typeof A.room>[number]['files'][number]) => <Media key={f.url} f={f} big forget />)}
    </div>) : <div className="mute center empty">Start a job here and follow along as the crew works together.</div>}
      {cards.map((c) => <AskCard key={c.id} c={c} who={helpers.find((h) => h.id === (c.by ?? c.helper))} onDone={() => { void load(); refresh(); }} />)}</div>
      <aside className="working-on"><div className="label">Who's on it</div><div className="card list">
        <div className="row-item"><Face who="chief" size={44} /><span className="grow"><b>Chief</b><span className="small">Hands out the jobs</span></span></div>
        {A.roster(ctx.live.crew).map((c) => <div className="row-item" key={c.id}><Face who={c} size={44} /><span className="grow"><b>{c.name}</b><span className="small">{A.statusOf(c, ctx.live).word}</span></span></div>)}</div></aside>
      <div className="dock read-along"><p className="ro"><Icon name="lock" /><span>You can read along here. To change a job, ask Chief.</span></p><a className="btn" href="#/chief">Ask Chief about this</a></div>
    </div></div>;
}

// ---------- the crew ----------
// A tile per member in their own colour (Stack), Chief first: each pill is the member's one status, the rail's own
// (A.chiefStatus, A.statusOf), so the page can never disagree with Home or the rail. The tile keeps one short role line
// (A.tagOf); the full role is on the member's sheet.
function Crew(ctx: Ctx) {
  const { state, live } = ctx;
  const out = chiefLocal(ctx).signedOut && !ctx.offline;
  const roles = new Map(A.crew(state).map((h) => [h.id, A.tagOf(h)]));
  const tile = (href: string, who: Parameters<typeof Face>[0]['who'], kind: art.Kind | 'chief', name: string, word: string, role: string) =>
    <a key={href} className={`st-tile ${kind === 'chief' ? 'st-chief' : ''}`} href={href} style={{ background: art.colourOf(kind) }} aria-label={`${name}: ${word}`}><span className="st-pill">{word}</span><Face who={who} size={72} /><b className="semi">{name}</b><span>{role}</span></a>;
  return <div className="page stack rest-screen"><a href="#/" className="back phone-only">‹ Home</a><h1 className="wide">Your crew</h1><p className="st-line">Chief deals each job to one of them. Tap one to see what they are doing.</p>
    <div className="st-tiles">
      {tile('#/chief', 'chief', 'chief', 'Chief', chiefWord(live, out, ctx.offline), 'Hands out the jobs')}
      {A.roster(live.crew).map((c) => tile(hrefOf(c.id), c, c.kind, c.name, A.statusOf(c, live).word, roles.get(c.id) ?? ''))}
      <a className="st-tile st-new" href="#/crew/add"><Icon name="plus" size={36} /><b className="semi">Add a helper</b><span>Tell Chief who you need</span></a>
    </div>
    {live.crew.length > 0 && <a className="st-idea st-room" href="#/room"><span className="grow"><b>The crew room</b><span>{A.chats(state).at(-1)!.line}</span></span><Icon name="next" /></a>}</div>;
}

function AddHelper({ state, refresh }: Ctx) {
  const welcome = async (t: Json) => {
    let id = '';
    if (await attempt(async () => { id = (await api.recruit(t.id, t.name)).id; }, `${t.name} joined the crew`)) { refresh(); go(`#/h/${id}`); }
  };
  const hired = new Set(A.crew(state).map((h) => h.name));
  return (
    <div className="page rest-screen st-add">
      <a href="#/crew" className="back" aria-label="Back">‹</a><h1>Add a helper</h1><p className="lead">Pick one, or tell Chief who you need. Chief asks you before anyone joins.</p>
      <div className="st-tiles">
        {A.gallery(state).map((t: Json) => hired.has(t.name)
          ? <div key={t.id} className="st-tile" style={{ background: art.colourOf(t.kind) }}><span className="st-pill">On the crew</span><Face who={{ kind: t.kind, name: t.name }} size={72} /><b className="semi">{t.name}</b><span>{t.does}</span></div>
          : <button key={t.id} className="st-tile" style={{ background: art.colourOf(t.kind) }} onClick={() => welcome(t)} aria-label={`Add ${t.name}`}><span className="st-pill st-add-pill">Add</span><Face who={{ kind: t.kind, name: t.name }} size={72} /><b className="semi">{t.name}</b><span>{t.does}</span></button>)}
      </div>
      <div className="label">Someone else?</div><Composer placeholder="Tell Chief who you need…" onSend={async (t) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) go('#/chief'); return ok; }} {...typeInto('chief')} />
    </div>
  );
}

function HelperPortrait({ h, children }: { h: A.Helper; children?: ReactNode }) {
  return <div className="st-profile-hero">{children}<Face who={h} size={112} /><h1>{h.name}</h1><p>{h.role}</p></div>;
}

function HelperPage(ctx: Ctx & { id: string; tab: string }) {
  const { id, tab, state, tick, refresh, offline } = ctx;
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  // Chief has no helper card, but his Every-step trail (with Undo for what he learned) is the same view: admit him for it.
  if (id === 'chief' && ['details', 'instructions', ...THINGS.map(([k]) => k)].includes(tab)) return <ChiefProfile {...ctx} tab={tab} page={page} />;
  if (!h && id !== 'chief') return <div className="page stack rest-screen"><a href="#/crew" className="back">‹ Crew</a>{!state.bots.some((b: Json) => b.id === id) && <><h1 className="wide">This helper has left the crew.</h1><p className="lead">You can ask Chief to find someone else.</p><a className="btn" href="#/chief">Talk to Chief</a></>}</div>;
  const b = state.bots.find((x: Json) => x.id === id);
  const name = h?.name ?? 'Chief';
  // The chat is the page; everything else lives behind Details. Old deep links to a section land on Details too.
  const details = tab !== 'chat' && tab !== 'did' && tab !== 'screen';
  const trail = page ? A.steps(page.trail ?? [], b?.task?.id, true) : [];
  const apps = A.appsOf(state, id);
  const member = ctx.live.crew.find((c) => c.id === id), lastJob = A.things(state).find((t) => t.helper === id);
  const word = member ? A.statusOf(member, ctx.live).word : h?.status;
  // The button calls a "<Role> <Name>" helper by its name, as the render does ("Ivy's job"), so it stays one line.
  // ponytail: a two-word rule; a short name of its own in bot.json if helpers stop being named "<Role> <Name>".
  const short = name.split(' ').length === 2 ? name.split(' ')[1] : name;
  // The trail's Undo and Forget, the same on the profile's What happened and on every step.
  const undo = (s: A.Step) => attempt(async () => {
    const ev = (page.trail ?? []).find((e: Json) => e.seq === s.seq);
    if (ev?.kind === 'soul.changed') {
      if (!ev?.data?.prev) throw new Error('Nothing to undo');
      await api.soul(id, String(ev.data.prev));
    } else await api.undoMemory(id, s.seq);
    void load();
  }, 'Put back');
  const forget = (s: A.Step) => attempt(async () => {
    // The receipt's own reason, taken back from what this helper remembers: the next job reads notes afresh.
    // Matched the way crew_draft matched it (case-insensitive): the model quotes the line in its own casing.
    const i = A.memories(page.notes ?? '').findIndex((m) => m.toLowerCase() === (s.forget ?? '').toLowerCase());
    if (i < 0) throw new Error('That line is not one of its own notes; ask Chief to change it');
    await api.notes(id, A.withoutMemory(page.notes ?? '', i));
    void load();
  }, 'Forgotten');
  return (
    <div className={`page helper ${tab === 'chat' ? 'chat-page st-helper-chat' : details ? 'st-profile' : tab === 'did' ? 'st-helper-chat st-trail' : 'st-screen'}`} style={h ? { '--helper-colour': art.colourOf(h.kind) } as CSSProperties : undefined}>
      {tab === 'chat' && h && <>
        <div className="sticky-top">
          <header className="chat-head">
            <a href="#/" className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
            <Face who={h} size={44} />
            <div className="grow"><b>{h.name}</b><span className="st-reading">Reading along</span></div>
            <a className="st-gear" href={`#/h/${id}/details`} aria-label={`${name}'s profile`}><Icon name="crew" /></a>
          </header>
          {(b?.task || h.driving) && <LiveControl h={h} word={word ?? ''} refresh={refresh} />}
        </div>
        <Chat key={id} {...ctx} id={id} />
      </>}
      {details && h && <>
        <header className="chat-head st-profile-head desk-only"><Face who={h} size={44} /><div className="grow"><h1>{name}</h1><span className="mute">{h.role}</span></div><span className="st-pill">{word}</span><a className="st-gear" href={`#/h/${id}/chat`} aria-label={`Read along with ${name}`}><Icon name="talk" /></a></header>
        <div className="st-profile-layout">
          <section className="st-profile-main">
            <div className="st-profile-overview">
              <HelperPortrait h={h}><div className="st-profile-controls"><a href={`#/h/${id}/chat`} className="st-gear" aria-label={`Read along with ${name}`}><span aria-hidden>‹</span></a><span className="st-pill">{word}</span></div></HelperPortrait>
              <h2 className="st-label">Now</h2>
              {b?.task ? (trail.length ? <Steps steps={trail} max={7} /> : <p>Working on “{A.plain(b.task.title)}”. Steps show as they happen.</p>)
                : <p className="st-now">Nothing right now.{lastJob && <> Last job: {lastJob.title}.</>}</p>}
              <a className="link phone-only" href={`#/h/${id}/did`}>What happened ›</a>
              <h2 className="st-label">What {name} made</h2>
              {A.made(state, id).length ? <div className="st-made">{A.made(state, id).map((f) => <Media key={f.url} f={f} />)}</div>
                : <div className="card empty">{name}'s finished work shows up here.</div>}
            </div>
            <div className="st-profile-job">
              <h2 className="st-label">{name}'s job</h2>
              {page && <JobSection page={page} />}
              <h2 className="st-label">What {name} remembers</h2>
              {page && <Remembers id={id} name={name} page={page} reload={load} />}
              <button className="btn st-change" onClick={() => { keepDraft('chief', `I'd like to change ${name}'s job: `); go('#/chief'); }}>Ask Chief to change {short}'s job</button>
              <details className="st-profile-more"><summary>More about {name}</summary>
                <LearnedRows name={name} />
                <h2 className="st-label">Routines</h2><RoutineList {...ctx} bot={id} />
                <h2 className="st-label">About {name}</h2>{page && <AboutMe id={id} name={name} page={page} reload={load} />}
                <h2 className="st-label">{name}'s apps</h2>
                {apps.length ? <div className="card list">{apps.map((a) => <div key={a.id} className="row-item"><span className="grow">{a.name}</span><span className="mute small">{a.connected ? 'Connected' : 'Not connected yet'}</span></div>)}</div>
                  : <div className="card empty">{name} uses none of your apps.</div>}
                {A.signedIn(page).length > 0 && <><h2 className="st-label">Signed in to</h2><div className="card list">{A.signedIn(page).map((host) => <div key={host} className="row-item"><span className="grow">{host}</span><button className="link" onClick={() => attempt(async () => { await api.forget(id, host); void load(); }, 'Forgotten')}>Forget</button></div>)}</div></>}
                {h.computer && <><h2 className="st-label">See {name}'s screen</h2><Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} /></>}
              </details>
            </div>
          </section>
          <aside className="st-profile-trail desk-only"><h2 className="st-label">What happened</h2>{page && <Steps steps={A.steps(page.trail ?? [])} max={7} onUndo={undo} onForget={forget} />}<a className="link" href={`#/h/${id}/did`}>See every step ›</a></aside>
        </div>
      </>}
      {tab === 'did' && (page ? <>
        <div className="sticky-top"><header className="chat-head">
          <a href={id === 'chief' ? '#/chief' : `#/h/${id}/details`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
          <div className="grow"><b>What happened</b><span className="st-reading">{name}, as it happened</span></div>
        </header></div>
        {A.steps(page.trail ?? []).length ? <Steps trail steps={A.steps(page.trail ?? [])} max={40} onUndo={undo} onForget={forget} />
          : <div className="card empty">Nothing yet. Give {name} something to do.</div>}
        <p className="st-recorded"><Icon name="lock" /><span>Recorded by Crewhouse, not remembered by {short}.</span></p>
      </> : null)}
      {tab === 'screen' && b?.computer && <div className="sticky-top"><header className="chat-head">
        <a href={`#/h/${id}/details`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a><div className="grow"><b>Computer</b></div></header></div>}
      {tab === 'screen' && b?.computer && <Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} />}
    </div>
  );
}

/** Chief's profile, one page (mock profile-b, tapped from his hero): his routines, the computer with Take control (his own,
 *  or the helper's on one now; an empty state when none has one), his one notification switch, his instructions and his things. */
const THINGS = [['files', 'Files', 'Files you send Chief, or the crew makes, land here.'], ['links', 'Links', 'Links you or the crew share in the chat land here.'],
  ['pictures', 'Pictures', 'Photos and screenshots you send Chief, or the crew makes, land here.']] as const;
function ChiefProfile(ctx: Ctx & { tab: string; page: Json }) {
  const { state, refresh, tab, page } = ctx;
  const crew = A.crew(state), all = A.routines(state);
  // ponytail: read from the chat crewd sends (its last 200 lines); an older file drops off, a things API if that matters.
  const stuff = A.chatThings(state, page), list = THINGS.find(([k]) => k === tab);
  const [notify, setNotify] = useState<boolean | null>(null);
  useEffect(() => { api.notify().then((n) => setNotify(n.on)).catch(() => {}); }, []);
  // The computer to show: whoever you or the crew are on now, else Chief's own, else the first helper with one.
  const me = state.bots.find((b: Json) => b.id === 'chief'), desk = page?.tools?.find((t: Json) => t.id === 'computer');
  const pcs = [...(me?.computer ? [{ id: 'chief', name: 'Chief', driving: me.controls === 'person', working: !!me.task }] : []),
    ...crew.filter((h) => h.computer).map((h) => ({ id: h.id, name: h.name, driving: h.driving, working: h.seat === 'working' }))];
  const pc = pcs.find((p) => p.driving) ?? pcs.find((p) => p.working) ?? pcs[0];
  const who = (r: Json) => (r.helper === 'chief' ? '' : `${crew.find((h) => h.id === r.helper)?.name ?? 'Chief'} does it`);
  // A page behind the profile: a round back, its name, and "Chief's profile" under it (J09d).
  const head = (title: string) => <div className="sticky-top"><header className="chat-head cp-subhead">
    <a href={CHIEF_PROFILE} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a><div className="grow"><b>{title}</b><span className="mute">Chief's profile</span></div></header></div>;
  if (tab === 'instructions') return <ChiefWorks tick={ctx.tick} rules={page?.rules ?? ''} head={head('How Chief works')} />;
  if (list) return <div className="page helper">{head('Things')}<section className="detail rest-screen chief-profile">
    <div className="seg cp-seg" role="tablist" aria-label="Things">{THINGS.map(([k, l]) => <button key={k} role="tab" aria-selected={k === tab} className={k === tab ? 'on' : ''}
      onClick={() => location.replace(`#/h/chief/${k}`)}>{l} {stuff[k].length}</button>)}</div>
    {stuff[list[0]].length ? <><div className="card list">{stuff[list[0]].map((x) => { const out = !x.href.startsWith('#');
      return <a key={x.key} className="row-item cp-link" href={x.href} target={out ? '_blank' : undefined} rel={out ? 'noreferrer' : undefined}>
        {x.f?.kind === 'image' ? <img className="cp-thumb" src={x.f.url} alt="" /> : <span className="file-chip" data-ext={x.chip}>{x.chip}</span>}
        <span className="grow"><span className="clamp1">{x.name}</span><span className="mute small">{[x.by, x.at ? A.clock(x.at) : ''].filter(Boolean).join(' · ')}</span></span><span className="mute">›</span></a>; })}</div>
      <p className="mute small">Everything made or read in your chat with Chief, newest first.</p></>
      : <div className="card empty cp-none"><b>No {list[1].toLowerCase()} yet</b><span className="mute small">{list[2]}</span></div>}
  </section></div>;
  const go2 = (href: string, title: string, says: string) => <a className="row-item cp-link" href={href}><span className="grow"><b>{title}</b>{says && <span className="mute">{says}</span>}</span><Icon name="next" /></a>;
  return <div className="page helper st-profile chief-profile" style={{ '--helper-colour': art.colourOf('chief') } as CSSProperties}>
    <header className="chat-head st-profile-head desk-only"><Face who="chief" size={44} /><div className="grow"><h1>Chief's profile</h1><span className="mute">Runs your crew</span></div></header>
    <div className="st-profile-layout"><section className="st-profile-main">
      <div className="st-profile-overview">
        <a href="#/chief" className="back cp-back phone-only" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
        <div className="st-profile-hero"><Face who="chief" size={112} /><h1>Chief</h1><p>Runs your crew</p></div>
      </div>
      <div className="st-profile-job">
        <h2 className="st-label">Routines</h2>
        <div className="card list">
          {all.slice(0, 2).map((r: Json) => <label key={r.id} className="row-item">
            <span className="grow"><b className="clamp1">{r.name}</b><span className="mute">{[r.when, who(r)].filter(Boolean).join(' · ')}</span></span>
            <input type="checkbox" role="switch" checked={!r.paused} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${r.name}`} onChange={(e) => attempt(async () => { await api.routine(r.id, { state: e.target.checked ? 'on' : 'paused' }); refresh(); })} />
          </label>)}
          {all.length > 2 && go2('#/routines', `See all ${all.length}`, '')}
          <a className="row-item cp-link" href="#/routines"><span className="o-ic"><Icon name="plus" /></span><span className="grow"><b>Add a routine</b></span><Icon name="next" /></a>
        </div>
        <h2 className="st-label">Computer</h2>
        {pc ? <div className="card cp-computer">
          <ScreenPeek key={pc.id} bot={state.bots.find((b: Json) => b.id === pc.id)} who={pc.driving ? 'You have control' : pc.working ? `${pc.name} is using it` : `${pc.name}'s computer`} />
          <button className="btn go cp-take" onClick={() => attempt(async () => { if (!pc.driving) await api.takeOver(pc.id); refresh(); go(`#/h/${pc.id}/screen`); })}>{pc.driving ? 'Back to the controls' : 'Take control'}</button>
          <p className="mute small">Its own screen, away from yours. Taking control pauses {pc.name} until you hand it back.</p>
        </div> : <div className="card empty cp-none"><b>No computer yet</b><span className="mute small">{desk && !desk.ready && desk.missing?.length
          ? `This machine is missing what a computer needs: ${desk.missing.join(', ')}.` : 'None of your crew has a computer, so no one can work on a screen of their own.'}</span></div>}
        <h2 className="st-label">News</h2>
        <div className="card list"><label className="row-item"><span className="grow"><b>Tell me when Chief finishes or needs me</b><span className="mute">On every device with news on</span></span>
          <input type="checkbox" role="switch" checked={!!notify} disabled={notify === null} onChange={(e) => attempt(async () => setNotify((await api.notify(e.target.checked)).on))} /></label></div>
        <h2 className="st-label">Instructions</h2>
        <div className="card list">{go2('#/h/chief/instructions', 'How Chief works for you', 'Plain words. Only you change them.')}</div>
        <h2 className="st-label">Things</h2>
        <div className="card list">{THINGS.map(([k, l]) => <Fragment key={k}>{go2(`#/h/chief/${k}`, l, stuff[k].length ? String(stuff[k].length) : 'None yet')}</Fragment>)}</div>
        <div className="card list cp-trail">{go2(CHIEF_TRAIL, 'What happened', 'Every step Chief took, as it happened')}</div>
      </div>
    </section></div>
  </div>;
}

/** A helper's remembered lines, each with Forget. A new line comes from the helper's own work or through Chief: the person talks only to Chief. */
function MemoryList({ notes, save, empty }: { notes: string; save: (text: string) => Promise<unknown>; empty: string }) {
  // Forget leaves a "Forgotten" row where the line was, with an Undo that puts it back exactly, for a short while.
  const [undo, setUndo] = useState<{ prev: string; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = A.memories(notes);
  const forget = (i: number) => void attempt(async () => {
    const prev = notes; await save(A.withoutMemory(notes, i));
    if (timer.current) clearTimeout(timer.current);
    setUndo({ prev, at: i });
    timer.current = setTimeout(() => setUndo(null), 12_000);
  }, undefined);
  // The in-row Undo is the only way back: putting the line back is its own feedback, so no second control appears.
  const putBack = () => { const back = undo; if (timer.current) clearTimeout(timer.current); setUndo(null); if (back) void attempt(() => save(back.prev)); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const rows = list.map((m, i) => <div key={`m${i}`} className="row-item"><span className="grow">{m}</span>
    <button className="link" onClick={() => forget(i)}>Forget</button></div>);
  if (undo) rows.splice(Math.min(undo.at, rows.length), 0, <div key="undo" className="row-item forgotten"><span className="grow">Forgotten</span>
    <button className="link" onClick={putBack}>Undo</button></div>);
  return rows.length ? <div className="card list">{rows}</div> : <div className="card empty">{empty}</div>;
}

function Remembers({ id, name, page, reload }: { id: string; name: string; page: Json; reload: () => void }) {
  return (
    <>
      <label className="card toggle"><span className="grow"><b>Remember things</b><div className="mute small">{page.memory === false ? `${name} starts fresh every time.` : `${name} keeps notes on what you like.`}</div></span>
        <input type="checkbox" role="switch" checked={page.memory !== false} onChange={(e) => attempt(async () => { await api.settings(id, { memory: e.target.checked }); reload(); })} /></label>
      <MemoryList notes={page.notes ?? ''} save={async (t) => { await api.notes(id, t); reload(); }}
        empty={`Nothing yet. ${name} adds a line when it learns something you like.`} />
    </>
  );
}

/** What the engine learned from this helper's work on its own, each with Forget. */
function LearnedRows({ name }: { name: string }) {
  const [rows, setRows] = useState<{ id: string; skill: string }[] | undefined>(undefined);
  const [on, setOn] = useState(true);
  const load = () => api.learned().then((r) => setRows(r ?? [] as any)).catch(() => setRows([] as any));
  useEffect(() => { void load(); void api.learning().then((l) => setOn(l.on)).catch(() => {}); }, []);
  return <>
    <label className="card toggle"><span className="grow"><b>Learn from how I work</b><div className="mute small">{on ? `After a long job, ${name} reviews how it worked and keeps one skill.` : `${name} keeps no new skills from your jobs.`}</div></span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => attempt(async () => { await api.setLearning(e.target.checked); setOn(e.target.checked); }, e.target.checked ? 'Learning on' : 'Learning off')} /></label>
    {rows?.length ? <div className="card list">{rows.map((r: any) => (
      <div key={r.id} className="row-item"><span className="grow"><b>Learned: {A.plain(r.skill)}</b><div className="mute small">{name} will work this way next time.</div></span>
        <button className="btn ghost" onClick={() => attempt(async () => { await api.forgetLearned(r.id, r.skill); await load(); }, 'Forgotten')}>Forget</button></div>))}
    </div> : null}
  </>;
}

/** A helper's job as the profile shows it: what it does, what it aims for, and when it asks. It changes only through Chief. */
function JobSection({ page }: { page: Json }) {
  const [does, aim] = A.jobParts(page.job);
  return <dl className="st-job">{([['Does', does.text], ['Aims', aim.text], ['Asks', 'Before it pays or sends anything.']] as const).map(([k, v]) =>
    <Fragment key={k}><dt>{k}</dt><dd>{v || <span className="mute">Not set yet.</span>}</dd></Fragment>)}</dl>;
}

/** How Chief works (Stack J09d): who he is and what he never does, each one plain card, then Change it. His soul is the
 *  engine's own SOUL.md on his next reply: Change it opens it whole for the person to rewrite; Chief never does. */
function ChiefWorks({ tick, rules, head }: { tick: number; rules: string; head: ReactNode }) {
  const [page, setPage] = useState<Json>(null), [draft, setDraft] = useState<string | null>(null);
  const load = useCallback(() => api.bot('chief').then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const body = String(page?.soul ?? '').replace(/^# .*\n+/, ''), text = `# Chief\n\n${(draft ?? '').trim()}`, left = (page?.soulCap ?? 2000) - text.length;
  const change = <button className="btn cw-change" disabled={!page} onClick={() => setDraft(body)}>Change it</button>;
  return <div className="page helper chief-works">{head}
    <header className="chat-head st-profile-head desk-only"><Face who="chief" size={44} /><div className="grow"><h1>How Chief works</h1><span className="mute">Plain words Chief reads before every job. Only you change them.</span></div>{draft === null && change}</header>
    <section className="detail rest-screen chief-profile">
      <p className="lead phone-only">Plain words Chief reads before every job. Only you change them.</p>
      {draft === null ? <><div className="cw-cols">
        <div><h2 className="st-label">Who Chief is</h2><div className="card cw-card chief-soul">{page ? A.chiefIs(page.soul).map((l, i) => <p key={i}>{l}</p>) : <p className="mute">Opening…</p>}</div></div>
        <div><h2 className="st-label">What Chief never does</h2><div className="card cw-card"><p>{A.chiefNever(rules)}</p></div></div>
      </div><div className="phone-only">{change}</div></>
      : <div className="card form chief-soul"><b>How should Chief talk to you?</b>
        <p className="mute small">Plain words. Change what he calls you, his tone, anything. Your next message gets the new Chief.</p>
        <textarea className="input" rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Chief's personality" />
        <div className={`small ${left < 0 ? 'bad' : 'mute'}`}>{left < 0 ? 'A little shorter, please.' : left < 300 ? 'Nearly full.' : ''}</div>
        <div className="btns"><button className="btn go" disabled={!draft.trim() || left < 0} onClick={() => attempt(async () => { await api.soul('chief', text); setDraft(null); await load(); }, 'Saved')}>Save</button>
          <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          <button className="btn ghost" onClick={() => confirm('Put Chief back the way he started?') && attempt(async () => { await api.soulReset('chief'); setDraft(null); await load(); }, 'Chief is back to how he started')}>Put back how Chief started</button></div></div>}
    </section></div>;
}

/** Who a helper is, in plain words, and what it knows how to do. The person changes it; the helper never does. */
function AboutMe({ id, name, page, reload }: { id: string; name: string; page: Json; reload: () => void }) {
  const [draft, setDraft] = useState<string | null>(null), [skillLink, setSkillLink] = useState('');
  const [skillPreview, setSkillPreview] = useState<{ name: string; description: string; token: string } | null>(null);
  const traits = A.aboutTraits(name, page.soul);
  const knows = A.knows(page.skills);
  const left = (page.soulCap ?? 2000) - A.soulText(name, draft ?? '').length;
  return (
    <>
      <p className="lead">How {name} comes across. {name} reads this before every job.</p>
      {draft === null ? (
        <div className="card">
          {traits.length ? traits.map((t, i) => <p key={i}>{t}</p>) : <p className="mute">{name} hasn't a personality of its own yet.</p>}
          <div className="btns">
            <button className="btn" onClick={() => setDraft(A.aboutDraft(name, page.soul))}>Change</button>
            <button className="btn ghost" onClick={() => confirm(`Put ${name} back the way it started?`) && attempt(async () => { await api.soulReset(id); reload(); }, `${name} is back to its old self`)}>Put back how {name} started</button>
          </div>
        </div>
      ) : (
        <div className="card form">
          <b>In your words, how should {name} come across?</b>
          <p className="mute small">One line each — plain words about {name}. Crewhouse turns them into {name}'s own instructions.</p>
          <textarea className="input" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`How ${name} comes across`} />
          <div className={`small ${left < 0 ? 'bad' : 'mute'}`}>{left < 0 ? 'A little shorter, please.' : left < 300 ? 'Nearly full.' : ''}</div>
          <div className="btns">
            <button className="btn go" disabled={!draft.trim() || left < 0} onClick={() => attempt(async () => { await api.soul(id, A.soulText(name, draft)); setDraft(null); reload(); }, 'Saved')}>Save</button>
            <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="label">{name} knows how to</div>
      {knows.length ? <div className="card list">{knows.map((k) => <div key={k.name} className="row-item"><span className="grow">{k.says}{(k.learned || k.added) && <div className="mute small">{k.learned ? 'Learned from you' : 'Added by you'}</div>}</span>
        {(k.learned || k.added) && <button className="link" onClick={() => confirm(`Should ${name} stop using this skill?`) && attempt(async () => { await api.removeSkill(id, k.name); reload(); }, 'Put away')}>Remove</button>}</div>)}</div>
        : <div className="card empty">Plain jobs, the way you ask for them.</div>}
      <div className="card form">
        <b>Add a skill from GitHub</b>
        <p className="mute small">Paste a GitHub address to a SKILL.md or its folder. Crewhouse reads that file and files it points to in the same folder; it never runs scripts when adding a skill.</p>
        <label className="small" htmlFor={`skill-link-${id}`}>GitHub address</label>
        <input id={`skill-link-${id}`} className="input" type="url" value={skillLink} placeholder="https://github.com/owner/repo/tree/main/skills/name" onChange={(e) => { setSkillLink(e.target.value); setSkillPreview(null); }} />
        {!skillPreview ? <button className="btn" disabled={!skillLink.trim()} onClick={() => void attempt(async () => setSkillPreview(await api.previewSkill(id, skillLink.trim())))}>Check skill</button>
          : <div className="card">
            <b>{skillPreview.name}</b><p>{skillPreview.description}</p>
            <p className="mute small">Add these instructions to {name}? They will guide future jobs. No scripts are run.</p>
            <div className="btns"><button className="btn go" onClick={() => void attempt(async () => { await api.addSkill(id, skillLink.trim(), skillPreview.token); setSkillLink(''); setSkillPreview(null); reload(); }, `Added to ${name}`)}>Yes, add skill</button>
              <button className="btn ghost" onClick={() => setSkillPreview(null)}>No, cancel</button></div>
          </div>}
      </div>
    </>
  );
}

/** Memory: one place for what the crew knows about this person — what Chief noted about them and their work, and the
 *  lines the whole crew keeps. Every helper reads it before a job for them; every line can be forgotten, and each
 *  Forget leaves a "Forgotten" row with an Undo that puts the exact line back. */
function Memory({ tick }: { tick: number }) {
  const [notes, setNotes] = useState<string | null>(null);
  const [got, setGot] = useState<{ text: string; cap: number } | null>(null);
  const [cases, setCases] = useState<{ thread: string; facts: string }[]>([]);
  const load = useCallback(async () => {
    const [a, p] = await Promise.all([api.about().catch(() => ({ notes: '', cases: [] })), api.profile().catch(() => ({ text: '', cap: 4000 }))]);
    setNotes(a.notes ?? ''); setCases(a.cases ?? []); setGot({ text: p.text ?? '', cap: p.cap ?? 4000 });
  }, []);
  useEffect(() => { void load(); }, [load, tick]);
  const [adding, setAdding] = useState('');
  // Every row's Forget leaves a "Forgotten" row where it was, with an Undo that puts it back exactly for a short while.
  const [undone, setUndone] = useState<{ kind: 'part' | 'crew'; prev: string; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (notes === null || got === null) return null;
  const mine = A.memories(notes), parts = A.profileParts(got.text);
  const forget = (kind: 'part' | 'crew', i: number) => void attempt(async () => {
    const prev = kind === 'crew' ? notes : got.text;
    await (kind === 'crew' ? api.setAbout(A.withoutMemory(notes, i)) : api.setProfile(A.profileText(parts.filter((_, j) => j !== i))));
    await load();
    if (timer.current) clearTimeout(timer.current);
    setUndone({ kind, prev, at: i });
    timer.current = setTimeout(() => setUndone(null), 12_000);
  });
  const putBack = () => { const back = undone; if (timer.current) clearTimeout(timer.current); setUndone(null); if (back) void attempt(async () => { await (back.kind === 'crew' ? api.setAbout(back.prev) : api.setProfile(back.prev)); await load(); }); };
  const add = () => void attempt(async () => { await api.setProfile(A.profileText([...parts, adding])); await load(); setAdding(''); }, 'Remembered');
  const left = got.cap - A.profileText([...parts, adding]).length;
  const over = left < 0;
  const hint = over ? 'A little shorter, please.' : left < 300 ? 'Nearly full.' : '';
  const forgotten = <div key="undo" className="row-item forgotten"><span className="grow">Forgotten</span><button className="link" onClick={putBack}>Undo</button></div>;
  const partRows = parts.map((p, i) => <div key={`work-${i}`} className="row-item profile-part"><span className="grow">{p}</span>
    <button className="link" onClick={() => forget('part', i)}>Forget</button></div>);
  if (undone?.kind === 'part') partRows.splice(Math.min(undone.at, partRows.length), 0, forgotten);
  const crewRows = mine.map((m, i) => <div key={`you-${i}`} className="row-item memory-you"><span className="grow">{m}</span>
    <button className="link" onClick={() => forget('crew', i)}>Forget</button></div>);
  if (undone?.kind === 'crew') crewRows.splice(Math.min(undone.at, crewRows.length), 0, forgotten);
  const forgetCase = (thread: string) => void attempt(async () => { await api.forgetCase(thread); await load(); });
  const caseRows = A.caseLines(cases).map((c) => <div key={`case-${c.thread}`} className="row-item memory-case"><span className="grow">{c.text}</span>
    <button className="link" onClick={() => forgetCase(c.thread)}>Forget</button></div>);
  return (
    <>
      <div className="label" id="memory">Memory</div>
      <p className="mute small">What the crew knows about you and your work. Every helper reads it before a job for you.</p>
      {(parts.length || mine.length || cases.length) ? <div className="card list memory-lines">{partRows}{crewRows}{caseRows}</div>
        : <div className="card empty">Nothing yet. Tell Chief about yourself and your work, and the whole crew will know.</div>}
      <div className="row add-row"><input className="input grow profile-add" value={adding} onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && adding.trim() && !over) add(); }}
        placeholder="Something about you or your work" aria-label="Something about you or your work" />
        <button className="btn" disabled={!adding.trim() || over} onClick={add}>Add</button></div>
      {!!(adding.trim() && hint) && <div className={`small ${over ? 'bad' : 'mute'}`}>{hint}</div>}
    </>
  );
}

// ---------- things ----------
const KEPT_DONE = 'crewhouse.done.kept';
// ponytail: settled Done cards live in this browser only, so the phone or another browser shows the card again;
// move the list to crewd when that matters.
const keptDone = (): string[] => { try { return JSON.parse(localStorage.getItem(KEPT_DONE) ?? '[]'); } catch { return []; } };
/** Who made a finished thing: Chief, a helper on the crew, or nobody left on it. */
const makerOf = (state: Json, id: string) => id === 'chief' ? 'chief' as const : A.crew(state).find((x) => x.id === id);

const makerName = (state: Json, id: string) => { const w = makerOf(state, id); return w === 'chief' ? 'Chief' : w?.name ?? 'The crew'; };

/** Your things (Stack J07a): every file the crew made, newest first, as the maker's colour cards under Today,
 *  Yesterday and Earlier. On a computer a search box heads it and the newest sheet or page is open beside the cards. */
function Things({ state, id }: Ctx & { id?: string }) {
  const [q, setQ] = useState('');
  const word = q.trim().toLowerCase();
  const all = A.things(state).sort((a, b) => b.at - a.at);
  const list = all.filter((t) => !word || [t.title, makerName(state, t.helper), ...t.files.map((f) => f.name)].some((x) => x.toLowerCase().includes(word)));
  // A search hit for a finished thing lands on the result itself.
  const want = id ? Number(id.slice(1)) : 0;
  useEffect(() => {
    if (!want) return;
    const el = document.getElementById(`t${want}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('land');
    const t = setTimeout(() => el.classList.remove('land'), 1300);
    return () => clearTimeout(t);
  }, [want, list.length]);
  const day = new Date().setHours(0, 0, 0, 0);
  const groups: [string, (at: number) => boolean][] = [['Today', (at) => at >= day], ['Yesterday', (at) => at >= day - 86400000 && at < day], ['Earlier', (at) => at < day - 86400000]];
  const peek = all.flatMap((t) => t.files.filter((f) => f.kind === 'sheet' || f.kind === 'page').map((f) => ({ t, f, src: A.fileSource(f.url)! })))[0];
  const card = (t: A.Thing) => {
    const who = makerOf(state, t.helper), meta = `${makerName(state, t.helper)} · ${A.clock(t.at)}`;
    if (!t.files.length) return <a key={t.id} id={`t${t.id}`} className={`wb-card wb-made${who === 'chief' ? ' wb-chief' : ''}`} style={tint(who)} href={hrefOf(t.helper)}>
      {who && <Face who={who} />}<span className="grow wb-what"><b>{t.title}</b><span className="mute small">{meta}</span></span>
      {t.summary && <span className="wb-thumb leaf"><span className="ln">{t.summary}</span></span>}<span className="wb-open">Open</span></a>;
    return t.files.map((f, i) => <div key={f.url} id={i ? undefined : `t${t.id}`}>{f.kind === 'sheet' || f.kind === 'page' ? <PreviewCard f={f} who={who} meta={meta} />
      : <Media f={f} />}</div>);
  };
  return <div className="page stack st-things">
    <header className="st-head"><a href="#/" className="st-back" aria-label="Home" onClick={(e) => { e.preventDefault(); back(); }}><Icon name="back" size={20} /></a>
      <span className="grow"><h1 className="wide">Your things</h1><span className="st-line">Everything the crew has made for you.</span></span>
      {all.length > 0 && <label className="st-search"><Icon name="search" size={20} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your things" aria-label="Search your things" /></label>}</header>
    <div className="st-body"><div className="st-pri">
      {groups.map(([group, on]) => {
        const items = list.filter((t) => on(t.at));
        return items.length ? <section key={group}><div className="st-label"><span>{group}</span></div><div className="st-made">{items.flatMap(card)}</div></section> : null;
      })}
      {!all.length && <div className="st-empty"><b className="wide">Nothing yet</b><span>Videos, lists, letters and plans the crew makes for you land here.</span></div>}
      {all.length > 0 && !list.length && <div className="st-empty"><span>Nothing matches “{q.trim()}”.</span></div>}
    </div>{peek && <aside className="st-asks st-peek"><div className="st-label"><span>{peek.f.name}</span></div>
      <PreviewPanel key={peek.f.url} inline who={makerOf(state, peek.t.helper)} bot={peek.src.bot} path={peek.src.path} title={peek.f.name} made={A.clock(peek.t.at)} onClose={() => {}} /></aside>}</div>
  </div>;
}

// ---------- routines ----------
function RoutineList({ state, refresh, bot }: Ctx & { bot?: string }) {
  const crew = A.crew(state);
  const list = A.routines(state, bot);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <>
      {list.map((r: Json) => <RoutineRow key={r.id} r={r} h={crew.find((x) => x.id === r.helper)} act={act} refresh={refresh} />)}
      {!list.length && <div className="card empty">Nothing set up yet.</div>}
    </>
  );
}

/** Where a run ended up: the thing it made, else its line in the chat. */
const runHref = (r: Json, res: Json) => res.thing ? `#/things/t${res.thing}` : r.helper === 'chief' ? `#/chief/m${res.msg}` : `#/h/${r.helper}/m${res.msg}`;

/** One routine (Stack J08): a card in its helper's colour with the time as the big line, its switch, Do it now and
 *  Change time (its own page). Do it now reads "Running…" until the run's result lands on the row; the last run's words
 *  and the recent runs stay on the card. */
function RoutineRow({ r, h, act, refresh }: { r: Json; h: Helper | undefined; act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>; refresh: () => void }) {
  // After a press the button reads "Running…" until a run newer than the last one at the press is on the row.
  const [asked, setAsked] = useState<number | null>(null), pressed = useRef(false);
  const last = r.runs[0], running = (asked !== null && (last?.t ?? 0) <= asked) || last?.tone === 'running';
  // crewd's own words say why a run could not start ("The last run of … is still going."); anything else is the usual toast.
  const run = async () => {
    setAsked(last?.t ?? 0); pressed.current = true;
    try { await api.runRoutine(r.id); } catch (e: any) { setAsked(null); if (e?.status === 409) toast(e.message); else await attempt(() => Promise.reject(e)); }
    refresh();
  };
  const who = h?.kind ?? 'chief';
  const sub = [r.cadence, r.remind ? '' : r.name, r.watching ? `Keeps an eye on ${r.watching}` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`card routine ${r.paused ? 'paused' : ''}`} style={{ background: art.colourOf(who), color: art.inkOn(who) }}>
      <div className="row">
        <Face who={h ?? 'chief'} size={44} />
        <b className="grow semi clamp1">{h?.name ?? 'Chief'}</b>
        <label className="routine-switch"><input type="checkbox" role="switch" checked={!r.paused} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${r.name}`} onChange={(e) => act(() => api.routine(r.id, { state: e.target.checked ? 'on' : 'paused' }))} /></label>
      </div>
      <div className="routine-big wide">{r.big}</div>
      <p className="routine-sub">{r.paused ? 'Paused · ' : ''}{sub}{sub ? '.' : ''}{r.quiet && !r.watching && !r.digest ? ' Tells you only if something is up.' : ''}
        <span className="routine-last-wrap" aria-live="polite">{last && <span key={last.at + last.words} className={`routine-last${pressed.current ? ' landed' : ''}`}> Last run {last.at} · {last.words}{last.result && <> · <a className="link" href={runHref(r, last.result)}>See result</a></>}</span>}</span></p>
      <div className="routine-run">
        <button className="btn go" onClick={run} disabled={!!r.reminded || running}>{r.reminded ? 'Already reminded' : running ? 'Running…' : 'Do it now'}</button>
        <a className="btn" href={`#/routines/${r.id}`}>Change time</a>
      </div>
      {(r.runs.length > 1 || !r.digest) && <details className="routine-runs">
        <summary>More</summary>
        {r.runs.length > 1 && <ol>{r.runs.map((x: Json, i: number) => <li key={i}><span>{x.at}</span> {x.words}{x.result && <> · <a className="link" href={runHref(r, x.result)}>See result</a></>}</li>)}</ol>}
        <div className="btns">
          {!r.digest && !r.watching && !r.remind && <button className={`chip ${r.quiet ? 'on' : ''}`} aria-pressed={r.quiet} onClick={() => act(() => api.routine(r.id, { quiet: !r.quiet }), r.quiet ? 'It will always report back' : "It will only speak up when something's up")}>Only tell me if something's up</button>}
          {!r.digest && <button className="btn" onClick={() => confirm(`Remove “${r.name}”?`) && act(() => api.removeRoutine(r.id))}>Remove</button>}
        </div>
      </details>}
    </div>
  );
}

/** Recurring work starts as a request: say it in your own words, Chief brings back a card to start — no setup form. */
function RoutineAsk() {
  const [text, setText] = useState('');
  const send = async (t = text.trim()) => { if (!t) return; if (await attempt(() => api.post('chief', t), undefined, true)) { setText(''); go('#/chief'); } };
  return (
    <div className="card ask routine-ask">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Every Friday, check…" aria-label="Tell Chief what should happen regularly" />
        <button className="send" aria-label="Send" disabled={!text.trim()}>↑</button>
      </form>
    </div>
  );
}

/** Routines (Stack J08): a card per routine; on a computer "Talk to Chief" beside them, on a phone below. */
function Routines(ctx: Ctx & { id?: string }) {
  const { state, refresh } = ctx, crew = A.crew(state);
  const r = ctx.id ? A.routines(state).find((x: Json) => String(x.id) === ctx.id) : undefined;
  if (r) return <RoutineTime r={r} h={crew.find((x) => x.id === r.helper)} refresh={refresh} />;
  const ideas = ['Every Friday, check for refunds', 'Each morning, what is on today'];
  const say = async (t: string) => { if (await attempt(() => api.post('chief', t), undefined, true)) go('#/chief'); };
  return <div className="page stack stack-home routines-page">
    <header className="st-head"><a href="#/" className="back phone-only" aria-label="Home">‹</a>
      <span className="grow"><h1 className="wide">Routines</h1><p className="st-line">What the crew does on a schedule. Only the ones you said yes to run.</p></span></header>
    <div className="st-body"><div className="st-pri routine-cards"><RoutineList {...ctx} /></div>
      <aside className="st-asks routine-talk" aria-label="Talk to Chief">
        <div className="st-label"><span>Talk to Chief</span></div>
        <p className="routine-hint">Want something on a schedule? Say it in your words; the helper for it asks you first.</p>
        <RoutineAsk />
        {ideas.map((t) => <button key={t} className="st-idea" onClick={() => say(t)}><span className="grow">{t}</span><Icon name="plus" size={20} /></button>)}
      </aside></div>
  </div>;
}

/** Change a routine's time (J08b): the new time in plain words, what it says back, and the next four times it would run. */
function RoutineTime({ r, h, refresh }: { r: Json; h: Helper | undefined; refresh: () => void }) {
  const [when, setWhen] = useState(r.remind ? 'in 20 minutes' : r.when || ''), [preview, setPreview] = useState<Json>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!when.trim()) { setPreview(null); return; }
    const t = setTimeout(() => api.schedule(when).then(setPreview).catch(() => setPreview({ bad: true })), 250);
    return () => clearTimeout(t);
  }, [when]);
  const ok = !!when.trim() && !!preview && !preview.bad;
  const save = async () => { setBusy(true); const done = await attempt(async () => { await api.routine(r.id, { schedule: when.trim() }); refresh(); }, 'Time changed'); setBusy(false); if (done) go('#/routines'); };
  const who = h?.kind ?? 'chief';
  // ponytail: the next four are stepped on this device's clock from crewd's first; away from home's zone they can sit an hour off.
  const nexts = useMemo(() => { if (!ok || r.remind || typeof preview.next !== 'number') return [] as number[]; try { const s = parseSchedule(when), out = [preview.next]; while (out.length < 4) out.push(nextRun(s, out[out.length - 1])); return out; } catch { return []; } }, [ok, preview, when]);
  return <div className="page stack stack-home routines-page routine-time">
    <header className="st-head"><a href="#/routines" className="back" aria-label="Back to Routines">‹</a><Face who={h ?? 'chief'} size={44} />
      <span className="grow"><h1 className="wide">{r.name}</h1><p className="st-line">{h?.name ?? 'Chief'} · a routine</p></span></header>
    <div className="st-body"><form className="st-pri" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void save(); }}>
      <div className="routine-banner" style={{ background: art.colourOf(who), color: art.inkOn(who) }}><div className="routine-big wide">{r.big}</div><p className="routine-sub">{[r.cadence, r.name].filter(Boolean).join(' · ')}.</p></div>
      <label className="st-label routine-when" htmlFor="routine-when"><span>When?</span></label>
      <input id="routine-when" className="input" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="For example: every Saturday 10am" autoFocus />
      <p className="routine-say">{ok ? <><Icon name="check" size={20} />{preview.words}.{preview.guessed ? ` Did you mean ${preview.words.split(' at ').pop()}?` : ''} First time {preview.first}.</> : preview?.bad ? <><Icon name="alert" size={20} />I didn't catch that time. Try “every Monday 9:00”.</> : null}</p>
      <div className="routine-run"><button className="btn go" disabled={!ok || busy}>Save</button><a className="btn" href="#/routines">Keep the time</a></div>
    </form>
      <aside className="st-asks routine-next" aria-label="The next four times">
        {nexts.length > 0 && <><div className="st-label"><span>The next four times</span></div>
          <ol className="routine-times">{nexts.map((t) => <li key={t}><span className="routine-clock"><Icon name="clock" size={22} /></span><b>{new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>{A.clock(t).replace(/^.*, /, '').replace(/^\w{3} (?=\d)/, '')}</span></li>)}</ol></>}
        {!r.watching && !r.digest && r.quiet && <p className="routine-hint"><Icon name="lock" size={20} />On a quiet week {h?.name ?? 'Chief'} says nothing, and it costs you nothing.</p>}
      </aside></div>
  </div>;
}

// ---------- settings ----------
/** Turn this device's news on and say what came of it, in the same words for Settings and the paired offer. */
async function turnOnHere() {
  const r = await turnOnNotifications(true);
  if (r === 'on') toast('This device shows Crewhouse news.');
  else if (r === 'off') toast('Notifications were not allowed.');
  else if (r === 'offline') toast("Your mailbox isn't connected right now. Try again in a moment.");
}

/** The paired installed app's notifications, offered once: a browser shows its permission prompt only from a tap, so
 *  nothing is asked here by itself. Shown only where the mailbox can carry news and the browser has not answered yet;
 *  either button puts it away on this device for good. Settings keeps its own row. */
const NEWS_OFFER = 'crewhouse.newsOffer';
function NewsOffer({ tick }: { tick: number }) {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(() => { try { return !!localStorage.getItem(NEWS_OFFER); } catch { return false; } });
  useEffect(() => { if (paired && pushPossible() && Notification.permission === 'default') void api.pushKey().then((k) => setReady(k.ready)).catch(() => {}); }, [tick]);
  if (!paired || gone || !ready || !pushPossible() || Notification.permission !== 'default') return null;
  const put = () => { try { localStorage.setItem(NEWS_OFFER, '1'); } catch { /* this visit only */ } setGone(true); };
  return <div className="card nudge">
    <span className="grow"><b>Get news when the app is closed?</b><div className="mute small">Only a line when Chief finishes or needs you, never what you chat about.</div>
      <div className="btns"><button className="btn go" onClick={() => { put(); void attempt(turnOnHere); }}>Turn on</button><button className="btn ghost" onClick={put}>Not now</button></div></span>
  </div>;
}

/** The paired app's own notifications, on the paired card. One line: the state and the one action that changes it.
 *  `relay`: whether a mailbox can carry them — null while the key is still being asked over the link; false says
 *  `norelay` in plain words, no dead button; 'offline' and 'unreachable' say why under the switch. */
function NotifyLine({ relay, norelay }: { relay: boolean | 'offline' | 'unreachable' | null; norelay: string }) {
  const [state, setState] = useState<'unsupported' | 'denied' | 'on' | 'off' | null>(null);
  const look = () => pushState().then(setState).catch(() => setState('off'));
  useEffect(() => { void look(); }, []);
  if (state === null || state === 'unsupported') return null;
  if (state === 'denied') return <p className="mute small">Notifications are blocked in this browser. Allow them for this app in the browser’s own settings, then try again.</p>;
  if (relay === false) return <p className="mute small">Notifications on this device: {norelay}</p>;
  const on = state === 'on';
  return <>
    <p className="mute small">Notifications: {on ? 'On' : 'Off'} · <button className={`link inline notify-${on ? 'off' : 'on'}`} onClick={() => attempt(async () => {
      if (on) { await turnOffNotifications(); toast('Notifications are off on this device.'); }
      else await turnOnHere();
    }).then(() => look())}>{on ? 'Turn off' : 'Turn on'}</button></p>
    {relay === 'offline' && <p className="mute small">Your computer can't send notifications right now. They come back when it reconnects.</p>}
    {relay === 'unreachable' && <p className="mute small">Couldn't reach your computer. Try again when it's on.</p>}
  </>;
}

/** The one-use code that pairs a phone, with its QR: Settings shows it under Phones, and Chief's chat shows
 *  the same card right after sign-in while no phone is paired yet (cut 10). */
function PairCodeCard({ offer, left, typed, link, title, sub, onAway, onNew, onClose, closeLabel }: {
  offer: Json; left: number; typed: Json; link: Json; title: string; sub: ReactNode;
  onAway: () => void; onNew: () => void; onClose: () => void; closeLabel: string;
}) {
  return (
    <div className="card pair" aria-label={title}>
      {left > 0 ? <div className="qr"><PairQR text={offer.qr} /></div> : <div className="qr expired">This code ran out.</div>}
      <div className="grow">
        <b>{title}</b>
        {sub}
        <p className="mute small">Then check the two words the phone shows against the ones that appear here.</p>
        <p className="mute small">{left > 0 ? `Works once, for ${left} more seconds.` : 'Make a new one when the phone is ready.'}</p>
        {left > 0 && <p className="small">Can’t scan? {link.web ? <>Open <b style={{ overflowWrap: 'anywhere' }}>{new URL(link.web).host}</b> on the phone and type this code: </> : "With the phone on this computer's Wi‑Fi, type this code in the phone app: "}<b className="pair-typed">{offer.typed}</b></p>}
        {left > 0 && A.reach(link).online && (typed ? <p className="small">If the phone is away from home, type this one instead: <b style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{A.phoneTyped(typed)}</b></p>
          : <button className="link inline small" onClick={onAway}>Show a code for a phone away from home</button>)}
        <div className="btns">{left <= 0 && <button className="btn go" onClick={onNew}>New code</button>}<button className="btn ghost" onClick={onClose}>{closeLabel}</button></div>
      </div>
    </div>
  );
}

/** Cut 10: right after sign-in, while no phone is paired yet, Chief's chat offers "Add your phone" with the code in
 *  place — the same card as Settings › Phones › Add a phone — instead of sending the person hunting through Settings.
 *  "Not now" puts it away on this browser; a paired phone ends it for good. Settings keeps working as it is. */
const ADD_PHONE_SKIP = 'crewhouse.addPhone.skip';
const ADD_PHONE_DONE = 'crewhouse.addPhone.done';
function AddPhonePrompt({ accounts, tick }: { accounts: Json[] | null; tick: number }) {
  const [phones, setPhones] = useState<Json[] | null | undefined>(undefined);
  const [link, setLink] = useState<Json>(null);
  const [offer, setOffer] = useState<Json>(null);
  const [typed, setTyped] = useState<Json>(null);
  const [now, setNow] = useState(Date.now());
  const [gone, setGone] = useState(() => { try { return !!localStorage.getItem(ADD_PHONE_SKIP) || !!localStorage.getItem(ADD_PHONE_DONE); } catch { return false; } });
  const load = () => Promise.all([api.phones(), api.phoneLink()]).then(([p, l]) => { setPhones(p); setLink(l); }).catch(() => setPhones(null));
  useEffect(() => { if (!paired) void load(); }, [tick]);
  // A paired phone ends the offer for good, on every later visit too.
  useEffect(() => {
    if (phones && phones.length && !gone) {
      try { localStorage.setItem(ADD_PHONE_DONE, '1'); } catch { /* this visit only */ }
      setGone(true);
      toast(`${phones[0].name} is paired`);
    }
  }, [phones]);
  const mine = accounts ? A.aiList(accounts).mine[0] : null;
  const signedIn = !!mine && mine.g.state === 'ready' && !mine.g.notIncluded;
  const open = !paired && !gone && signedIn && Array.isArray(phones) && phones.length === 0 && !!link && (!!link.on || !!link.relay);
  const mint = () => attempt(async () => { setTyped(null); setOffer({ ...(await api.pairPhone('control')), role: 'control' }); });
  useEffect(() => { if (open && !offer) void mint(); }, [open]);
  useEffect(() => { if (!offer) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [offer]);
  if (!open) return null;
  const asking: Json[] = link.asking ?? [];
  const left = offer ? Math.max(0, Math.round((offer.expires - now) / 1000)) : 0;
  const skip = () => { try { localStorage.setItem(ADD_PHONE_SKIP, '1'); } catch { /* this visit only */ } setOffer(null); setGone(true); };
  return (<>
    {asking.map((a: Json) => (
      <div key={a.id} className="card ask">
        <b>{a.name} would like to join</b>
        <p>Only say yes if the phone shows these two words: <b>{a.words}</b></p>
        <p className="mute small">{a.role === 'view' ? 'This phone will watch the crew but not answer or give jobs.' : 'This phone will answer the crew and give them jobs, as you.'}</p>
        <div className="btns">
          <button className="btn go" onClick={() => attempt(async () => { await api.answerPhone(a.id, true); await load(); })}>Yes, the words match</button>
          <button className="btn" onClick={() => attempt(async () => { await api.answerPhone(a.id, false); await load(); }, `${a.name} was turned away`)}>No</button>
        </div>
      </div>
    ))}
    {!asking.length && (offer ? <PairCodeCard offer={offer} left={left} typed={typed} link={link} title="Add your phone"
      sub={<><p className="small">{link.web ? "Scan this with the phone's camera." : 'Scan this in the phone app or type the code.'}</p><p className="mute small">This phone will answer the crew and give them jobs, as you.</p></>}
      onAway={() => attempt(async () => setTyped(await api.phoneCode('control')))} onNew={mint} onClose={skip} closeLabel="Not now" />
      : <div className="card pair" aria-label="Add your phone">
        <div className="grow"><b>Add your phone</b>
          <p className="small">{link.web ? "Scan this with the phone's camera." : 'Scan this in the phone app or type the code.'}</p>
          <div className="btns"><button className="btn go" onClick={mint}>Show the code</button><button className="btn ghost" onClick={skip}>Not now</button></div>
        </div>
      </div>)}
  </>);
}

/** Settings, Phones: pair the phone app by its camera, see each phone, take one away. Only this computer can. */
function Phones({ tick }: { tick: number }) {
  const [phones, setPhones] = useState<Json[] | null | undefined>(undefined);
  const [link, setLink] = useState<Json>(null);
  const [offer, setOffer] = useState<Json>(null);
  const [typed, setTyped] = useState<Json>(null);
  const [relay, setRelay] = useState<string | null>(null);
  const [enrol, setEnrol] = useState('');
  const [web, setWeb] = useState('');
  const [now, setNow] = useState(Date.now());
  const load = () => Promise.all([api.phones(), api.phoneLink()]).then(([p, l]) => { setPhones(p); setLink(l); }).catch(() => setPhones(null));
  useEffect(() => { void load(); }, [tick]);
  useEffect(() => { if (!offer) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [offer]);
  // The code closes by itself once a phone uses it.
  const joined = offer && phones?.find((p) => !offer.had.includes(p.id));
  useEffect(() => { if (joined) { setOffer(null); toast(`${joined.name} is paired`); } }, [joined?.id]);
  const show = (role: 'control' | 'view') => attempt(async () => { setTyped(null); setOffer({ ...(await api.pairPhone(role)), role, had: (phones ?? []).map((p) => p.id) }); });
  const left = offer ? Math.max(0, Math.round((offer.expires - now) / 1000)) : 0;

  return (<>
    {phones === undefined ? <div className="card mute">Checking…</div> : phones === null || (!link?.on && !link?.relay) ? (
      <div className="card"><b>Crewhouse on your phone</b><p className="mute">The phone app is on its way. When it arrives, you'll scan a code here and the crew is in your pocket.</p></div>
    ) : (<>
      <div className="card list">
        {phones.map((p) => (
          <div key={p.id} className="row-item"><span className="phone-ic">▯</span>
            <span className="grow"><b>{p.name}</b><div className="mute small">{p.role === 'view' ? 'Can watch, not answer' : 'Can answer and give jobs'} · {p.online ? 'with you now' : `last seen ${A.clock(p.seen)}`}</div>
              <div className="mute small">{A.reached(p)}{p.push === 'off' ? ' · notifications off on this phone' : ''}</div></span>
            <button className="btn ghost" onClick={() => attempt(async () => { await api.removePhone(p.id); await load(); }, `${p.name} can't reach the crew any more`)}>Remove</button>
          </div>
        ))}
        {!!A.pushWords(link) && <p className="mute small">{A.pushWords(link)}</p>}
        {pushPossible() && <p className="mute small">Notifications on this device: <button className="link inline" onClick={() => attempt(async () => { const r = await turnOnNotifications(!!link.relay); toast(r === 'on' ? 'This device shows Crewhouse news.' : r === 'norelay' ? 'Turn on your mailbox below first, then try again.' : r === 'offline' ? "Your mailbox isn't connected right now. Try again in a moment." : 'Notifications were not allowed.'); })}>turn on</button> · <button className="link inline" onClick={() => attempt(async () => { await turnOffNotifications(); toast('Notifications are off on this device.'); })}>turn off</button></p>}
        {!phones.length && <p className="mute">{link?.web ? 'No phones yet. Tap Add a phone, then scan the code it shows with the phone’s camera.' : 'No phones yet. Install the Crewhouse app, then scan the code it asks for.'}</p>}
        {!offer && <div className="btns"><button className="btn go" onClick={() => show('control')}>Add a phone</button><button className="btn" onClick={() => show('view')}>Add one that only watches</button></div>}
      </div>
      {!phones.length && !offer && <AppDownloadQR android={!!link?.web} />}
      {link.asking.map((a: Json) => (
        <div key={a.id} className="card ask">
          <b>{a.name} would like to join</b>
          <p>Only say yes if the phone shows these two words: <b>{a.words}</b></p>
          <p className="mute small">{a.role === 'view' ? 'This phone will watch the crew but not answer or give jobs.' : 'This phone will answer the crew and give them jobs, as you.'}</p>
          <div className="btns">
            <button className="btn go" onClick={() => attempt(async () => { await api.answerPhone(a.id, true); await load(); })}>Yes, the words match</button>
            <button className="btn" onClick={() => attempt(async () => { await api.answerPhone(a.id, false); await load(); }, `${a.name} was turned away`)}>No</button>
          </div>
        </div>
      ))}
      {offer && !link.asking.length && (<>
        {!phones.length && <AppDownloadQR />}
        <PairCodeCard offer={offer} left={left} typed={typed} link={link} title={link.web ? "Scan this with the phone's camera" : "Scan this with the Crewhouse app"}
          sub={<p className="mute small">{offer.role === 'view' ? 'This phone will watch the crew but not answer or give jobs.' : 'This phone will answer the crew and give them jobs, as you.'}</p>}
          onAway={() => attempt(async () => setTyped(await api.phoneCode(offer.role)))} onNew={() => show(offer.role)} onClose={() => setOffer(null)} closeLabel="Close" />
      </>)}
      <label className="card row">
        <span className="grow"><b>Phones on this Wi-Fi can reach the crew</b>
          <div className="mute small">Off: the Wi-Fi opens only while a pairing code is showing here, so a phone can join at home. After that it reaches this computer through <a href="https://tailscale.com" target="_blank" rel="noreferrer">the connector app</a>, away from home. Either way everything between them is locked.</div></span>
        <input type="checkbox" role="switch" checked={link.lan} disabled={link.pinned} onChange={(e) => attempt(async () => setLink(await api.phonesAtHome(e.target.checked)))} />
      </label>
      <div className="card web-app">
        <b>Crewhouse in a phone's browser</b>
        {link.web ? <>
          <p className="mute small">On. A phone opens Crewhouse at <b style={{ overflowWrap: 'anywhere' }}>{new URL(link.web).host}</b>: tap Add a phone, scan the code it shows with the phone’s camera, and it opens right there. Everything between them is locked.</p>
          <div className="btns"><button className="btn ghost" onClick={() => attempt(async () => setLink(await api.phoneWeb({})), 'Turned off')}>Turn off</button></div>
        </> : <>
          <p className="mute small">An iPhone, an iPad or any phone without the Crewhouse app opens Crewhouse in its browser, from a secure web address for this computer. Turn it on, then tap Add a phone.</p>
          <div className="btns"><button className="btn go" onClick={() => attempt(async () => setLink(await api.phoneWeb({ on: true })), 'Turned on')}>Turn on with the connector app</button></div>
          <p className="mute small"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get the connector app ↗</a> is free. Install it on this computer and on the phone, signed in to the same account.</p>
          <details><summary className="small">I run my own server</summary>
            <form className="form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { setLink(await api.phoneWeb({ address: web.trim() })); setWeb(''); }, 'Saved'); }}>
              <p className="mute small">Point a secure (https) address at this computer, passing web sockets through, then paste the address here.</p>
              <input className="input" value={web} onChange={(e) => setWeb(e.target.value)} placeholder="Web address, like https://crew.example.com" aria-label="Web address" autoComplete="off" />
              <div className="btns"><button className="btn go" disabled={!web.trim()}>Save</button></div>
            </form></details>
        </>}
      </div>
      <div className="card anywhere">
        <b>Reach it away from home</b>
        <p className="mute small">{A.awake()}</p>
        <p className="mute small">{A.anywhere(link).words}</p>
        {!!A.anywhere(link).steps.length && <ol className="how">{A.anywhere(link).steps.map((s) => <li key={s}>{s}</li>)}</ol>}
        <p className="mute small"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get the connector app ↗</a> · For your own devices. It sees which devices are yours, never what they say.</p>
      </div>
      <details className="card" open={!!link.relay}><summary className="small">Another way in: run your own mailbox</summary>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { setLink(await api.phoneRelay((relay ?? link.relay).trim(), enrol)); setRelay(null); setEnrol(''); }, 'Saved'); }}>
        <p className="mute small">{A.reach(link).words}</p>
        <p className="mute small">A mailbox passes messages between your phones and this computer, so this computer opens nothing to the internet. <a href="https://github.com/umeranjum17/crewhouse/blob/main/relay/README.md" target="_blank" rel="noreferrer">Run your own ↗</a></p>
        <input className="input" value={relay ?? link.relay ?? ''} onChange={(e) => setRelay(e.target.value)} placeholder="Mailbox address, like https://go.example.com" aria-label="Mailbox address" autoComplete="off" />
        <input className="input" value={enrol} onChange={(e) => setEnrol(e.target.value)} placeholder="Invitation, if yours came with one" aria-label="Invitation" autoComplete="off" />
        <div className="btns"><button className="btn go" disabled={relay === null && !enrol}>Save</button>
          {!!link.relay && <button type="button" className="btn ghost" onClick={() => attempt(async () => setLink(await api.phoneRelay('')), 'Turned off')}>Turn off</button>}</div>
      </form></details>
    </>)}
  </>);
}

/** The three setup jobs, and where each one is finished. Google's own words stay inside the Google panel. */
function HomeSetup({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { if (!paired) api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  if (paired) return null;
  const { rows, left } = A.homeSetup(state, accounts, link);
  const jump = (key: string) => go(key === 'signin' ? '#/settings/accounts' : key === 'phones' ? '#/settings/phones' : '#/apps');
  return (<>
    <div className="label">Getting set up</div>
    <div className="card list">{rows.map((r) => (
      <div key={r.key} className="row-item">
        <span className={`setup-mark${r.done ? ' done' : ''}`} aria-label={r.done ? 'done' : 'to do'}>{r.done ? '✓' : '○'}</span>
        <span className="grow"><b>{r.says}</b></span>
        {!r.done && <button className="link" onClick={() => jump(r.key)}>Open</button>}
      </div>
    ))}{left === 0 && <div className="row-item mute small">All set.</div>}
    </div>
  </>);
}

/** Paired: this installed app carries a crew from its own computer. Its notifications ride the same mailbox, so the
 *  switch sits on this card: whether one is there is asked over the link (`POST /api/push {key}`), the one call crewd
 *  answers for this device's own grant — never /api/phones/link, which it refuses away from the computer. */
function PairedCard({ tick }: { tick: number }) {
  const [relay, setRelay] = useState<boolean | 'offline' | 'unreachable' | null>(null);
  useEffect(() => { api.pushKey().then((k) => setRelay(k.ready ? true : k.vapid ? 'offline' : false)).catch(() => setRelay('unreachable')); }, [tick]);
  return <div className="card nudge">
    <span className="grow"><b>Paired with {paired!.name}</b><div className="mute small">This app shows your own crew, straight from that computer and locked to it.</div>
      <NotifyLine relay={relay} norelay="Your computer has no mailbox for notifications yet. Turn one on there, then try again." /></span>
    <button className="btn" onClick={() => confirm('Unpair this app? It goes back to the demo, and you can pair again any time.') && attempt(paired!.unpair)}>Unpair</button>
  </div>;
}
/** A Settings sub-page: a round back to the hub, the page's name, and "Settings" under it. */
function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="page settings sub"><div className="sticky-top"><header className="chat-head">
    <a href="#/settings" className="back" aria-label="Back to Settings">‹</a><div className="grow"><b>{title}</b><div className="mute small">Settings</div></div></header></div>{children}</div>;
}
/** One hub row: an icon tile, what it is, one plain line of where it stands, and a chevron. */
const HubRow = ({ href, tile, title, says }: { href: string; tile: React.ReactNode; title: string; says: string }) =>
  <a href={href} className="row-item go-to"><span className="o-ic">{tile}</span><span className="grow"><b>{title}</b><div className="mute small">{says}</div></span><Icon name="next" /></a>;

function CustomRules({ tick }: { tick: number }) {
  const [rules, setRules] = useState<string[]>([]), [editing, setEditing] = useState<string | null>(null), [text, setText] = useState(''), [error, setError] = useState('');
  const load = useCallback(async () => { try { setRules((await api.rules()).rules); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load, tick]);
  const save = (next: string, old: string) => void attempt(async () => { await api.setRule(next, old); setEditing(null); await load(); }, next ? 'Saved' : 'Removed');
  return <><p>Rules you confirmed with Chief. Every helper reads them before a job.</p><p className="mute">These do not change safety checks or give permission to send, spend or delete.</p>
    {error && <p role="alert">{error}</p>}
    {rules.length ? rules.map((rule) => <div className="card" key={rule}>{editing === rule ? <form onSubmit={(e) => { e.preventDefault(); save(text, rule); }}>
      <label className="label">Edit rule<textarea className="input" aria-label="Edit rule" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} rows={5} /></label>
      <div className="btns"><button className="btn go" disabled={!text.trim()}>Save changes</button><button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form> : <><p>{rule}</p><div className="btns"><button className="btn" onClick={() => { setEditing(rule); setText(rule); }}>Edit</button><button className="link" onClick={() => save('', rule)}>Remove</button></div></>}</div>) : !error && <div className="card empty">No custom rules yet. Tell Chief how you want the crew to work.</div>}
    <a className="btn" href="#/chief">Talk to Chief</a></>;
}

function Settings({ state, refresh, tick, accounts, look, setLook, tab }: Ctx & { look: string; setLook: (l: string) => void; tab?: string }) {
  const [signing, setSigning] = useState<{ ai: (typeof A.AIS)[number]; tab: Window | null } | null | false>(sheet === 'signin' ? null : false);
  const [lines, setLines] = useState<number | null>(null), [phones, setPhones] = useState<Json[] | null>(null);
  useEffect(() => { void api.about().then((a) => setLines(A.memories(a.notes ?? '').length)).catch(() => {}); if (!paired) void api.phones().then(setPhones).catch(() => {}); }, [tick]);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  const m = state.person, display = A.displayName(m), [from, to] = (m.quiet ?? '').split('-');
  const mine = A.aiList(accounts).mine.filter((r) => r.g.state === 'ready'), on = A.apps(state).filter((a) => a.on);
  const signingSheet = signing !== false && <SignIn ai={signing?.ai} tab={signing?.tab} onReady={() => { setSigning(false); refresh(); }} onClose={() => setSigning(false)} />;
  if (tab === 'you') return <SettingsPage title="You"><You state={state} act={act} plan={A.planName(accounts)} /><Money state={state} refresh={refresh} /></SettingsPage>;
  if (tab === 'rules') return <SettingsPage title="Custom rules"><CustomRules tick={tick} /></SettingsPage>;
  if (tab === 'memory') return <SettingsPage title="What the crew remembers"><Memory tick={tick} /></SettingsPage>;
  if (tab === 'accounts') return <SettingsPage title="AI accounts"><AiAccounts accounts={accounts} refresh={refresh} signIn={(ai) => setSigning({ ai, tab: 'keyEntry' in ai && ai.keyEntry === true ? null : openTab() })} />{signingSheet}</SettingsPage>;
  if (tab === 'phones' && !paired) return <SettingsPage title="Phones"><Phones tick={tick} /></SettingsPage>;
  // On a computer (J09a) two columns under the trust card: You and Look on the left, what is connected on the right; on a
  // phone the two lists read as one card, then Look.
  return (
    <div className="page stack stack-home settings hub">
      <header className="st-head"><a href="#/" className="back phone-only" aria-label="Back">‹</a><span className="grow"><h1 className="wide">Settings</h1></span></header>
      <div className="st-pri">
        <div className="card trust-card"><span className="o-ic"><Icon name="lock" /></span><p><b>{A.trust.hub[0]}</b> {A.trust.hub[1]}</p></div>
        {demo && <PairRow />}
        {paired && <PairedCard tick={tick} />}
        <div className="set-cols">
          <div className="set-col">
            <div className="st-label desk-only"><span>You</span></div>
            <div className="card list go-tos set-you">
              <HubRow href="#/settings/you" tile={<b>{(display || 'You')[0]}</b>} title="You" says={`${display || 'Your name'}${m.quiet ? ` · quiet ${from} to ${to}` : ''}`} />
              <HubRow href="#/settings/rules" tile={<Icon name="lock" />} title="Custom rules" says="How you want the crew to work" />
              <HubRow href="#/settings/memory" tile={<Icon name="copy" />} title="What the crew remembers" says={lines === null ? '' : `${lines} ${lines === 1 ? 'line' : 'lines'}`} />
            </div>
            <div className="st-label set-look"><span>Look</span></div>
            <div className="seg set-look">{[['auto', 'Match device'], ['day', 'Day'], ['night', 'Night']].map(([k, l]) => <button key={k} className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{l}</button>)}</div>
            <div className="set-more"><Install /></div>
          </div>
          <div className="set-col">
            <div className="st-label desk-only"><span>Connected</span></div>
            <div className="card list go-tos set-con">
              <HubRow href="#/settings/accounts" tile={<Icon name="talk" />} title="AI accounts" says={mine.length ? `${mine[0].ai.name} · signed in` : 'Not signed in yet'} />
              <HubRow href="#/apps" tile={<Icon name="plus" />} title="Apps" says={on.length ? on.map((a) => a.name).slice(0, 3).join(', ') : 'None added yet'} />
              {!paired && <HubRow href="#/settings/phones" tile={<Icon name="phone" />} title="Phones" says={phones === null ? '' : phones.length ? `${phones.length} ${phones.length === 1 ? 'phone' : 'phones'} paired` : 'None paired yet'} />}
              {cloudOn && <HubRow href="#/computer" tile={<Icon name="cloud" />} title={A.computer(null).title} says="" />}
            </div>
            <div className="set-more"><HomeSetup state={state} accounts={accounts} tick={tick} />
              <HouseGoogle on={!!state.house?.google} steps={state.house?.steps} refresh={refresh} /></div>
          </div>
        </div>
      </div>
      {signingSheet}
    </div>
  );
}

/** Boat forbids browser setup/management (CORS); its key stays on the owner phone. No placeholder actions. */
function ChiefComputer() {
  const w = A.computer(null), boat = A.CLOUD.boat;
  const two = ([l, v]: string[], red = false) => <span className="grow"><span className={red ? 'danger' : ''}>{l}</span><span className="mute small">{v}</span></span>;
  return (
    <div className="page settings computer">
      <a href="#/settings" className="back">‹ Settings</a>
      <h1>{w.title}</h1>
      <p className="mute">Manage this computer in the phone app that set it up. {w.keyAway}</p>
      <div className="card list"><button className="row-item" disabled>{two([w.update[0], 'Use the phone app'])}</button>
        <button className="row-item" disabled>{two([w.reset[0], 'Use the phone app'], true)}</button></div>
      <p className="mute small computer-cap">{w.caption}</p>
      <div className="card list"><label className="row-item">{two(w.daily)}<input type="checkbox" role="switch" checked={false} disabled /></label>
        <button className="row-item" disabled>{two([w.save[0], 'Use the phone app'])}</button>
        <div className="row-item">{two([w.disk[0], 'Check in the phone app'])}</div></div>
      <div className="card list"><div className="row-item"><span className="o-ic" style={{ background: boat.tile, color: '#fff' }}>{boat.mark}</span>{two(w.host)}</div></div>
      <p className="mute small computer-cap">{w.keyAway}</p>
      <details className="more-ways"><summary><span className="grow">{w.more}</span><i aria-hidden>›</i></summary>
        <div className="card list"><button className="row-item" disabled>{two([w.undo, w.unavailable])}</button>
          <button className="row-item" disabled>{two([w.remove, 'Use the phone app'], true)}</button></div></details>
    </div>
  );
}

// The browser's own install offer (Chrome, Edge, Android), held for Settings rather than shown on its own.
let offer: (Event & { prompt: () => Promise<unknown> }) | null = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e as typeof offer; });
addEventListener('appinstalled', () => { offer = null; });

/** One quiet row: put Crewhouse on this device like an app. The browser's own install where it offers one, the Share
 *  steps on an iPhone or iPad; never once it runs installed, or after Not now on this device. */
function Install() {
  const [, redraw] = useState(0);
  const [gone, setGone] = useState(() => { try { return !!localStorage.getItem('crewhouse.install.hide'); } catch { return false; } });
  useEffect(() => {
    const f = () => redraw((n) => n + 1);
    addEventListener('beforeinstallprompt', f); addEventListener('appinstalled', f);
    return () => { removeEventListener('beforeinstallprompt', f); removeEventListener('appinstalled', f); };
  }, []);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (gone || matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone || !(offer || ios)) return null;
  const hide = () => { try { localStorage.setItem('crewhouse.install.hide', '1'); } catch { /* remembered for this visit only */ } setGone(true); };
  return (
    <div className="card row install">
      <span className="o-ic"><Icon name="phone" /></span>
      <span className="grow">{offer ? 'Use Crewhouse like an app' : 'Keep Crewhouse on your Home Screen: tap Share, then Add to Home Screen'}</span>
      {offer && <button className="btn" onClick={() => attempt(async () => { const o = offer!; offer = null; await o.prompt(); redraw((n) => n + 1); })}>Install</button>}
      <button className="link" onClick={hide}>Not now</button>
    </div>
  );
}

/** The accounts the crew thinks with, signed in first; every other route waits quietly under "More ways to sign in". */
function AiAccounts({ accounts, refresh, signIn }: { accounts: Json[] | null; refresh: () => void; signIn: (ai: (typeof A.AIS)[number]) => void }) {
  const { mine, more } = A.aiList(accounts);
  const row = ({ ai, g, says }: ReturnType<typeof A.aiList>['more'][number]) => (
    <div key={ai.key} className="ai-row">
      <AiMark ai={ai} />
      {g.state === 'ready' ? <a className="grow ai-open" href={`#/settings/ai/${ai.key}`}><b>{ai.name}</b> <span className="mute" aria-hidden>›</span><div className="mute small">{says}</div></a>
        : <div className="grow"><b>{ai.name}</b><div className="mute small">{says}</div></div>}
      {g.state === 'signed-out' && <button className={`btn ${mine.some((r) => r.ai === ai) ? 'go' : 'quiet'}`} onClick={() => signIn(ai)}>Sign in</button>}
      {g.state === 'ready' && <button className="link" onClick={() => attempt(async () => { await api.signOut(ai.key); refresh(); }, `Signed out of ${ai.name}`)}>Sign out</button>}
    </div>
  );
  return (<>
    <div className="card list ai-list">{mine.map(row)}</div>
    {more.length > 0 && <details className="more-ways">
      <summary><span className="grow">More ways to sign in</span><span className="ai-stack">{more.map((r) => <AiMark key={r.ai.key} ai={r.ai} size={22} />)}</span><i aria-hidden>›</i></summary>
      <div className="card list ai-list">{more.map(row)}</div>
    </details>}
    <p className="mute small">{A.AI_ROUTES}</p>
  </>);
}

/** One signed-in account (mock model-a): which of its plan's models the whole crew uses, picked by the person and
 *  never switched behind their back; a limit waits for them here. */
function AiAccount({ id, accounts, refresh }: Ctx & { id: string }) {
  const ai = A.AIS.find((a) => a.key === id), [cat, setCat] = useState<Json>(null), [their, setTheir] = useState<Record<string, string>>({});
  const others = A.aiList(accounts).mine.filter((r) => r.ai !== ai && r.g.state === 'ready'), keys = others.map((r) => r.ai.key).join();
  const load = () => api.models(id).then(setCat).catch(() => setCat({ models: [], picked: null }));
  useEffect(() => { setCat(null); void load(); }, [id]);
  // Each other account's own pick, by name: one catalog read each, as the page opens.
  useEffect(() => { void Promise.all(others.map(async ({ ai: o }) => { const c = await api.models(o.key).catch(() => null); return [o.key, c?.models.find((m: Json) => m.id === c.picked)?.name] as const; }))
    .then((rows) => setTheir(Object.fromEntries(rows.filter(([, n]) => n) as [string, string][]))); }, [keys]);
  if (!ai) return null;
  const g = A.account(accounts, id), plan = ai.billing === 'api' ? 'account' : 'plan';
  const [pasting, setPasting] = useState(false), keyed = 'keyEntry' in ai && ai.keyEntry === true;
  const pick = (m: Json) => attempt(async () => { await api.pickModel(id, m.id); await load(); refresh(); }, `Your crew uses ${m.name} from now on`);
  return (
    <div className="page ai-page">
      <a href="#/settings/accounts" className="back">‹ AI accounts</a>
      <h2>{ai.name}</h2>
      <p className="mute small">{g.state === 'signed-out' ? 'Not signed in' : `Signed in · your ${plan}`}{g.resting ? ` · ${g.resting}` : ''}</p>
      {keyed && <button className={`btn ${g.state === 'signed-out' ? 'go' : 'quiet'}`} onClick={() => setPasting(true)}>{g.state === 'signed-out' ? `Paste your ${ai.name} key` : 'Paste a new key'}</button>}
      {pasting && <SignIn ai={ai} tab={null} onReady={() => { setPasting(false); refresh(); }} onClose={() => setPasting(false)} />}
      <div className="label">Which model your crew uses</div>
      {!cat ? <p className="mute small">Checking your plan…</p> : cat.models.length ? <div role="radiogroup" aria-label="Which model your crew uses">
        {cat.models.map((m: Json) => <button key={m.id} role="radio" aria-checked={cat.picked === m.id} className={`pick ${cat.picked === m.id ? 'on' : ''}`} onClick={() => cat.picked !== m.id && pick(m)}>
          <span className="radio" aria-hidden /><span className="grow">{m.name}</span></button>)}
      </div> : null}
      {cat && <p className="cap">{cat.models.length ? `The list comes from your ${plan} and updates by itself. ${cat.picked ? 'Chief and every helper use this one.' : 'Until you pick, your crew uses the plan’s default.'}` : `Your crew uses the model saved with this ${plan}.`}</p>}
      {others.length > 0 && <><div className="label">Other accounts</div>
        <div className="card list">{others.map(({ ai: o }) => <a key={o.key} className="row-item" href={`#/settings/ai/${o.key}`}><AiMark ai={o} />
          <span className="grow"><b>{o.name}</b><span className="mute small">{their[o.key] ?? 'The plan’s default'}</span></span><Icon name="next" /></a>)}</div></>}
    </div>
  );
}

/** The monthly money cap. Helpers ask before every spend; past this they can't spend at all. */
function Money({ state, refresh }: { state: Json; refresh: () => void }) {
  const m = A.money(state);
  const [cap, setCap] = useState(String(m?.cap ?? 20));
  useEffect(() => setCap(String(m?.cap ?? 20)), [m?.cap]);
  if (!m) return null;
  return (<>
    <div className="label">Money</div>
    <form className="card form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { await api.moneyCap(Number(cap)); refresh(); }, 'Saved'); }}>
      <label className="field">The crew asks before every purchase; this is the most it can spend in a month on things priced in dollars
        <span className="row">$<input className="input" style={{ maxWidth: 120 }} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))} aria-label="Most the crew may spend in a month, in dollars" />
          <button className="btn" disabled={!cap || Number(cap) === m.cap}>Save</button></span></label>
      <div className="mute small">{m.month}</div>
    </form>
  </>);
}

/** Switch Google on once. Each step opens the Google page it happens on, in turn, and the
 *  last one ends with two things to paste here (docs/google-setup.md has the same steps with the why). */
function HouseGoogle({ on, steps, refresh }: { on: boolean; steps?: A.GoogleStep[] | null; refresh: () => void }) {
  const [edit, setEdit] = useState(false);
  const [step, setStep] = useState(0);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const last = step === A.GOOGLE_STEPS.length - 1;
  const s = A.GOOGLE_STEPS[step];
  return (<>
    <div className="label" id="setup-google">Google setup</div>
    {on && !edit ? <div className="card">
        <div className="row"><span className="grow"><b>{A.googleHeadline(steps)}</b><div className="mute small">{steps ? 'Your setup so far. Check the remaining steps on Google’s pages.' : 'Your crew’s own Google app is ready. Connect Calendar, Gmail or Drive from any app, in one tap.'}</div></span>
          <button className="btn" onClick={() => { setEdit(true); setStep(A.GOOGLE_STEPS.length - 1); }}>{steps ? 'Change sign-in' : 'Use my own key'}</button></div>
        {steps?.map((m, i) => <div key={i} className="row stack-row">
          <span className="grow"><b>{i + 1}. {A.GOOGLE_STEPS[i].title}</b> <span className={m.state === 'checked' ? 'ok' : m.state === 'missing' ? 'warn-line' : 'mute'}>{A.STEP_MARK[m.state]}</span><div className="mute small">{m.note}</div></span>
          {m.state === 'missing' && <a className="btn go" href={A.GOOGLE_STEPS[i].url} target="_blank" rel="noreferrer">Open Google's page</a>}
        </div>)}
      </div>
      : <form className="card form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { await api.houseGoogle(id, secret); setEdit(false); refresh(); }, 'Google is on'); }}>
        <b>Switch Google on</b>
        <p className="mute small">About twenty minutes on Google's own pages, free. Then you can let a helper use your Calendar, Gmail or Drive with one tap.</p>
        <div className="mute small">Step {step + 1} of {A.GOOGLE_STEPS.length}</div>
        <b>{s.title}</b>
        <p className="small">{s.says}</p>
        <div className="btns">
          <a className="btn go" href={s.url} target="_blank" rel="noreferrer">Open Google's page</a>
          {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {!last && <button type="button" className="btn" onClick={() => setStep(step + 1)}>Done, next step</button>}
        </div>
        {last && <>
          <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="Client ID (ends in .apps.googleusercontent.com)" aria-label="Client ID" autoComplete="off" />
          <input className="input" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret" aria-label="Client secret" type="password" autoComplete="off" />
          <div className="btns"><button className="btn go" disabled={!id.trim() || !secret.trim()}>Switch it on</button>{on && <button type="button" className="btn ghost" onClick={() => setEdit(false)}>Cancel</button>}</div>
        </>}
        <p className="mute small"><a href="https://github.com/umeranjum17/crewhouse/blob/main/docs/google-setup.md" target="_blank" rel="noreferrer">The same steps, with why ↗</a></p>
      </form>}
  </>);
}

/** The person's own settings in one card: their name, what Chief calls them, quiet hours and the crew's share of
 *  their AI. The stored default name "Owner" reads as no name yet, as it does on Hello (`A.realName`/`A.displayName`). */
function You({ state, act, plan }: { state: Json; act: (fn: () => Promise<unknown>, ok?: string) => unknown; plan: string }) {
  const m = state.person;
  const named = A.realName(m), display = A.displayName(m);
  const [name, setName] = useState(named);
  const [address, setAddress] = useState(m.address ?? '');
  useEffect(() => setName(named), [named]);
  useEffect(() => setAddress(m.address ?? ''), [m.address]);
  const [from, to] = (m.quiet ?? '22:00-07:00').split('-');
  const share = A.share(state, plan), shares = A.shares(plan);
  return (
    <div className="card person">
      <div className="row">
        <span className="initial">{(display || 'You')[0]}</span>
        <div className="grow"><b>{display || 'You'}</b>
          <div className="mute small">{m.address ? `Chief greets you as “${m.address}”` : 'Chief will say hello the first time you open Crewhouse'}</div></div>
      </div>
      <label className="field">Your name
        <input className="input" value={name} placeholder="Your name" autoComplete="given-name" onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== named && act(() => api.person(m.id, { name }), 'Saved')} /></label>
      <label className="field">Chief greets you as
        <input className="input" value={address} placeholder="a name, or leave it to Chief" onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() && address !== m.address && act(() => api.person(m.id, { address }), 'Saved')} /></label>
      <label className="toggle-row"><span className="grow">Quiet hours{m.quiet ? `, ${from} to ${to}` : ''}<div className="mute small">Nothing new pings you then; the crew keeps going on what's already OK.</div></span>
        <input type="checkbox" role="switch" checked={!!m.quiet} onChange={(e) => act(() => api.person(m.id, { quiet: e.target.checked ? '22:00-07:00' : null }))} /></label>
      <div className="field">How much of your AI the crew may use
        <div className="seg">{shares.map((o) => <button key={o.key} className={share.choice === o.key ? 'on' : ''} title={o.says}
          onClick={() => act(() => api.person(m.id, { share: o.key }), o.says)}>{o.label}</button>)}</div>
        <span className="mute small">{shares.find((o) => o.key === share.choice)?.says}. {share.today} {share.week}</span></div>
    </div>
  );
}

/** Add to your crew: every reviewed app, skill and plugin on one list, in sections by what it is for (mail and
 *  calendar first), with search, a filter, the "N added" count and Add/Added on each row. Search also asks the
 *  public catalogs; only reviewed rows switch on, anything else says so in plain words. */
function Apps({ state, refresh }: Ctx) {
  const [skills, setSkills] = useState<Json>(null);
  const [herdr, setHerdr] = useState<Json>(null);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const [all, setAll] = useState<string[]>([]);
  const [found, setFound] = useState<A.CrewRow[] | null>(null);
  const [connecting, setConnecting] = useState<{ app: A.App; tab: Window | null } | null>(null);
  const [composio, setComposio] = useState<Json>(null), [joining, setJoining] = useState(false);
  const loadComposio = () => api.composio().then(setComposio).catch(() => setComposio({ state: 'off' }));
  useEffect(() => { void loadComposio(); }, []);
  const load = () => api.skills().then(setSkills).catch(() => setSkills({ starter: [] }));
  useEffect(() => { void load(); void api.herdr().then(setHerdr).catch(() => setHerdr(false)); }, []);
  const rows = A.crewRows(state, skills, herdr), plugin = A.herdr(herdr), added = rows.filter((r) => r.on);
  const words = q.trim().toLowerCase(), hits = rows.filter((r) => !words || `${r.name} ${r.line}`.toLowerCase().includes(words));
  const sections = A.PURPOSES.map(([key, title]) => ({ key, title, rows: hits.filter((r) => r.purpose === key) })).filter((x) => x.rows.length);
  // Switching answers in crewd's own words (the stand-in engine says it is still starting; the trust check names an
  // unreviewed skill), so the failure toast carries the reason, not a generic line.
  const flip = async (r: A.CrewRow, on: boolean) => {
    try { await api.skillSwitch(r.id, on); await load(); refresh(); toast(`${r.name} is ${on ? 'added' : 'off'}`); }
    catch (e: any) { toast(e?.status ? String(e.message) : "Can't reach the home computer right now. Check it's on, then try again."); }
  };
  const add = (r: A.CrewRow) => {
    if (r.kind === 'skill') return void flip(r, true);
    if (r.kind === 'plugin') { // Herdr is installed by the person: Add opens its page; once installed, Add asks it again.
      if (plugin?.state === 'setup') return void attempt(async () => setHerdr(await api.herdr()), '');
      const tab = openTab(); if (tab) tab.location.href = 'https://herdr.dev'; return;
    }
    const app = A.appById(state, r.id)!;
    setConnecting({ app, tab: A.needsHouse(state, app) ? null : openTab() });
  };
  const remove = (r: A.CrewRow) => {
    if (r.kind === 'plugin' || !confirm(`Turn off ${r.name}? Your crew will stop using it.`)) return;
    if (r.kind === 'skill') return void flip(r, false);
    void attempt(async () => { await api.disconnect(r.id); refresh(); }, `${r.name} is off`);
  };
  const mark = (r: A.CrewRow, cls = 'app-ic') => <span key={r.id} className={cls} aria-hidden>{r.logo ? <img className="app-logo" src={r.logo} alt="" /> : <b>{r.name[0]}</b>}</span>;
  const row = (r: A.CrewRow, i?: number) => (
    <div key={`${r.kind}-${r.id}-${i ?? ''}`} className="row-item app-row-item">{mark(r)}
      <div className="grow"><b>{r.name}</b>{r.maturity && <span className={`maturity ${r.maturity}`}>{r.maturity[0].toUpperCase() + r.maturity.slice(1)}</span>}<div className="mute small add-line">{r.line}</div>
        {r.id === 'herdr' && plugin && plugin.state !== 'on' && <div className="mute small">{plugin.state === 'missing' && plugin.howto ? plugin.howto : plugin.says}</div>}
        {!r.reviewed && <div className="mute small">{r.by ? `By ${r.by}. ` : ''}Not reviewed yet, so the crew leaves it alone.</div>}</div>
      {r.on ? <button className="mini added" disabled={r.kind === 'plugin'} aria-label={`${r.name} is added${r.kind === 'plugin' ? '' : '. Turn it off'}`} onClick={() => remove(r)}>Added ✓</button>
        : r.reviewed && <button className="mini" aria-label={`Add ${r.name}`} onClick={() => add(r)}>{r.id === 'herdr' && plugin?.state === 'setup' ? 'Retry' : 'Add'}</button>}
    </div>);
  const search = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (words.length < 2) return;
    void attempt(async () => setFound(A.catalogRows((await api.skillSearch(q.trim())).results ?? [], rows).filter((r) => !hits.includes(r))), '');
  };
  return (
    <div className="page add-crew">
      <a href="#/settings" className="back" aria-label="Back to Settings">‹</a>
      <h1>Apps</h1>
      <form className="add-search" role="search" onSubmit={search}><Icon name="search" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setFound(null); }} placeholder="Search apps and skills" aria-label="Search apps and skills" autoComplete="off" enterKeyHint="search" /></form>
      <div className="card list">
        <div className="row-item app-row-item"><span className="app-ic" aria-hidden><b>C</b></span>
          <div className="grow"><b>Connect apps</b><div className="mute small add-line">Sign in once, and Chief can use the apps you pick.</div></div>
          {composio?.state === 'on' ? <button className="mini added" aria-label="Connect apps is on. Turn it off" onClick={() => void attempt(async () => { await api.composioOff(); await loadComposio(); }, 'Connect apps is off')}>Added ✓</button>
            : <button className="mini" aria-label="Connect apps" onClick={() => setJoining(true)}>Connect</button>}
        </div>
      </div>
      <div className="add-chips">
        {!!added.length && <span className="add-count">{added.slice(0, 3).map((r) => mark(r, 'app-ic xs'))}{added.length} added</span>}
        {[['', 'All'], ...A.PURPOSES.filter(([k]) => rows.some((r) => r.purpose === k))].map(([k, l]) =>
          <button key={k || 'all'} className={only === k ? 'on' : ''} aria-pressed={only === k} onClick={() => setOnly(k)}>{l}</button>)}
      </div>
      {skills === null ? <div className="card mute">Checking…</div> : sections.filter((x) => !only || x.key === only).map((x) => {
        const open = !!only || !!words || all.includes(x.key), shown = open ? x.rows : x.rows.slice(0, 4);
        return <section key={x.key} aria-label={x.title}>
          <div className="add-head"><b>{x.title}</b>{shown.length < x.rows.length && <button className="link" onClick={() => setAll([...all, x.key])}>See all {x.rows.length}</button>}</div>
          <div className="card list">{shown.map((r) => row(r))}</div></section>;
      })}
      {skills !== null && !!words && !sections.length && !found?.length && <p className="card mute small">{found ? `Nothing found for “${q.trim()}”. Ask Chief instead.` : 'Nothing here by that name.'}
        {!found && words.length > 1 && <> <button className="link" onClick={search}>Look in the catalog</button></>}</p>}
      {!!found?.length && <section aria-label="In the catalog"><div className="add-head"><b>In the catalog</b></div><div className="card list">{found.map((r, i) => row(r, i))}</div></section>}
      <p className="mute small center">Every app and skill here is reviewed. Adding one opens its own sign-in when it needs one.</p>
      {joining && <ComposioSheet state={composio} onChange={() => void loadComposio()} onClose={() => setJoining(false)} />}
      {connecting && <ConnectApp app={connecting.app} state={state} tab={connecting.tab} onClose={() => setConnecting(null)} onDone={() => { setConnecting(null); refresh(); }} />}
    </div>
  );
}

// ---------- shell ----------
function useLook() {
  const q = new URLSearchParams(location.search);
  const [look, setLookState] = useState(() => (q.has('night') ? 'night' : q.has('day') ? 'day' : localStorage.getItem('crewhouse.look') ?? 'auto'));
  // Auto follows the device's own dark setting, as the native app does, and switches live when it changes. The query
  // lives in state so the browser keeps it, and its change listener, for as long as the app runs.
  const [media] = useState(() => matchMedia('(prefers-color-scheme: dark)'));
  // `matches` is read only at the start, on subscribing and in the listener, never on a render: Chromium's getter takes
  // in a pending change, so a re-render between the device's switch and its change event swallows the event.
  const [dark, setDark] = useState(() => media.matches);
  // Layout effect: subscribed in the same commit that paints, and re-read at once, so no change is missed in between.
  useLayoutEffect(() => { const on = () => setDark(media.matches); on(); media.addEventListener('change', on); return () => media.removeEventListener('change', on); }, [media]);
  const [motion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)'));
  const [reduced, setReduced] = useState(() => motion.matches);
  useLayoutEffect(() => { const on = () => setReduced(motion.matches); on(); motion.addEventListener('change', on); return () => motion.removeEventListener('change', on); }, [motion]);
  const night = look === 'night' || (look === 'auto' && dark);
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', night ? '#000000' : '#F4F3EF'); // the browser's bar and the phone's status bar
    document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.setAttribute('content', night ? 'black-translucent' : 'default'); // iOS reads it at launch; kept in step with the look
  }, [night]);
  const setLook = (l: string) => { localStorage.setItem('crewhouse.look', l); setLookState(l); };
  return { look, setLook, night, reduced };
}

/** The frame's four places, in this order on the phone's tab bar and the computer's side menu (Stack). Chief is the
 *  primary one: his tab is the filled one, and in the side menu he wears his face and his one status word. */
const PLACES: [string, string, IconName, View][] = [['#/', 'Home', 'home', 'home'], ['#/chief', 'Chief', 'talk', 'chief'], ['#/jobs', 'Jobs', 'jobs', 'jobs'], ['#/crew', 'Crew', 'crew', 'crew']];
/** The computer side menu's lower places, quieter than the four above. */
const MORE: [string, string, IconName, View][] = [['#/things', 'Your things', 'copy', 'things'], ['#/routines', 'Routines', 'clock', 'routines'], ['#/apps', 'Apps', 'plus', 'apps'], ['#/settings', 'Settings', 'settings', 'settings']];
/** Which place a screen belongs to, so its tab reads as the one you are in. */
const placeOf = (r: Route): View => r.view === 'helper' ? (r.id === 'chief' ? 'chief' : 'crew') : r.view === 'add' || r.view === 'room' ? 'crew' : r.view === 'ai' || r.view === 'computer' ? 'settings' : r.view;

/** The side menu's crew: every helper with the word the office uses for them (A.roster), one line each. Only Chief
 *  says "Needs you"; a crew row never asks the person. */
function SideCrew({ live, id }: { live: A.OfficeView; id?: string }) {
  return (
    <div className="side-crew">
      <a className="label side-label" href="#/crew">Your crew</a>
      {A.roster(live.crew).map((h) => {
        const r = A.statusOf(h, live);
        // The seat class is namespaced (`seat-…`) so a seat word like "chat" never collides with an unrelated rule.
        return <a key={h.id} href={hrefOf(h.id)} className={`side-row ${id === h.id ? 'on' : ''}`}>
          <Face who={h} size={30} />
          <b className="grow clamp1">{h.name}</b>
          <span className={`side-seat seat-${r.seat}`}><span className="clamp1">{r.word}</span></span>
        </a>;
      })}
      {!live.crew.length && <a className="side-blank" href="#/crew/add">No helpers yet. Add one</a>}
    </div>
  );
}

/** Jobs: what waits on your yes (Chief's asks, each opening its review), then what the crew is at work on. */
function Jobs({ state, live }: Ctx) {
  const jobs = new Map(A.work(state).map((w) => [w.helper, w]));
  const busy = A.roster(live.crew).filter((c) => jobs.has(c.id));
  const quiet = live.counts.needs - live.needs.length; // each helper gone quiet: its Stop card waits in Chief's thread
  return <div className="page stack rest-screen jobs-page"><h1 className="wide">Jobs</h1><p className="st-line">What needs your yes, and what the crew is doing.</p>
    <div className="st-label"><span>Needs you</span></div>
    {live.needs.length > 0 && <div className="list-group"><NeedsRows state={state} cards={live.needs} /></div>}
    {quiet > 0 && <a className="st-room jobs-quiet" href="#/chief"><span className="grow"><b className="semi">{quiet} gone quiet</b><span>Stop it or leave it, in Chief's thread</span></span><Icon name="next" /></a>}
    {!live.counts.needs && <Empty>Nothing needs you.</Empty>}
    <div className="st-label"><span>At work</span></div>
    {busy.length ? <div className="st-crew">{busy.map((c) => <CrewCard key={c.id} c={c} live={live} job={jobs.get(c.id)} />)}</div> : <Empty>Nobody is on a job right now.</Empty>}
    <a className="st-room" href="#/things"><span className="grow"><b className="semi">Your things</b><span>Finished jobs and their files</span></span><Icon name="next" /></a>
  </div>;
}

/** Where a file opens as the whole page with what it is beside it (J07b), instead of beside a chat. */
const OVER: View[] = ['chief', 'things'];
function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const under = useRef<Route>({ view: route.view === 'ask' ? 'chief' : 'home' });
  // A file opened from Chief's thread or Your things reads over it, not over the chat of the helper who made it.
  if (route.view !== 'ask' && route.view !== 'pair' && !(route.file && OVER.includes(under.current.view))) under.current = route;
  const [state, setState] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  // A bare bookmark or typed address has no authority, so every read is refused with 403 no-authority while the
  // computer is up: one plain screen, never the offline one (which keeps a retry loop for a computer truly gone).
  const [noauth, setNoauth] = useState(false);
  setAway(offline);
  const [party, setParty] = useState<{ title: string; helper: string } | null>(null);
  const accounts = useAccounts(0, tick);
  const seenDone = useRef<Set<number> | null>(null);
  const heard = useRef(0); // when the home computer last answered
  const answered = useRef(false); // the computer has answered this visit, with state or with no authority
  const { look, setLook, night, reduced } = useLook();
  // The kept week stands in, read-only, and says when it was last heard. Nothing kept, nothing shown.
  const showKept = () => {
    const k = keptWeek();
    if (!k.state) return;
    heard.current ||= k.at;
    setState((cur: Json) => cur ?? k.state);
    setOffline(true);
  };
  const refresh = useCallback(() => {
    const pending = api.state().then((s) => { answered.current = true; setState(s); setOffline(false); setNoauth(false); heard.current = Date.now(); keepWeek((k) => K.keepState(k, s)); return s; })
      .catch((e) => {
        // No authority is the plain screen, never a kept copy served as if it were live.
        if (trouble(e) === 'noauth') { answered.current = true; setState(null); setNoauth(true); setOffline(false); return; }
        showKept();
        setOffline(true);
      });
    setTick((t) => t + 1);
    return pending;
  }, []);
  useEffect(() => {
    const onHash = () => { moved = true; setRoute(parseRoute()); remember(); };
    addEventListener('hashchange', onHash);
    remember(); // the opening place (a link or shortcut) is remembered too
    refresh();
    // Boot shows the kept copy at once when the computer has not answered within a second; a live answer that comes sooner
    // replaces nothing, so the kept copy never flashes.
    const grace = setTimeout(() => { if (!answered.current) showKept(); }, 1000);
    let pending: any;
    // Streamed words are not a change of state: refreshing on each would hold the refresh off until the reply ends.
    const stop = subscribe((e) => { hear(e); if (e.kind === 'reply.partial') return; clearTimeout(pending); pending = setTimeout(refresh, 120); });
    const poll = setInterval(refresh, 15000); // belt and braces if the socket is quietly gone
    if (new URLSearchParams(location.search).has('celebrate')) setParty({ title: "Mum's birthday video", helper: 'reel' });
    return () => { removeEventListener('hashchange', onHash); stop(); clearInterval(poll); clearTimeout(grace); };
  }, [refresh]);
  const wasOffline = useRef(false);
  useEffect(() => { if (wasOffline.current && !offline && state) { toast('Back in touch with the home computer ✓'); void mintFiles(); } wasOffline.current = offline; }, [offline]);
  // A job that finishes while you watch gets a little party, unless its result already sits on the screen you have open.
  useEffect(() => {
    if (!state) return;
    const done = A.things(state);
    if (seenDone.current) { const fresh = done.find((t) => !seenDone.current!.has(t.id)); if (fresh && !resultOpen(state, fresh)) setParty({ title: fresh.title, helper: fresh.helper }); }
    seenDone.current = new Set(done.map((t) => t.id));
  }, [state]);
  // The office's one state source (A.office, moved by live events): Home's room, header, tray, feed and the rail read it.
  // `signedOut` is the app's own accounts fact (the sign-in card's test), so the office counts Chief by it too.
  const live = useOffice(state, offline, chiefLocal({ accounts, offline }).signedOut && !offline);
  const ctx: Ctx | null = useMemo(() => (state && live ? { state, live, tick, refresh, night, offline, accounts } : null), [state, live, tick, refresh, night, offline, accounts]);

  // The home-screen icon carries Chief's count of what waits on the person's yes (web/src/pwa.ts), as his rail badge does.
  const badge = ctx?.live.counts.needs;
  useEffect(() => { if (badge !== undefined) setBadge(badge); }, [badge]);
  // A place whose thread has since been deleted opens Home instead, with no error (web/src/resume.ts). The check is
  // the same one HelperPage uses to tell "still here" from "left the crew".
  const here = under.current;
  const stranded = !!ctx && here.view === 'helper' && !!here.id && here.id !== 'chief'
    && !A.crew(ctx.state).some((h) => h.id === here.id) && !ctx.state.bots.some((b: Json) => b.id === here.id);
  useEffect(() => {
    let current = true;
    // A link can reach a newly hired helper before its roster event: confirm removal with a fresh read.
    if (stranded) void refresh().then((s) => {
      if (current && s && !s.bots.some((b: Json) => b.id === here.id)) { history.replaceState(null, '', '/#/'); dispatchEvent(new HashChangeEvent('hashchange')); }
    });
    return () => { current = false; };
  }, [stranded, here.id, refresh]);
  // First run lands straight in Chief's chat: he asks the name there, then pitches (no screen between).
  const firstRun = !!ctx && !ctx.state.person.onboarded;
  useEffect(() => { if (firstRun && route.view === 'home') go('#/chief'); }, [firstRun, route.view]);
  useEffect(() => { if (route.view === 'ask' && ctx && A.cards(ctx.state).some((c) => String(c.id) === route.id && c.kind === 'unlock')) { history.replaceState(null, '', '/#/chief'); dispatchEvent(new HashChangeEvent('hashchange')); } }, [route, ctx]);
  // Install before pairing/startup returns too: every face obeys Reduce Motion from its first paint.
  setFaceMoods(ctx ? A.chief(ctx.state, chiefLocal(ctx)).mood : 'idle', ctx?.live.crew ?? [], ctx?.live.talking, reduced);
  const splash = <Splash done={!!ctx || offline || noauth} />;
  if (pairable && !paired) return <>{removed ? <Removed onPair={() => { clearRemoved(); go('#/pair'); }} /> : location.pathname === '/share' ? <Share refresh={refresh} connected={false} /> : <Where pairing={false} />}{route.view === 'pair' && <PairSheet onClose={back} />}<Toasts /></>;
  if (!ctx) return <>{splash}{noauth ? <NoAuthority /> : offline && <Unreachable retry={refresh} />}</>;
  const engine = A.engineView(ctx.state);
  if (!ctx.state.person.onboarded && engine) return <>{splash}<GettingReady view={engine} refresh={refresh} /><Toasts /></>;
  const v = under.current;
  const crew = A.crew(ctx.state);
  const asks = ctx.live.counts.needs;
  const sheet = route.view === 'ask' ? A.cards(ctx.state).find((c) => String(c.id) === route.id) : undefined;
  const book = route.file && route.id ? { bot: route.id, path: route.file, title: route.title } : undefined;
  const made = book && A.things(ctx.state).find((t) => t.files.some((f) => A.fileSource(f.url)?.path === book.path && t.helper === book.bot));
  const place = placeOf(v);
  const me = A.displayName(ctx.state.person), quiet = A.quietLine(ctx.state.person);
  return (
    <>
      {splash}
      <div className={`shell ${['chief', 'helper', 'room'].includes(v.view) ? 'is-chat' : ''}${book && !OVER.includes(v.view) ? ' with-book' : ''}`}>
        <aside className="side">
          <a href="#/" className="brand"><Face who="chief" size={36} /><b>Crewhouse</b>{demo && <span className="demo-tag">Demo</span>}</a>
          <nav className="side-navs" aria-label="Places">{PLACES.map(([h, l, i, k]) => <a key={h} href={h} className={`side-nav nav-${k}${place === k ? ' on' : ''}`} aria-current={place === k ? 'page' : undefined}>
            <Icon name={i} size={22} /><span className="grow">{l}</span>
            {k === 'jobs' && asks > 0 && <span className="side-count">{asks}</span>}</a>)}</nav>
          <SideCrew live={ctx.live} id={v.view === 'helper' ? v.id : undefined} />
          <nav className="side-more" aria-label="More">{MORE.map(([h, l, i, k]) => <a key={h} href={h} className={`side-nav${place === k ? ' on' : ''}`} aria-current={place === k ? 'page' : undefined}><Icon name={i} size={22} />{l}</a>)}</nav>
          <a href="#/settings" className="side-me" aria-label={`Settings${me ? `, ${me}` : ''}`}>
            <span className="me-av">{(me[0] ?? '·').toUpperCase()}</span><span className="grow"><b className="clamp1">{me || 'You'}</b>{(A.meter(ctx.state) || quiet) && <span className="clamp1">{A.meter(ctx.state) || quiet}</span>}</span>
          </a>
        </aside>
        <main className="main">
          {offline && <div className="offline" role="status"><Icon name="wifioff" size={24} /><span className="grow"><b>Can't reach the home computer</b><span>{heard.current ? `Last heard ${A.clock(heard.current)}. ` : ''}You can read your recent chats. You can reply once it's back.</span></span><button className="btn soft" onClick={refresh}>Try now</button></div>}
          {v.view === 'home' && <Home {...ctx} />}
          {v.view === 'chief' && <ChiefPage {...ctx} m={v.m} />}
          {v.view === 'jobs' && <Jobs {...ctx} />}
          {v.view === 'room' && <Room {...ctx} />}
          {v.view === 'crew' && <Crew {...ctx} />}
          {v.view === 'add' && <AddHelper {...ctx} />}
          {v.view === 'helper' && v.id && !stranded && <HelperPage {...ctx} id={v.id} tab={v.tab!} />}
          {v.view === 'things' && <Things {...ctx} id={v.id} />}
          {v.view === 'routines' && <Routines {...ctx} id={v.id} />}
          {v.view === 'settings' && <Settings {...ctx} tab={v.tab} look={look} setLook={setLook} />}
          {v.view === 'ai' && v.id && <AiAccount {...ctx} id={v.id} />}
          {v.view === 'computer' && <ChiefComputer />}
          {v.view === 'apps' && <Apps {...ctx} />}
          {v.view === 'share' && <Share refresh={ctx.refresh} />}
        </main>
        <nav className="tabs" aria-label="Places">{PLACES.map(([h, l, i, k]) => <a key={h} href={h} className={`tab tab-${k}${place === k || (k === 'home' && place === 'routines') ? ' on' : ''}`} aria-current={place === k ? 'page' : undefined}>
          <span className="tab-ic"><Icon name={i} size={22} /></span><span className="tab-label">{l}</span>{k === 'jobs' && asks > 0 && <span className="tab-badge">{asks}</span>}</a>)}</nav>
      </div>
      {sheet?.site && <SiteSignIn c={sheet} bot={ctx.state.bots.find((b: Json) => b.id === sheet.site!.bot) ?? { id: sheet.site.bot, display: 'The crew' }} onClose={() => { ctx.refresh(); if (history.length > 1) history.back(); else go('#/'); }} />}
      {sheet && !sheet.site && sheet.kind !== 'unlock' && <AskSheet c={sheet} who={crew.find((h) => h.id === (sheet.by ?? sheet.helper))} chiefSays={ctx.state.asks.find((a: Json) => a.id === sheet.id)?.detail?.chief} onClose={() => go('#/chief')} />}
      {book && <PreviewPanel bot={book.bot} path={book.path} title={book.title} wide={OVER.includes(v.view)} who={makerOf(ctx.state, book.bot)}
        made={made && A.clock(made.at)} summary={made?.summary} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {route.view === 'pair' && !(pairable && !paired) && <PairSheet onClose={back} />}
      {party && <Celebrate title={party.title} href={hrefOf(party.helper)} onDone={() => setParty(null)} />}
      <Toasts />
    </>
  );
}

// the offline shell and web-push handler are ready from the first load on; an update says so once, and Reload is safe
// because the composer's draft is kept (draft.ts)
startWorker(() => toast('Crewhouse updated', { label: 'Reload', run: () => location.reload() }));
// The public shell decides once, before its first screen: a device grant kept here makes it the paired app; none, the demo.
void Promise.all([pairable ? import('./link.ts').then((l) => l.resume()) : Promise.resolve(), mintFiles()]).finally(() => { resume(); createRoot(document.getElementById('root')!).render(<App />); });
