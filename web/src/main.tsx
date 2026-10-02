// Crewhouse, direction C "Pocket Pals" with A's night mode and ASCII moments. Every screen reads the adapter's
// plain-words view models (adapter.ts), never crewd's raw rows.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { qrMatrix } from '@byokit/ui-core';
import { api, demo, subscribe, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
type Helper = ReturnType<typeof A.crew>[number];
import { AiMark, AskCard, Banner, AskSheet, attempt, Celebrate, setChiefMood, setNight, ChiefArt, Composer, Face, Dots, Logo, Media, ChatText, PalArt, Pill, Splash, Steps, Toasts, toast, useListen, PreviewPanel } from './parts.tsx';
import { keepDraft } from './draft.ts';
import { Screen } from './screen.tsx';
import { hear, Office, useOffice } from './office.tsx';
import { AccountCard, ConnectApp, ConnectCard, openTab, sheet, SignIn, Unreachable } from './flows.tsx';

type View = 'home' | 'chief' | 'room' | 'crew' | 'add' | 'helper' | 'things' | 'routines' | 'settings' | 'apps' | 'ask' | 'share';
type Route = { view: View; id?: string; tab?: string; m?: string; file?: string };
const ANCHOR = /^m(\d+)$/;
function parseRoute(): Route {
  if (location.pathname === '/share') return { view: 'share' }; // the phone's Share sheet (web/manifest.webmanifest)
  const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'h' && b) return { view: 'helper', id: b, tab: ANCHOR.test(c) ? 'chat' : c || 'chat', m: ANCHOR.test(c) ? c : undefined };
  // #/f/<helper>/<file>: the chat that delivered it, with the workbook open beside it (web/src/parts.tsx).
  if (a === 'f' && b && c) return { view: 'helper', id: b, tab: 'chat', file: decodeURIComponent(c) };
  if (a === 'ask' && b) return { view: 'ask', id: b };
  if (a === 'chief' && ANCHOR.test(b ?? '')) return { view: 'chief', m: b };
  if (a === 'things' && /^t\d+$/.test(b ?? '')) return { view: 'things', id: b };
  if (a === 'crew' && b === 'add') return { view: 'add' };
  return { view: (['chief', 'room', 'crew', 'things', 'routines', 'settings', 'apps'].includes(a) ? a : 'home') as View };
}
const go = (hash: string) => { location.hash = hash; };
let moved = false; // this session has navigated inside the app, so Back has somewhere to go back to
/** Back returns where you came from: the previous screen when there is one, else Chats. */
const back = () => { if (moved && history.length > 1) history.back(); else go('#/'); };
/** ?splash keeps the boot splash up, for design review. */
const hrefOf = (id: string) => (id === 'chief' ? '#/chief' : id === 'room' ? '#/room' : `#/h/${id}`);
/** Which chat each composer writes into: its held draft lives in web/src/draft.ts. */
const typeInto = (id: string) => ({ chat: id });

type Ctx = { state: Json; live: A.OfficeView; tick: number; refresh: () => void; night: boolean; offline: boolean; accounts: Json[] | null };

/** What Chief knows from the app itself, not the state: the computer out of reach, his composer, the sign-in. */
function chiefLocal(ctx: Ctx, listen = false): A.ChiefLocal {
  const g = A.account(ctx.accounts);
  return { offline: ctx.offline, listen, signedOut: g.state === 'signed-out' || g.notIncluded };
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

/**
 * First run, as the onboarding prototype: Chief greets you by your name, two promises, and three things he
 * can take off your plate. One tap on an idea is both "hello" and your first job; the sign-in comes right after, in the
 * chat, when you already want something. Nothing to type.
 */
function Hello({ state, refresh, night }: Ctx) {
  const me = state.person;
  const named = me.name && me.name !== 'Owner' ? me.name : '';
  const [address, setAddress] = useState<string>(me.address || named);
  const [other, setOther] = useState(!named);
  const input = useRef<HTMLInputElement>(null);
  const [tipped, setTipped] = useState(false); // he raises his bowler as he greets, then settles
  const [own, setOwn] = useState(false);
  const [words, setWords] = useState('');
  useEffect(() => { const t = setTimeout(() => setTipped(true), 2400); return () => clearTimeout(t); }, []);
  const pick = (ask: string, bot?: string) => {
    if (!address.trim()) { setOther(true); toast('First, what shall I call you?'); input.current?.focus(); return; }
    void attempt(async () => { await api.onboard(address.trim(), ask, bot); refresh(); go('#/chief'); });
  };
  return (
    <div className="hello">
      <div className="hello-brand" role="img" aria-label="Crewhouse"><Banner /></div>
      <span className="halo"><ChiefArt mood={tipped ? 'idle' : 'hello'} d={8.5} hero /></span>
      <div className="speech">
        <h1>{A.greeting()}{address.trim() ? `, ${address.trim()}` : ''}</h1>
        <p className="lead">I'm Chief, your personal assistant. I run your crew of helpers.</p>
      </div>
      <ul className="promises">
        <li>Your helpers live on this computer, and think with your own ChatGPT.</li>
        <li>{A.atHome()[1]}</li>
        <li>I'll ask before sending messages, deleting things or spending money.</li>
      </ul>
      <h2 className="plate">What can I take off your plate?</h2>
      <div className="ideas">
        {A.firstIdeas(state).map((i) => <button key={i.label} className="idea" onClick={() => pick(i.label, i.bot)}><span aria-hidden>{i.icon}</span><b>{i.label}</b><i aria-hidden>›</i></button>)}
      </div>
      {own ? <div className="own-ask">
        <input className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder="Ask for anything…" aria-label="Your first ask"
          onKeyDown={(e) => { if (e.key === 'Enter' && words.trim()) pick(words.trim()); }} />
        <button className="btn go" disabled={!words.trim()} onClick={() => pick(words.trim())}>Send</button>
      </div>
        : <button className="link" onClick={() => setOwn(true)}>Or ask in your own words</button>}
      {other ? <>
        <input ref={input} className="input name" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="What shall I call you?" aria-label="What shall I call you?" />
        <div className="chips center">{['Sir', "Ma'am", ...(named ? [named] : [])].map((q) => <button key={q} className={`chip ${address === q ? 'on' : ''}`} onClick={() => setAddress(q)}>{q}</button>)}</div>
      </> : <button className="link" onClick={() => setOther(true)}>Call me something else</button>}
    </div>
  );
}

/** Shared from another app on the phone (the Share sheet): Chief asks what to do with it, as chips. */
function Share({ refresh }: Ctx) {
  const q = new URLSearchParams(location.search);
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n').trim();
  const [other, setOther] = useState(false);
  const home = () => { history.replaceState(null, '', '/#/chief'); dispatchEvent(new HashChangeEvent('hashchange')); };
  const send = async (what: string) => { if (await attempt(() => api.post('chief', `${what}\n\nWhat I shared:\n${text}`), undefined, true)) { refresh(); home(); } return true; };
  if (!text) return <div className="page"><div className="card empty">Nothing came through. Try sharing it again.</div></div>;
  return (
    <div className="page share">
      <div className="card shared"><div className="mute small">Shared with Crewhouse</div><div className="clamp">{text}</div></div>
      <div className="line chief"><div className="bubble-text">Got it. What shall the crew do with this?</div></div>
      <div className="chips">
        <button className="chip on" onClick={() => send('Add this to my calendar and remind me the day before')}>📅 Add to my calendar + remind me</button>
        <button className="chip" onClick={() => send('Just remember this for me')}>Just remember it</button>
        <button className="chip" onClick={() => setOther(true)}>Something else…</button>
      </div>
      {other && <div className="dock"><Composer placeholder="What shall the crew do with it?" onSend={send} /></div>}
    </div>
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
      <span>{h.name} has been quiet for {h.stuckFor} minute{h.stuckFor === 1 ? '' : 's'}. Shall I stop, or would you like to take over?</span>
      <div className="btns">
        <button className="btn" onClick={() => attempt(async () => { await api.reset(h.id); refresh(); }, `Stopped ${h.name}`)}>Stop</button>
        {h.computer && <button className="btn" onClick={() => attempt(async () => { await api.takeOver(h.id); refresh(); go(`#/h/${h.id}/screen`); })}>Take over</button>}
        <button className="btn ghost" onClick={() => { leftAlone.set(h.id, h.quietSince); redraw((n) => n + 1); }}>Leave it</button>
      </div>
    </div>
  );
}

/** The phone's chats, with Chief and the crew pinned before the recent helpers. */
function Chats({ state, refresh, desk }: { state: Json; refresh: () => void; desk?: boolean }) {
  const crew = A.crew(state);
  return <section className={`home-section${desk ? '' : ' phone-only'}`} aria-label="Chats">
    <div className="label">Chats</div><div className="list-group chats">
      {A.chats(state).map((c) => {
        const h = c.who === 'chief' ? undefined : c.who;
        return <div key={c.id}>
          <a className="list-row" href={hrefOf(c.id)}>
            {c.id === 'room' ? <span className="stack-faces">{crew.slice(0, 2).map((x) => <Face key={x.id} who={x} size={26} />)}</span> : <Face who={c.who} size={40} ring={c.ring} />}
            <span className="grow"><b className="clamp1">{c.name}</b><span className="small clamp1">{c.line}</span></span>
            <span className="chat-end"><time>{c.at ? A.clock(c.at) : ''}</time>{c.unread > 0 && <span className="badge" aria-label={`${c.unread} new`}>{A.unreadBadge(c.unread)}</span>}</span>
          </a>{h && <Stuck h={h} refresh={refresh} />}
        </div>;
      })}
    </div>
  </section>;
}

/** The owner's row until the house is fully set up: how many of the three jobs are left. */
function SetupRow({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  const { left } = A.homeSetup(state, A.account(accounts), link);
  if (!left) return null;
  return <a className="card nudge" href="#/settings"><span className="grow">Getting set up: {left} {left === 1 ? 'thing' : 'things'} left</span><b>›</b></a>;
}

/** Needs-you rows only open the review sheet; nothing commits from Home. */
function NeedsRows({ state, cards, quiet, all = false }: { state: Json; cards: A.Card[]; quiet?: boolean; all?: boolean }) {
  const crew = A.crew(state);
  const shown = all ? cards : cards.slice(0, 3);
  return (
    <>
      {shown.map((c) => (
        <a key={c.id} className="needs-row list-row" href={`#/ask/${c.id}`}>
          <Face who={crew.find((h) => h.id === c.helper) ?? { kind: 'pip', name: c.helper }} size={36} />
          <span className="grow"><b className="clamp1">{c.head}</b><span className="small clamp1">{c.words}</span></span>
          <span className="chat-end"><time>{A.briefTime(c.at)}</time><i className="need-dot" /></span>
        </a>
      ))}
      {quiet && !cards.length && <div className="mute small needs-quiet">Nothing else needs you.</div>}
    </>
  );
}

/** Home's top bar, the same in Chat and Office: Chief's one line, the three counts (one state source, `A.office`: a
 *  helper waiting on you counts once, under need you), the tray, and the Chat | Office switch. */
function HomeBar({ ctx, mode, pick }: { ctx: Ctx; mode: HomeMode; pick: (m: HomeMode) => void }) {
  const c = A.chief(ctx.state, chiefLocal(ctx));
  const n = ctx.live.counts;
  return (
    <header className="home-bar">
      <a className="home-chief" href="#/chief" aria-label={`Chief: ${c.line}`}><Face who="chief" size={32} /><span className="grow"><b>Chief</b><span className="mute small clamp1">{c.line}</span></span></a>
      <div className="stats" aria-label={`${n.needs} ${n.needs === 1 ? 'thing needs' : 'things need'} you · ${n.working} ${n.working === 1 ? 'helper' : 'helpers'} working · ${n.done} done today`}>
        <span className={`stat${n.needs ? ' hot' : ''}`}><b>{n.needs}</b>{n.needs === 1 ? 'needs you' : 'need you'}</span>
        <a className="stat" href="#/crew"><b>{n.working}</b>working</a>
        <a className="stat" href="#/things"><b>{n.done}</b>done today</a>
      </div>
      <div className="seg home-mode" role="tablist" aria-label="Home view">{HOME_MODES.map(([m, l]) => <button key={m} role="tab" aria-selected={mode === m} data-mode={m} className={mode === m ? 'on' : ''} onClick={() => pick(m)}>{l}</button>)}</div>
    </header>
  );
}

/** Needs you, pinned in both views: its first row, and every row behind an exact "See all N". */
function NeedsPin({ state, cards }: { state: Json; cards: A.Card[] }) {
  const [all, setAll] = useState(false);
  if (!cards.length) return null;
  return (
    <section className="home-section needs-pin" aria-label="Needs you">
      <div className="section-head"><span className="label">Needs you<span className="count">{cards.length}</span></span>{cards.length > 1 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${cards.length}`}</button>}</div>
      <div className="list-group needs-card"><NeedsRows state={state} cards={all ? cards : cards.slice(0, 1)} all /></div>
    </section>
  );
}

/** The desk frame shows from 900 px (styles.css); only the frame on screen holds the office, so it draws once. */
function useWide() {
  const q = useMemo(() => matchMedia('(min-width: 900px)'), []);
  const [wide, setWide] = useState(q.matches);
  useEffect(() => { const f = () => setWide(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, [q]);
  return wide;
}

/** An empty list, said warmly: a small mark and a plain line, never a blank box. */
const Empty = ({ children }: { children: ReactNode }) => <div className="frame-empty"><span className="art orn" aria-hidden>{art.ORNAMENT}</span>{children}</div>;

/** Home opens on Chat every time the app starts (kept in memory only, never stored): Chief's thread under the bar and
 *  the pinned Needs you. Office is the optional view of the same state; neither view hides Needs you or Chief's box. */
type HomeMode = 'chat' | 'office';
const HOME_MODES: [HomeMode, string][] = [['chat', 'Chat'], ['office', 'Office']];
let homeMode: HomeMode = 'chat';

function Home(ctx: Ctx) {
  const { state, live, refresh, tick, accounts } = ctx;
  const [mode, setMode] = useState(homeMode);
  const pick = (m: HomeMode) => { homeMode = m; setMode(m); };
  const g = A.account(accounts);
  const toChief = async (t: string) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) { refresh(); go('#/chief'); } return ok; };
  const wide = useWide();
  const office = (frame: 'phone' | 'desk') => (frame === 'desk') === wide && <Office state={state} live={live} night={ctx.night} />;
  const working = live.crew.filter((c) => A.seatOf(c) === 'working'), waiting = live.crew.filter(A.waitsOnYou).length;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const todays = A.things(state).filter((t) => t.at >= day.getTime());
  const top = <>
    <HomeBar ctx={ctx} mode={mode} pick={pick} />
    {/* Chief's thread shows its own sign-in card and resting line; Office shows them here. */}
    {mode === 'office' && (g.state === 'signed-out' || g.notIncluded) && <AccountCard g={g} onReady={refresh} />}
    <SetupRow state={state} accounts={accounts} tick={tick} />
    {mode === 'office' && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. I'll pick things back up then.</span></div>}
    {A.gettingReady(state) && <div className="card nudge"><span className="grow">{A.gettingReady(state)}</span></div>}
    {A.update(state) && <div className="card nudge"><span className="grow">{A.update(state)!.words}</span><a className="btn go" href={A.update(state)!.url} target="_blank" rel="noreferrer">Download</a></div>}
    <NeedsPin state={state} cards={live.needs} />
  </>;
  // Chat: Chief's own thread, its box and (on a wide desk) its side column of who is on what.
  if (mode === 'chat') return <div className="page chat-page home-chat"><div className="home-top">{top}</div><Chat {...ctx} id="chief" /></div>;
  return (
    <div className="home home-office">
      <div className="home-top">{top}</div>
      <div className="phone-only home-room">{office('phone')}</div>
      <Chats state={state} refresh={refresh} /><JobList state={state} phone refresh={refresh} />
      <div className="home-desk desk-only">
        <div className="room-col">{office('desk')}</div>
        <aside className="feed" aria-label="What's going on">
          <section className="home-section working" aria-label="On it now"><div className="section-head"><span className="label">On it now</span>{working.length > 0 && <span className="small mute">{working.length} working</span>}</div><div className="list-group">
            {working.length ? working.map((c) => <a key={c.id} className="list-row" href={hrefOf(c.id)}>
              <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={36} ring="working" /><span className="grow"><b className="clamp1">{c.name}</b><span className="small clamp1">{c.step || c.status}</span></span>
            </a>) : <Empty>{waiting ? `Nothing moves until you answer: ${waiting} waiting on you.` : 'Nothing right now. The crew is free.'}</Empty>}
          </div></section>
          {todays.length > 0 && <section className="home-section done" aria-label="Done today"><div className="label">Done today</div><div className="list-group">
            {todays.map((t) => { const target = A.fileTarget(t.files[0]); return <div key={t.id} className="list-row"><span className="file-chip">{target?.chip ?? '—'}</span><span className="grow"><b className="clamp1">{t.title}</b><span className="small clamp1">{t.summary}</span></span><a className="btn sm" href={target?.href ?? hrefOf(t.helper)}>Open</a></div>; })}
          </div></section>}
          <Chats state={state} refresh={refresh} desk />
          <JobList state={state} few refresh={refresh} />
          <div className="feed-ask"><Composer placeholder="Ask Chief anything" onSend={toChief} {...typeInto('chief')} /></div>
        </aside>
      </div>
      <div className="dock phone-only"><Composer placeholder="Ask Chief anything" onSend={toChief} {...typeInto('chief')} /></div>
    </div>
  );
}

/** The standing "hand me a job" list (docs/ui-contract.md, `ideas[]`): what the crew offers to do end to end, money back
 *  first. A row fills Chief's box with the words and never sends; a job still waiting on an app says what it needs and
 *  leads to the apps screen instead of dead-ending. A row offering a helper not hired yet brings them on first, then
 *  fills that helper's box. The same rows sit in the desk's third frame and under the chats on a phone. */
function JobList({ state, phone, few, refresh }: { state: Json; phone?: boolean; few?: boolean; refresh: () => void }) {
  const crew = A.crew(state);
  const rows = A.jobs(state);
  const [all, setAll] = useState(false);
  const shown = phone || (few && !all) ? rows.slice(0, 3) : rows;
  const hand = (ask: string) => { keepDraft('chief', ask); go('#/chief'); };
  // The gallery hire, then the words in the new helper's own box: nothing starts until they send.
  const hire = async (template: string, ask: string) => {
    const name = state.templates.find((t: Json) => t.id === template)?.display ?? template;
    let id = '';
    if (await attempt(async () => { id = (await api.recruit(template, name)).id; }, `${name} joined the crew`)) { refresh(); keepDraft(id, ask); go(`#/h/${id}`); }
  };
  return (
    <section className={`home-section jobs${phone ? ' phone-only' : ''}`} aria-label="Hand the crew a job">
      <div className="section-head"><span className="label">Hand the crew a job</span>{few && rows.length > 3 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${rows.length}`}</button>}</div><div className="list-group">
      {shown.length ? shown.map((j) => {
        const h = crew.find((x) => x.id === j.bot);
        const body = <><Face who={h ?? { kind: 'pip', name: j.bot }} size={phone ? 28 : 36} />
          <span className="grow"><b className="clamp">{j.label}</b>{j.says && <span className="small mute clamp1">{j.says}</span>}{j.needs.length > 0 && <span className="small clamp1">{A.jobNeeds(j.needs)}</span>}</span><span className="mute" aria-hidden>›</span></>;
        return j.needs.length ? <a key={j.bot + j.label} className="list-row" href="#/apps">{body}</a>
          : j.hire ? <button key={j.bot + j.label} className="list-row" onClick={() => hire(j.hire!, j.ask)}>{body}</button>
          : <button key={j.bot + j.label} className="list-row" onClick={() => hand(j.ask)}>{body}</button>;
      }) : <div className="frame-empty">Nothing to hand over yet. Hire a helper, and this fills up.</div>}
      </div>
    </section>
  );
}

/** The starters live in Chief's empty chat: a tap fills the box with the words, it never sends. */
function ChiefIdeas({ state, chat, picked }: { state: Json; chat: string; picked: () => void }) {
  return <><p className="ideas-intro">I can bring in Scout for research, Scribe for writing or Reel for videos.</p><div className="chips center">{A.ideas(state).map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft(chat, i.ask); picked(); }}>✦ {i.label}</button>
  ))}</div></>;
}

/** A helper's starters in its own fresh chat: its own ready rows only, never another helper's. A tap fills the box, it never sends. */
function HelperIdeas({ state, chat, picked }: { state: Json; chat: string; picked: () => void }) {
  const rows = A.ideas(state).filter((i: Json) => i.bot === chat);
  if (!rows.length) return null;
  return <div className="chips center">{rows.map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft(chat, i.ask); picked(); }}>✦ {i.label}</button>
  ))}</div>;
}

/** Chief's hand-off in a helper's chat: the collapsed ask, with the full assignment words behind Show details. */
function ChiefAsk({ l }: { l: { text: string; detail: string } }) {
  const [open, setOpen] = useState(false);
  return <div className="bubble-text"><ChatText text={l.text} /> <button className="link inline" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Show details'}</button>
    {open && <ChatText text={l.detail} />}</div>;
}

// ---------- a chat ----------
function PairQR({ text }: { text: string }) {
  const rows = useMemo(() => qrMatrix(text, { border: 1 }), [text]);
  return <svg viewBox={`0 0 ${rows.length} ${rows.length}`} role="img" aria-label="Scan to pair a phone" shapeRendering="crispEdges">
    <rect width="100%" height="100%" fill="white" />
    <path fill="black" d={rows.flatMap((row, y) => row.map((dark, x) => dark ? `M${x} ${y}h1v1h-1z` : '')).join('')} />
  </svg>;
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
        {left > 0 ? <><p className="small">Type this code: <b style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{current.typed}</b> <button className="btn ghost" onClick={() => void navigator.clipboard.writeText(current.typed)}>Copy</button></p><p className="mute small">Works once · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left</p></> : <button className="btn go" onClick={() => { active.current = Date.now(); void renew(); }}>Show a new code</button>}
      </div></>}
  </div>;
}
function Chat({ id, m, state, tick, refresh, accounts }: Ctx & { id: string; m?: string }) {
  const g = A.account(accounts);
  const [page, setPage] = useState<Json>(null);
  const [pending, setPending] = useState<{ text: string; after: number } | null>(null);
  const [partial, setPartial] = useState('');
  const [seed, setSeed] = useState(0); // a starter chip fills the box from outside; remount reads the draft back
  // A search landing on an old line loads a window around it; once you send, the anchor goes and the thread reads to the end.
  const [around, setAround] = useState(m ? Number(m.slice(1)) : 0);
  const load = useCallback((ar = around) => api.bot(id, ar || undefined).then(setPage).catch(() => {}), [id, around]);
  useEffect(() => { void load(); }, [load, tick]);
  const end = useRef<HTMLDivElement>(null);
  const lines = A.lines(page, id);
  const echoed = pending && !(page?.messages ?? []).some((x: Json) => x.author === 'person' && x.id > pending.after && A.plain(x.text) === A.plain(pending.text));
  const waiting = pending && !partial && !(page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.id > pending.after);
  useEffect(() => subscribe((e) => {
    if (e.bot !== id) return;
    if (e.kind === 'reply.partial') setPartial(/\bstub [\w-]+:/.test(e.data.text) ? '' : e.data.text);
    if (e.kind === 'message' && e.data?.author === 'bot') setPartial('');
  }), [id]);
  useEffect(() => { if ((page?.messages ?? []).some((x: Json) => x.author === 'bot' && x.text === partial)) setPartial(''); }, [page, partial]);
  const phoneOffer = id === 'chief' ? A.phoneOffer(page) : null;
  const box = useRef<HTMLDivElement>(null);
  // The thread scrolls by its own column on a desk (a scrollIntoView here once dragged the whole page up with it,
  // leaving a dead band on top); the phone keeps the document scroll. An anchored landing scrolls to the line instead.
  useEffect(() => {
    if (around) return;
    if (matchMedia('(min-width: 900px)').matches) { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }
    else end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, around, !!echoed, !!waiting, partial]);
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
  const cards = A.cards(state).filter((c) => c.helper === id);
  const last = lines.at(-1);
  const send = async (t: string) => {
    setPending({ text: t, after: page?.messages?.at(-1)?.id ?? 0 });
    setPartial('');
    const ok = await attempt(() => api.post(id, t), undefined, true);
    if (ok) { setAround(0); void load(0); refresh(); } else setPending(null);
    return ok;
  };
  const name = h?.name ?? 'Chief';
  // A fresh chat shows starters: nothing yet, or only the hidden "X joined the crew" note from recruiting.
  const fresh = !lines.length || (lines.length === 1 && lines[0].from === 'note' && lines[0].text.startsWith(`${name} joined the crew`));
  // Lines that arrive while you watch rise in; the thread you open with is simply there.
  const opened = useRef<number | null>(null);
  if (opened.current === null && page) opened.current = page.messages?.at(-1)?.id ?? 0;
  // The top of the thread (crewd sends the newest 200): who this is, before the first line.
  const start = !!page && !around && (page.messages?.length ?? 0) < 200;
  let day = '';
  const dayOf = (t?: number) => { if (!t) return null; const d = A.dayLabel(t); if (d === day) return null; day = d; return <div className="day" role="separator"><span>{d}</span></div>; };
  return (
    <div className={`chat${live && h ? ' with-live' : ''}`}>
      <div className="lines" ref={box}>
        {start && <div className="chat-intro">
          <span className="halo">{h ? <PalArt kind={h.kind} mood={h.mood} d={4.4} name={h.name} /> : <ChiefArt mood="idle" d={3.6} />}</span>
          <b>{name}</b><span>{h ? h.role : 'Runs the crew and answers to you'}</span>
        </div>}
        {!page && <div className="skeleton" aria-busy="true" aria-label="Opening the chat"><i /><i /><i /></div>}
        {fresh && page && (id === 'chief'
          ? <ChiefIdeas state={state} chat={id} picked={() => setSeed((n) => n + 1)} />
          : <HelperIdeas state={state} chat={id} picked={() => setSeed((n) => n + 1)} />)}
        {lines.map((l, i) => start && i === 0 && l.from === 'note' && l.text.startsWith(`${name} joined the crew`) ? null : <div key={l.id} className="line-wrap">{dayOf(l.at)}
          <div id={`m${l.id}`} className={`line ${l.from}${l.unsure ? ' unsure' : ''}${l.recap ? ' recap' : ''}${l.id > (opened.current ?? Infinity) ? ' fresh' : ''}${i && lines[i - 1].from === l.from && l.from !== 'me' && !l.recap && !lines[i - 1].recap ? ' consecutive' : ''}`}>
            {l.from !== 'me' && l.from !== 'note' && <div className="line-by"><Face who={l.from === 'chief' ? 'chief' : h ?? 'chief'} size={28} /><span className="who">{l.from === 'chief' ? 'Chief' : name}</span><time>{l.at ? A.clock(l.at) : ''}</time></div>}
            {l.text && (l.detail ? <ChiefAsk l={{ text: l.text, detail: l.detail }} /> : <div className="bubble-text"><ChatText text={l.text} /></div>)}
            {id === 'chief' && l.text === 'Sign in with ChatGPT.' && <AccountCard g={{ ...g, state: 'signed-out' }} inChat onReady={() => { void load(); refresh(); }} />}
            {l.files.map((f) => <Media key={f.url} f={f} big />)}
            {phoneOffer?.message === l.id && <PhoneCard offer={phoneOffer} reload={() => void load()} />}
            {cards.filter((c) => lines.findLastIndex((x) => (x.at ?? 0) <= c.at) === i).map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={h?.name} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} who={h} onDone={refresh} />)}
          </div></div>
        )}
        {echoed && <div className="line me fresh"><div className="bubble-text">{pending.text}</div></div>}
        {waiting && id === 'chief' && <div className="line them fresh" role="status"><div className="line-by"><Face who="chief" size={28} /><span className="who">Chief</span></div><div className="bubble-text"><span className="typing" aria-hidden><i /><i /><i /></span><span className="sr">Chief is on it</span></div></div>}
        {!!partial && <div className="line them streaming" aria-live="polite"><div className="line-by"><Face who={h ?? 'chief'} size={28} /><span className="who">{name}</span></div><div className="bubble-text"><ChatText text={partial} /></div></div>}
        {A.building(lines, live) && <div className="line them" role="status"><div className="line-by"><Face who={h ?? 'chief'} size={28} /><span className="who">{name}</span></div><div className="building-card" aria-label="Building it"><i aria-hidden /><i aria-hidden /><div className="bubble-text">Building it. I’ll share it here.</div></div></div>}
        {last?.choices.length ? <div className="chips">{last.choices.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div> : null}
        {cards.filter((c) => !lines.length || lines.every((x) => (x.at ?? 0) > c.at)).map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={h?.name} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} who={h} onDone={refresh} />)}
        {h && <Stuck h={h} refresh={refresh} />}
        {(g.state === 'signed-out' || g.notIncluded) && <AccountCard g={g} inChat onReady={() => { void load(); refresh(); }} />}
        {g.state === 'ready' && !g.notIncluded && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. {name === 'Chief' ? "I'll" : `${name} will`} finish then.</span></div>}
        <div ref={end} className="end" />
      </div>
      <aside className="working-on">
        {live && h && <section className="working-on-frame"><div className="label">Working on</div><div className="list-group"><div className="work-title"><b>{A.plain(live.title)}</b><span className="small">{h.status}</span></div>{trail.length > 0 && <Steps steps={trail} max={3} />}<a className="link" href={`#/h/${id}/did`}>What happened ›</a></div></section>}
        {A.things(state).filter((x) => x.helper === id).length > 0 && <section className="home-section"><div className="label">Made in this chat</div><div className="list-group">{A.things(state).filter((x) => x.helper === id).map((x) => { const t = A.fileTarget(x.files[0]); return <a className="list-row" key={x.id} href={t?.href.startsWith('#') ? t.href : `#/things/t${x.id}`}><span className="file-chip">{t?.chip ?? '—'}</span><span className="grow"><b className="clamp1">{x.title}</b><span className="small clamp1">{x.summary}</span></span></a>; })}</div></section>}
      </aside>
      <div className="dock"><Composer key={seed} placeholder={id === 'chief' ? 'Ask Chief anything…' : `Message ${name}…`} onSend={send} {...typeInto(id)} /></div>
    </div>
  );
}

function Room(ctx: Ctx) {
  const { state, tick, refresh } = ctx;
  const [page, setPage] = useState<Json>(null);
  const [to, setTo] = useState('');
  const load = useCallback(() => api.room().then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const lines = A.room(page, state);
  const helpers = A.crew(state);
  const latest = [...lines].reverse().find((l) => l.who && l.who.id !== 'chief' && l.author !== 'person');
  const target = to || latest?.who?.id || helpers[0]?.id || 'chief';
  const cards = A.cards(state).filter((c) => (page?.asks ?? []).some((a: Json) => a.id === c.id));
  const send = async (text: string) => { const ok = await attempt(() => api.post(target, text, { room: true }), undefined, true); if (ok) { await load(); refresh(); } return ok; };
  return <div className="page chat-page"><header className="chat-head sticky-top"><a href="#/" className="back">‹</a><span className="row">{helpers.slice(0, 3).map((h) => <Face key={h.id} who={h} size={30} ring={h.ring} />)}</span><div className="grow"><b>The crew</b><div className="mute small">Work handed between helpers</div></div></header>
    <div className="chat"><div className="lines">{lines.length ? lines.map((l: ReturnType<typeof A.room>[number]) => <div className={`line ${l.author === 'person' ? 'me' : 'them'}`} key={l.id}>
      {l.who && <div className="row"><Face who={l.who} size={30} ring={l.who.ring} /><b>{l.from && l.to ? `${l.from} → ${l.to}` : l.author === 'person' ? 'You → ' + l.who.name : l.who.name}</b></div>}
      {l.text && <div className="bubble-text"><ChatText text={l.text} /></div>}{l.files.map((f: ReturnType<typeof A.room>[number]['files'][number]) => <Media key={f.url} f={f} big />)}
    </div>) : <div className="mute center empty">Start a job here and follow along as the crew works together.</div>}
      {cards.map((c) => <AskCard key={c.id} c={c} who={helpers.find((h) => h.id === c.helper)} onDone={() => { void load(); refresh(); }} />)}</div>
      <aside className="working-on">{(page?.busy ?? []).length > 0 && <section className="frame working-on-frame"><div className="label ascii">Working on</div>{(page.busy as string[]).map((id) => { const h = helpers.find((x) => x.id === id); return h && <div className="frame-row head" key={id}><Face who={h} size={32} ring={h.ring} /><b>{h.name}</b></div>; })}</section>}</aside>
      <div className="dock"><label className="small" htmlFor="room-to">Message </label><select id="room-to" className="input" value={target} onChange={(e) => setTo(e.target.value)}><option value="chief">Chief</option>{helpers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select><Composer placeholder={`Message ${target === 'chief' ? 'Chief' : helpers.find((h) => h.id === target)?.name ?? 'the crew'}…`} onSend={send} {...typeInto('room')} /></div>
    </div></div>;
}

function ChiefPage(ctx: Ctx & { m?: string }) {
  const { mood, line } = A.chief(ctx.state, chiefLocal(ctx, useListen()));
  return (
    <div className="page chat-page">
      <header className="chat-head sticky-top"><a href="#/" className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a><Face who="chief" size={32} />
        <div className="grow"><b>Chief</b><div className="mute small clamp1">{line}</div></div>
        <button className="link" onClick={() => go('#/h/chief/did')}>What happened</button></header>
      <Chat {...ctx} id="chief" m={ctx.m} />
    </div>
  );
}

// ---------- the crew ----------
function Crew(ctx: Ctx) {
  const { state } = ctx;
  const chief = A.chief(state, chiefLocal(ctx));
  const helpers = A.crew(state);
  return <div className="page rest-screen"><h1>Your crew</h1><p className="lead">Everyone answers to Chief.</p><div className="card list">
    <a className="row-item crew-row" href="#/chief"><Face who="chief" size={44} ring={chief.tone === 'wait' ? 'needs' : undefined} /><span className="grow"><b>Chief</b><span className="mute small clamp1">Runs the crew and answers to you</span></span><span className="status-word">{chief.line}</span></a>
    {helpers.map((h) => <a key={h.id} className="row-item crew-row" href={hrefOf(h.id)}><Face who={h} size={44} ring={h.ring} /><span className="grow"><b>{h.name}</b><span className="mute small clamp1">{h.role}</span></span><span className={`status-word ${h.ring === 'needs' ? 'bad' : ''}`}><i className={h.ring === 'needs' ? 'needs' : h.ring ? 'working' : ''} />{h.status}</span></a>)}
    <a className="row-item crew-row" href="#/crew/add"><span className="face add" style={{ width: 44, height: 44 }}>+</span><span className="grow">Add a helper</span><span className="mute">›</span></a>
  </div></div>;}

function AddHelper({ state, refresh }: Ctx) {
  const [names, setNames] = useState<Record<string, string>>({});
  const welcome = async (t: Json) => {
    const name = (names[t.id] ?? t.name).trim() || t.name;
    let id = '';
    if (await attempt(async () => { id = (await api.recruit(t.id, name)).id; }, `${name} joined the crew`)) { refresh(); go(`#/h/${id}`); }
  };
  return (
    <div className="page rest-screen">
      <a href="#/crew" className="back">‹ Crew</a><h1>Add a helper</h1><p className="lead">Pick a starter, or tell Chief what you need.</p>
      <div className="label">Starters</div><div className="card list">
        {A.gallery(state).map((t: Json) => <div key={t.id} className="row-item starter-row"><Face who={{ kind: t.kind, name: t.name }} size={44} /><span className="grow"><input className="starter-name" value={names[t.id] ?? t.name} onChange={(e) => setNames({ ...names, [t.id]: e.target.value })} aria-label={`Name for ${t.name}`} /><span className="mute small clamp">{t.does}</span></span><button className="btn" onClick={() => welcome(t)}>Add</button></div>)}
      </div>
      <div className="label">Something else</div><div className="card"><p className="mute small">Tell Chief what you need help with.</p><Composer placeholder="Tell Chief what you need help with" onSend={async (t) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) go('#/chief'); return ok; }} {...typeInto('chief')} /></div>
    </div>
  );
}

function HelperPage(ctx: Ctx & { id: string; tab: string }) {
  const { id, tab, state, tick, refresh, offline } = ctx;
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  // Chief has no helper card, but his Every-step trail (with Undo for what he learned) is the same view: admit him for it.
  if (!h && id !== 'chief') return <div className="page mute">{state.bots.some((b: Json) => b.id === id) ? '' : 'This helper has left the crew.'}</div>;
  const b = state.bots.find((x: Json) => x.id === id);
  const name = h?.name ?? 'Chief';
  // The chat is the page; everything else lives behind Details. Old deep links to a section land on Details too.
  const details = tab !== 'chat' && tab !== 'did' && tab !== 'screen';
  const trail = page ? A.steps(page.trail ?? [], b?.task?.id, true) : [];
  return (
    <div className={`page helper ${tab === 'chat' ? 'chat-page' : ''}`}>
      {tab === 'chat' && h && <>
        <div className="sticky-top">
          <header className="chat-head">
            <a href="#/" className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
            <Face who={h} size={32} ring={h.ring} />
            <div className="grow"><b>{h.name}</b><div className="mute small clamp1">{h.status}</div></div>
            {b?.task && <button className="btn" onClick={() => confirm(`Stop ${h.name}'s job?`) && attempt(async () => { await api.reset(id); refresh(); }, `Stopped ${h.name}`)}>Stop</button>}
            <button className="link" onClick={() => go(`#/h/${id}/details`)}>Details</button>
          </header>
        </div>
        <Chat key={id} {...ctx} id={id} />
      </>}
      {details && h && <>
        <div className="sticky-top">
          <header className="chat-head">
            <a href={`#/h/${id}/chat`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
            <Face who={h} size={40} ring={h.ring} />
            <div className="grow"><b>{h.name}</b><div className="mute small clamp1">{h.status}</div></div>
            <button className="link" onClick={() => go(`#/h/${id}/chat`)}>Chat</button>
          </header>
        </div>
        <section className="detail rest-screen">
          <div className="helper-intro"><Face who={h} size={64} ring={h.ring} /><div><h1>{h.name}</h1><p className="lead">{h.role}</p></div></div>
          <h2 className="plate">Now</h2>
          {b?.task ? (trail.length ? <Steps steps={trail} max={7} /> : <p className="mute">Working on “{A.plain(b.task.title)}”. Steps show as they happen.</p>)
            : <p className="mute">Nothing right now.</p>}
          <a className="link" href={`#/h/${id}/did`}>What happened</a>
          <h2 className="plate">Things</h2>
          <ThingsGrid list={A.things(state).filter((t) => t.helper === id)} state={state} empty={`${h.name}'s finished work shows up here.`} />
          <h2 className="plate">Routines</h2>
          <RoutineList {...ctx} bot={id} />
          <h2 className="plate">{h.name}'s job</h2>
          {page && <JobSection id={id} name={h.name} page={page} reload={load} />}
          <h2 className="plate">About {h.name}</h2>
          {page && <AboutMe id={id} name={h.name} page={page} reload={load} />}
          <h2 className="plate">What {h.name} remembers</h2>
          {page && <Remembers id={id} name={h.name} page={page} reload={load} />}
          {A.signedIn(page).length > 0 && <>
            <h2 className="plate">Signed in to</h2>
            <div className="card list">
              {A.signedIn(page).map((h) => <div key={h} className="row-item"><span className="grow">{h}</span>
                <button className="link" onClick={() => attempt(async () => { await api.forget(id, h); load(); }, 'Forgotten')}>Forget</button></div>)}
            </div>
          </>}
          {h.computer && <>
            <h2 className="plate">See {h.name}'s screen</h2>
            <Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} />
          </>}
        </section>
      </>}
      {tab === 'did' && (page ? <>
        <div className="sticky-top"><header className="chat-head">
          <a href={id === 'chief' ? '#/chief' : `#/h/${id}/details`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
          <div className="grow"><b>What happened</b></div>
        </header></div>
        <p className="lead">What {name} does, as it happens. Recorded by Crewhouse, not remembered by {name}.</p>
        {A.steps(page.trail ?? []).length ? <Steps steps={A.steps(page.trail ?? [])} max={40} onUndo={(s) => attempt(async () => { await api.undoMemory(id, s.seq); void load(); }, 'Forgotten')} />
          : <div className="card empty">Nothing yet. Give {name} something to do.</div>}
      </> : null)}
      {tab === 'screen' && h && <Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} />}
    </div>
  );
}

/** A list of remembered lines with Forget, and a line to add one: a helper's notes on you, or what the whole crew knows about you. */
function MemoryList({ notes, save, empty, placeholder }: { notes: string; save: (text: string) => Promise<unknown>; empty: string; placeholder: string }) {
  const [adding, setAdding] = useState('');
  const list = A.memories(notes);
  const add = () => adding.trim() && attempt(async () => { await save(A.withMemory(notes, adding)); setAdding(''); }, 'Remembered');
  return (
    <>
      {list.length ? <div className="card list">{list.map((m, i) => <div key={i} className="row-item"><span className="grow">{m}</span>
        <button className="link" onClick={() => attempt(() => save(A.withoutMemory(notes, i)), 'Forgotten')}>Forget</button></div>)}</div>
        : <div className="card empty">{empty}</div>}
      <div className="row add-row"><input className="input grow" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={placeholder} aria-label="Something to remember" />
        <button className="btn" disabled={!adding.trim()} onClick={add}>Add</button></div>
    </>
  );
}

function Remembers({ id, name, page, reload }: { id: string; name: string; page: Json; reload: () => void }) {
  return (
    <>
      <p className="lead">What {name} has learned about how you like its work. It reads this every time it starts a job for you.</p>
      <label className="card toggle"><span className="grow"><b>Remember things</b><div className="mute small">{page.memory === false ? `${name} starts fresh every time.` : `${name} keeps notes on what you like.`}</div></span>
        <input type="checkbox" role="switch" checked={page.memory !== false} onChange={(e) => attempt(async () => { await api.settings(id, { memory: e.target.checked }); reload(); })} /></label>
      <label className="card toggle"><span className="grow"><b>Check with me before {name} hands work on</b></span>
        <input type="checkbox" role="switch" checked={page.handoff === 'ask'} onChange={(e) => attempt(async () => { await api.settings(id, { handoff: e.target.checked ? 'ask' : 'go' }); reload(); })} /></label>
      <MemoryList notes={page.notes ?? ''} save={async (t) => { await api.notes(id, t); reload(); }}
        empty={`Nothing yet. ${name} adds a line when it learns something you like.`} placeholder={`Tell ${name} something to keep in mind`} />
      <LearnedRows name={name} />
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

/** The person's five-part job recipe. Chief may draft it, but only the person's yes changes it. */
function JobSection({ id, name, page, reload }: { id: string; name: string; page: Json; reload: () => void }) {
  const labels = ['What it does', "What it's aiming for", 'What it gets from others', 'How it goes about it', 'What great looks like, with an example'];
  const keys = ['does', 'aim', 'gets', 'how', 'great'];
  const view = A.jobParts(page.job);
  const [edit, setEdit] = useState(false), [idea, setIdea] = useState(''), [parts, setParts] = useState<Json>(page.job ?? {});
  const [writing, setWriting] = useState(false);
  return <>
    <div className="card">
      {view.map((part, i) => <p key={part.label}><b>{part.label}</b><br />{part.text || <span className="mute">Not set yet.</span>}</p>)}
      <div className="btns"><button className="btn" onClick={() => { setParts({ ...page.job }); setEdit(!edit); }}>Change</button><button className="btn ghost" onClick={() => setWriting(!writing)}>Write it for me</button></div>
    </div>
    {edit && <div className="card form">{labels.map((label, i) => <label key={label}><b>{label}</b><textarea className="input" rows={3} maxLength={600} value={parts[keys[i]] ?? ''} onChange={(e) => setParts({ ...parts, [keys[i]]: e.target.value })} /></label>)}
      <div className="btns"><button className="btn go" onClick={() => attempt(async () => { await api.job(id, parts); setEdit(false); reload(); }, 'Job saved')}>Save</button><button className="btn ghost" onClick={() => setEdit(false)}>Cancel</button></div>
    </div>}
    {writing && <div className="card form"><b>Tell me roughly what {name} should do</b><textarea className="input" rows={3} maxLength={600} value={idea} onChange={(e) => setIdea(e.target.value)} />
      <button className="btn go" disabled={!idea.trim()} onClick={() => attempt(async () => { await api.draftJob(id, idea); setWriting(false); setIdea(''); reload(); }, 'Asked Chief to write it')}>Ask Chief</button></div>}
  </>;
}

/** Who a helper is, in plain words, and what it knows how to do. The person changes it; the helper never does. */
function AboutMe({ id, name, page, reload }: { id: string; name: string; page: Json; reload: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
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
      {knows.length ? <div className="card list">{knows.map((k) => <div key={k.name} className="row-item"><span className="grow">{k.says}{k.learned && <div className="mute small">Learned from you</div>}</span>
        {k.learned && <button className="link" onClick={() => confirm(`Should ${name} stop doing it this way?`) && attempt(async () => { await api.removeSkill(id, k.name); reload(); }, 'Put away')}>Remove</button>}</div>)}</div>
        : <div className="card empty">Plain jobs, the way you ask for them.</div>}
    </>
  );
}

/** What the whole crew knows about this person: every helper reads it before a job for them. */
function AboutYou({ tick }: { tick: number }) {
  const [notes, setNotes] = useState<string | null>(null);
  const load = useCallback(() => api.about().then((a) => setNotes(a.notes ?? '')).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  if (notes === null) return null;
  return (
    <>
      <div className="label">About you</div>
      <p className="mute small">What the whole crew knows about you. Every helper reads it before a job for you.</p>
      <MemoryList notes={notes} save={async (t) => { await api.setAbout(t); await load(); }}
        empty="Nothing yet. Tell Chief things like “I'm vegetarian” and the whole crew will know." placeholder="For example: I'm vegetarian" />
    </>
  );
}

// ---------- things ----------
function ThingsGrid({ list, state, empty }: { list: A.Thing[]; state: Json; empty: string }) {
  const crew = A.crew(state);
  if (!list.length) return <div className="card empty"><pre className="art small-art" aria-hidden>{'   ✦  ( •ᴗ• )  ✦'}</pre>{empty}</div>;
  return (
    <div className="grid things">
      {list.map((t) => {
        const h = A.crew(state).find((x) => x.id === t.helper);
        return (
          <div key={t.id} id={`t${t.id}`} className="card thing">
            {t.files[0] && <Media f={t.files[0]} />}
            <b>{t.title}</b>
            {t.summary && <p className="mute clamp">{t.summary}</p>}
            {t.files.slice(1).map((f) => <Media key={f.url} f={f} />)}
            <div className="by">{h && <Face who={h} size={26} />}<span className="mute small">{h?.name ?? 'The crew'} · {A.clock(t.at)}</span></div>
          </div>
        );
      })}
    </div>
  );
}
function Things({ state, id }: Ctx & { id?: string }) {
  const list = A.things(state);
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
  return <div className="page rest-screen"><h1>Things</h1><p className="lead">Everything the crew has made for you.</p>{(['Today', 'Yesterday', 'Earlier'] as const).map((group) => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const start = group === 'Today' ? now.getTime() : group === 'Yesterday' ? now.getTime() - 86400000 : 0;
    const end = group === 'Today' ? now.getTime() + 86400000 : now.getTime();
    const items = list.filter((t) => group === 'Earlier' ? t.at < now.getTime() - 86400000 : t.at >= start && t.at < end);
    return items.length ? <section key={group}><div className="label">{group}</div><div className="card list thing-list">{items.map((t) => { const h = A.crew(state).find((x) => x.id === t.helper); const f = t.files[0]; return <a key={t.id} id={`t${t.id}`} className="row-item file-row" href={f?.url ?? `#/h/${t.helper}`} target={f?.url ? '_blank' : undefined} rel={f?.url ? 'noreferrer' : undefined}>{f ? <Media f={f} /> : <span className="file-chip">FILE</span>}<span className="grow"><b className="clamp1">{t.title}</b><span className="mute small">{h?.name ?? 'The crew'} · {A.clock(t.at)}</span></span><span className="mute">›</span></a>; })}</div></section> : null;
  })}{!list.length && <div className="card empty">Videos, lists, letters and plans the crew makes for you land here.</div>}</div>;
}

// ---------- routines ----------
function RoutineList({ state, refresh, bot }: Ctx & { bot?: string }) {
  const crew = A.crew(state);
  const list = A.routines(state, bot);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <>
      {list.map((r: Json) => <RoutineRow key={r.id} r={r} h={crew.find((x) => x.id === r.helper)} act={act} />)}
      {!list.length && <div className="card empty">Nothing set up yet.</div>}
    </>
  );
}

/** One routine: its time line is tappable (the same field Chief's card uses), its last run can be seen. */
function RoutineRow({ r, h, act }: { r: Json; h: Helper | undefined; act: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const [when, setWhen] = useState<string | null>(null); // null: the time line; a string: editing it
  const [preview, setPreview] = useState<Json>(null);
  useEffect(() => {
    if (when === null || !when.trim()) { setPreview(null); return; }
    const t = setTimeout(() => api.schedule(when).then(setPreview).catch(() => setPreview({ bad: true })), 250);
    return () => clearTimeout(t);
  }, [when]);
  const save = async () => { if (await act(() => api.routine(r.id, { schedule: when!.trim() }), 'Time changed')) setWhen(null); };
  return (
    <div className={`card routine ${r.paused ? 'paused' : ''}`}>
      <div className="row">
        <Face who={h ?? 'chief'} size={40} />
        <div className="grow">
          <b>{r.name}</b>
          {when === null ? <button className="link line-when" onClick={() => setWhen(r.when || '')}>
            {[r.on, r.watching ? `Keeps an eye on ${r.watching}` : '', r.when].filter(Boolean).join(' · ')}{r.paused ? ' · paused' : r.next ? ` · next ${r.next}` : ''}{r.quiet && !r.watching ? " · stays quiet if there's nothing" : ''}
          </button> : <div className="mute small">Moving it — save a new time below, or cancel.</div>}
          {r.last && <div className="mute small">{r.last}{r.result && <> · <a className="link pink" href={r.result.thing ? `#/things/t${r.result.thing}` : `#/h/${r.helper}/chat/m${r.result.msg}`}>See result</a></>}</div>}
        </div>
      </div>
      {when !== null && <form className="row" onSubmit={(e) => { e.preventDefault(); if (when.trim() && preview && !preview.bad) void save(); }}>
        <input className="input grow" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When? For example: every Saturday 10am" aria-label="When" autoFocus />
        <button className="btn go" disabled={!when.trim() || !preview || preview.bad}>Save</button>
        <button className="btn ghost" type="button" onClick={() => setWhen(null)}>Cancel</button>
      </form>}
      {when !== null && preview && !preview.bad && <div className="mute small">{preview.words}. First time {preview.first}.</div>}
      {when !== null && preview?.bad && <div className="mute small">I didn't catch that time. Try “every Monday 9:00”.</div>}
      <div className="btns">
        <button className="btn" onClick={() => act(() => api.runRoutine(r.id), 'Asked to run')}>Do it now</button>
        <label className="routine-switch"><input type="checkbox" role="switch" checked={!r.paused} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${r.name}`} onChange={(e) => act(() => api.routine(r.id, { state: e.target.checked ? 'on' : 'paused' }))} /><span>{r.paused ? 'Paused' : 'On'}</span></label>        {!r.digest && !r.watching && <button className={`chip ${r.quiet ? 'on' : ''}`} aria-pressed={r.quiet} onClick={() => act(() => api.routine(r.id, { quiet: !r.quiet }), r.quiet ? 'It will always report back' : "It will only speak up when something's up")}>Only tell me if something's up</button>}
        {!r.digest && <button className="btn ghost" onClick={() => confirm(`Remove “${r.name}”?`) && act(() => api.removeRoutine(r.id))}>Remove</button>}
      </div>
    </div>
  );
}

/** Recurring work starts as a request: say it in your own words, Chief brings back a card to start — no setup form. */
function RoutineAsk() {
  const [text, setText] = useState('');
  const send = async () => { const t = text.trim(); if (!t) return; if (await attempt(() => api.post('chief', t), undefined, true)) { setText(''); go('#/chief'); } };
  return (
    <div className="card ask routine-ask">
      <div className="ask-head">
        <Face who="chief" size={36} />
        <div><b>Tell Chief what should happen regularly</b><div className="mute small">In your own words. He brings it back as a card to start.</div></div>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Plan the week's dinners every Saturday morning" aria-label="Tell Chief what should happen regularly" />
        <button className="send" aria-label="Send" disabled={!text.trim()}>↑</button>
      </form>
    </div>
  );
}
function Routines(ctx: Ctx) {
  return <div className="page rest-screen"><h1>Routines</h1><p className="lead">What the crew does on a schedule or when something happens, and whether it's on.</p><RoutineList {...ctx} /><p className="mute small routine-footnote">The crew only runs routines you have approved.</p><div className="label">New routine</div><RoutineAsk /></div>;
}

// ---------- settings ----------
/** Settings, Phones: pair the phone app by its camera, see each phone, take one away. Only this computer can. */
function Phones({ tick }: { tick: number }) {
  const [phones, setPhones] = useState<Json[] | null | undefined>(undefined);
  const [link, setLink] = useState<Json>(null);
  const [offer, setOffer] = useState<Json>(null);
  const [typed, setTyped] = useState<Json>(null);
  const [relay, setRelay] = useState<string | null>(null);
  const [enrol, setEnrol] = useState('');
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
    <div className="label" id="setup-phones">Phones</div>
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
        {!phones.length && <p className="mute">No phones yet. Install the Crewhouse app, then scan the code it asks for.</p>}
        {!offer && <div className="btns"><button className="btn go" onClick={() => show('control')}>Add a phone</button><button className="btn" onClick={() => show('view')}>Add one that only watches</button></div>}
      </div>
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
      {offer && !link.asking.length && (
        <div className="card pair">
          {left > 0 ? <div className="qr"><PairQR text={offer.qr} /></div> : <div className="qr expired">This code ran out.</div>}
          <div className="grow">
            <b>Scan this with the Crewhouse app</b>
            <p className="mute small">{offer.role === 'view' ? 'This phone will watch the crew but not answer or give jobs.' : 'This phone will answer the crew and give them jobs, as you.'}</p>
            <p className="mute small">Then check the two words the phone shows against the ones that appear here.</p>
            <p className="mute small">{left > 0 ? `Works once, for ${left} more seconds.` : 'Make a new one when the phone is ready.'}</p>
            {left > 0 && <p className="small">Can't scan? Type this code on the phone (or copy it to someone you trust): <b style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{offer.typed}</b></p>}
            {left > 0 && A.reach(link).online && (typed ? <p className="small">If the phone is away from home, type this one instead: <b style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{A.phoneTyped(typed)}</b></p>
              : <button className="link inline small" onClick={() => attempt(async () => setTyped(await api.phoneCode(offer.role)))}>Show a code that works from anywhere</button>)}
            <div className="btns">{left <= 0 && <button className="btn go" onClick={() => show(offer.role)}>New code</button>}<button className="btn ghost" onClick={() => setOffer(null)}>Close</button></div>
          </div>
        </div>
      )}
      <label className="card row">
        <input type="checkbox" checked={link.lan} disabled={link.pinned} onChange={(e) => attempt(async () => setLink(await api.phonesAtHome(e.target.checked)))} />
        <span className="grow"><b>Phones on this Wi-Fi can reach the crew</b>
          <div className="mute small">Off: the Wi-Fi opens only while a pairing code is showing here, so a phone can join at home. After that it reaches this computer through <a href="https://tailscale.com" target="_blank" rel="noreferrer">Tailscale</a>, from anywhere. Either way everything between them is locked.</div></span>
      </label>
      <div className="card anywhere">
        <b>Reach it from anywhere</b>
        <p className="mute small">{A.anywhere(link).words}</p>
        {!!A.anywhere(link).steps.length && <ol className="how">{A.anywhere(link).steps.map((s) => <li key={s}>{s}</li>)}</ol>}
        <p className="mute small"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get Tailscale ↗</a> · For your own devices. Tailscale sees which devices are yours, never what they say.</p>
      </div>
      <details className="card" open={!!link.relay}><summary className="small">Another way in: run your own go-between</summary>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { setLink(await api.phoneRelay((relay ?? link.relay).trim(), enrol)); setRelay(null); setEnrol(''); }, 'Saved'); }}>
        <p className="mute small">{A.reach(link).words}</p>
        <p className="mute small">A go-between passes messages between your phones and this computer, so this computer opens nothing to the internet. <a href="https://github.com/umeranjum17/crewhouse/blob/main/relay/README.md" target="_blank" rel="noreferrer">Run your own ↗</a></p>
        <input className="input" value={relay ?? link.relay ?? ''} onChange={(e) => setRelay(e.target.value)} placeholder="Go-between address, like https://go.example.com" aria-label="Go-between address" autoComplete="off" />
        <input className="input" value={enrol} onChange={(e) => setEnrol(e.target.value)} placeholder="Invitation, if your go-between gave you one" aria-label="Invitation" autoComplete="off" />
        <div className="btns"><button className="btn go" disabled={relay === null && !enrol}>Save</button>
          {!!link.relay && <button type="button" className="btn ghost" onClick={() => attempt(async () => setLink(await api.phoneRelay('')), 'Turned off')}>Turn off</button>}</div>
      </form></details>
    </>)}
  </>);
}

/** The three setup jobs, and where each one is finished. Google's own words stay inside the Google panel. */
function HomeSetup({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  const { rows, left } = A.homeSetup(state, A.account(accounts), link);
  const jump = (key: string) => document.getElementById(`setup-${key}`)?.scrollIntoView({ behavior: 'smooth' });
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

function Settings({ state, refresh, tick, accounts, look, setLook }: Ctx & { look: string; setLook: (l: string) => void }) {
  const [signing, setSigning] = useState<{ ai: (typeof A.AIS)[number]; tab: Window | null } | null | false>(sheet === 'signin' ? null : false);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <div className="page settings">
      <h1>Settings</h1>
      <p className="mute small">{A.atHome().join(' ')}</p>
      <HomeSetup state={state} accounts={accounts} tick={tick} />

      <div className="label">You</div>
      <You state={state} act={act} />
      <AboutYou tick={tick} />

      <div className="label" id="setup-chatgpt">Your AI accounts</div>
      <AiAccounts accounts={accounts} refresh={refresh} signIn={(ai) => setSigning({ ai, tab: openTab() })} />

      <div className="label">Your apps</div>
      <a className="card row" href="#/apps"><span className="app-row">{A.apps(state).slice(0, 5).map((a) => <span key={a.id} className="app-ic sm" style={{ background: a.bg }}>{a.mark}</span>)}</span><span className="grow mute">{A.apps(state).filter((a) => a.on).length} connected</span><b>›</b></a>

      <Phones tick={tick} />

      <div className="label">Look</div>
      <div className="seg">{[['auto', 'Evenings dark'], ['day', 'Day'], ['night', 'Night']].map(([k, l]) => <button key={k} className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{l}</button>)}</div>
      <Money state={state} refresh={refresh} />
      <HouseGoogle on={!!state.house?.google} steps={state.house?.steps} refresh={refresh} />
      {signing !== false && <SignIn ai={signing?.ai} tab={signing?.tab} onReady={() => { setSigning(false); refresh(); }} onClose={() => setSigning(false)} />}
    </div>
  );
}

/** The accounts the crew thinks with, signed in first; every other route waits quietly under "More ways to sign in". */
function AiAccounts({ accounts, refresh, signIn }: { accounts: Json[] | null; refresh: () => void; signIn: (ai: (typeof A.AIS)[number]) => void }) {
  const { mine, more } = A.aiList(accounts);
  const row = ({ ai, g, says }: ReturnType<typeof A.aiList>['more'][number]) => (
    <div key={ai.key} className="ai-row">
      <AiMark ai={ai} />
      <div className="grow"><b>{ai.name}</b><div className="mute small">{says}</div></div>
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
        <div className="row"><span className="grow"><b>{A.googleHeadline(steps)}</b><div className="mute small">Your setup so far. Check the remaining steps on Google’s pages.</div></span>
          <button className="btn" onClick={() => { setEdit(true); setStep(A.GOOGLE_STEPS.length - 1); }}>Change key</button></div>
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
 *  their AI. The stored default name "Owner" reads as no name yet, as it does on Hello. */
function You({ state, act }: { state: Json; act: (fn: () => Promise<unknown>, ok?: string) => unknown }) {
  const m = state.person;
  const named = m.name && m.name !== 'Owner' ? m.name : '';
  const [name, setName] = useState(named);
  const [address, setAddress] = useState(m.address ?? '');
  useEffect(() => setName(named), [named]);
  useEffect(() => setAddress(m.address ?? ''), [m.address]);
  const [from, to] = (m.quiet ?? '22:00-07:00').split('-');
  const share = A.share(state);
  return (
    <div className="card person">
      <div className="row">
        <span className="initial">{(named || m.address || 'You')[0]}</span>
        <div className="grow"><b>{named || m.address || 'You'}</b>
          <div className="mute small">{m.address ? `Chief calls you “${m.address}”` : 'Chief will say hello the first time you open Crewhouse'}</div></div>
      </div>
      <label className="field">Your name
        <input className="input" value={name} placeholder="Your name" autoComplete="given-name" onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== named && act(() => api.person(m.id, { name }), 'Saved')} /></label>
      <label className="field">Chief calls you
        <input className="input" value={address} placeholder="sir, ma'am, or a name" onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() && address !== m.address && act(() => api.person(m.id, { address }), 'Saved')} /></label>
      <label className="toggle-row"><span className="grow">Quiet hours{m.quiet ? `, ${from} to ${to}` : ''}<div className="mute small">Nothing new pings you then; the crew keeps going on what's already OK.</div></span>
        <input type="checkbox" role="switch" checked={!!m.quiet} onChange={(e) => act(() => api.person(m.id, { quiet: e.target.checked ? '22:00-07:00' : null }))} /></label>
      <div className="field">How much of your AI the crew may use
        <div className="seg">{A.SHARES.map((o) => <button key={o.key} className={share.choice === o.key ? 'on' : ''} title={o.says}
          onClick={() => act(() => api.person(m.id, { share: o.key }), o.says)}>{o.label}</button>)}</div>
        <span className="mute small">{A.SHARES.find((o) => o.key === share.choice)?.says}. {share.today} {share.week}</span></div>
    </div>
  );
}

function Apps({ state, refresh }: Ctx) {
  const list = A.apps(state);
  const [connecting, setConnecting] = useState<{ app: A.App; tab: Window | null } | null>(null);
  return (
    <div className="page">
      <a href="#/settings" className="back">‹ Settings</a>
      <h1>Your apps</h1>
      <p className="lead">Connect an app when a helper asks for it.</p>
      <div className="label">Apps</div><div className="card list apps-list">
        {list.map((a) => <div key={a.id} className="row-item app-row-item"><span className="app-ic" style={{ background: a.bg }}>{a.mark}</span><div className="grow"><b>{a.name}</b><div className="mute small">{a.on ? 'On · read only' : 'Not connected'}</div></div>
          {a.on ? <button className="link" onClick={() => confirm(`Disconnect ${a.name}? Your helpers will stop using it.`) && attempt(async () => { await api.disconnect(a.id); refresh(); }, `${a.name} disconnected`)}>Turn off</button>
            : <button className="btn" onClick={() => setConnecting({ app: a, tab: A.needsHouse(state, a) ? null : openTab() })}>Connect</button>}</div>)}
      </div>
      <div className="card row"><span className="app-ic" style={{ background: 'linear-gradient(135deg,#ffc27a,#ff7aa2)' }}>↗</span>
        <span className="grow"><b>Share to Crewhouse</b><div className="mute small">On your phone, tap Share in any app (WhatsApp, Photos, a web page), then Crewhouse. Nothing to connect.</div></span></div>
      <p className="mute small center">Connecting opens the app's own sign-in page. That's all.</p>
      {connecting && <ConnectApp app={connecting.app} state={state} tab={connecting.tab} onClose={() => setConnecting(null)} onDone={() => { setConnecting(null); refresh(); }} />}
    </div>
  );
}

// ---------- shell ----------
function useLook() {
  const q = new URLSearchParams(location.search);
  const [look, setLookState] = useState(() => (q.has('night') ? 'night' : q.has('day') ? 'day' : localStorage.getItem('crewhouse.look') ?? 'auto'));
  const [hour, setHour] = useState(new Date().getHours());
  useEffect(() => { const t = setInterval(() => setHour(new Date().getHours()), 60_000); return () => clearInterval(t); }, []);
  const night = look === 'night' || (look === 'auto' && (hour >= 19 || hour < 7));
  setNight(night);
  useEffect(() => { document.documentElement.dataset.theme = night ? 'night' : 'day'; }, [night]);
  const setLook = (l: string) => { localStorage.setItem('crewhouse.look', l); setLookState(l); };
  return { look, setLook, night };
}

/** The crew room's wall: every helper, one line each, with a search above. */
/** The rail's crew list: Chief, the crew's room, then every helper the one who matters most first (A.roster), each
 *  with the word the office uses for them. It is the room's full index, so a helper counted under "+N" is here too. */
function SideCrew({ state, live, view, id }: { state: Json; live: A.OfficeView; view: View; id?: string }) {
  const chats = new Map(A.chats(state).map((c) => [c.id, c]));
  const row = (cid: string, face: ReactNode, name: string, word: string, seat = '') => {
    const c = chats.get(cid);
    return <a key={cid} href={hrefOf(cid)} className={`side-row ${id === cid || (view === 'room' && cid === 'room') || (view === 'chief' && cid === 'chief') ? 'on' : ''}`}>
      {face}<span className="grow"><b className="clamp1">{name}</b>{word && <span className={`side-seat ${seat}`}><i />{word}</span>}</span>{(c?.unread ?? 0) > 0 && <span className="badge">{A.unreadBadge(c!.unread)}</span>}
    </a>;
  };
  const chiefSeat = A.chiefAsks(live).length ? 'needs' : live.chief.mood === 'work' ? 'working' : '';
  return (
    <>
      <div className="label">Your crew</div>
      {row('chief', <Face who="chief" size={22} ring={chiefSeat === 'needs' ? 'needs' : ''} />, 'Chief', chiefSeat === 'needs' ? A.SEAT_WORDS.needs : chiefSeat === 'working' ? A.SEAT_WORDS.working : '', chiefSeat)}
      {live.crew.length > 1 && row('room', <span className="side-room">{live.crew.slice(0, 2).map((h) => <Face key={h.id} who={{ kind: h.kind, name: h.name, mood: h.mood }} size={18} />)}</span>, 'The crew', '')}
      {A.roster(live.crew).map((h) => row(h.id, <Face who={{ kind: h.kind, name: h.name, mood: h.mood }} size={22} ring={h.ring} />, h.name, A.SEAT_WORDS[A.seatOf(h)], A.seatOf(h)))}
      {!live.crew.length && <div className="mute small side-blank">No helpers yet.</div>}
    </>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const under = useRef<Route>({ view: 'home' });
  if (route.view !== 'ask') under.current = route;
  const [state, setState] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  const [party, setParty] = useState<{ title: string; helper: string } | null>(null);
  const accounts = useAccounts(0, tick);
  const seenDone = useRef<Set<number> | null>(null);
  const heard = useRef(0); // when the home computer last answered
  const { look, setLook, night } = useLook();
  const refresh = useCallback(() => {
    api.state().then((s) => { setState(s); setOffline(false); heard.current = Date.now(); }).catch(() => setOffline(true));
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const onHash = () => { moved = true; setRoute(parseRoute()); };
    addEventListener('hashchange', onHash);
    refresh();
    let pending: any;
    const stop = subscribe((e) => { hear(e); clearTimeout(pending); pending = setTimeout(refresh, 120); });
    const poll = setInterval(refresh, 15000); // belt and braces if the socket is quietly gone
    if (new URLSearchParams(location.search).has('celebrate')) setParty({ title: "Mum's birthday video", helper: 'reel' });
    return () => { removeEventListener('hashchange', onHash); stop(); clearInterval(poll); };
  }, [refresh]);
  const wasOffline = useRef(false);
  useEffect(() => { if (wasOffline.current && !offline && state) toast('Back in touch with the home computer ✓'); wasOffline.current = offline; }, [offline]);
  // A job that finishes while you watch gets a little party.
  useEffect(() => {
    if (!state) return;
    const done = A.things(state);
    if (seenDone.current) { const fresh = done.find((t) => !seenDone.current!.has(t.id)); if (fresh) setParty({ title: fresh.title, helper: fresh.helper }); }
    seenDone.current = new Set(done.map((t) => t.id));
  }, [state]);
  // The office's one state source (A.office, moved by live events): Home's room, header, tray, feed and the rail read it.
  const live = useOffice(state, offline);
  const ctx: Ctx | null = useMemo(() => (state && live ? { state, live, tick, refresh, night, offline, accounts } : null), [state, live, tick, refresh, night, offline, accounts]);

  const splash = <Splash done={!!ctx || offline} />;
  if (!ctx) return <>{splash}{offline && <Unreachable retry={refresh} />}</>;
  // Every little Chief face on the page carries the mood from here, the way the night palette does.
  setChiefMood(A.chief(ctx.state, chiefLocal(ctx)).mood);
  if (!ctx.state.person.onboarded) return <>{splash}<Hello {...ctx} /><Toasts /></>;
  const v = under.current;
  const crew = A.crew(ctx.state);
  const asks = ctx.live.needs.length; // the badge counts only what Needs you shows
  const sheet = route.view === 'ask' ? A.cards(ctx.state).find((c) => String(c.id) === route.id) : undefined;
  const book = route.file && route.id ? { bot: route.id, path: route.file } : undefined;
  const nav: [string, string, art.Tab][] = [['#/', 'Home', 'home'], ['#/crew', 'Crew', 'crew'], ['#/things', 'Things', 'things'], ['#/routines', 'Routines', 'routines'], ['#/settings', 'Settings', 'settings']];
  const active = (h: string) => (h === '#/' ? ['home', 'helper', 'chief', 'room'].includes(v.view) : h === '#/crew' ? ['crew', 'add'].includes(v.view) : h === `#/${v.view}` || (h === '#/settings' && v.view === 'apps'));
  return (
    <>
      {splash}
      <div className={`shell ${['chief', 'helper', 'room'].includes(v.view) ? 'is-chat' : ''}${book ? ' with-book' : ''}`}>
        <aside className="side">
          <a href="#/" className="brand"><Logo night={night} /></a>
          {nav.map(([h, l, i]) => <a key={h} href={h} className={`side-nav ${active(h) ? 'on' : ''}`}><span className="ic"><Dots rows={art.TABS[i]} pal={{ x: 'currentColor' }} d={16 / 9} crisp /></span>{l}{h === '#/' && asks > 0 && <span className="badge">{asks}</span>}</a>)}
          <SideCrew state={ctx.state} live={ctx.live} view={v.view} id={v.id} />
          <div className="grow" />
          {A.meter(ctx.state) && <a href="#/settings" className="side-meter mute small">{A.meter(ctx.state)}</a>}
        </aside>
        <main className="main">
          {offline && <div className="offline" role="status">The home computer isn't answering. If it's asleep, the crew has paused and carries on when it wakes. Last heard from it at {A.clock(heard.current)}. Reconnecting… <button className="link inline" onClick={refresh}>Try now</button></div>}
          {v.view === 'home' && <Home {...ctx} />}
          {v.view === 'chief' && <ChiefPage {...ctx} m={v.m} />}
          {v.view === 'room' && <Room {...ctx} />}
          {v.view === 'crew' && <Crew {...ctx} />}
          {v.view === 'add' && <AddHelper {...ctx} />}
          {v.view === 'helper' && v.id && <HelperPage {...ctx} id={v.id} tab={v.tab!} />}
          {v.view === 'things' && <Things {...ctx} id={v.id} />}
          {v.view === 'routines' && <Routines {...ctx} />}
          {v.view === 'settings' && <Settings {...ctx} look={look} setLook={setLook} />}
          {v.view === 'apps' && <Apps {...ctx} />}
          {v.view === 'share' && <Share {...ctx} />}
        </main>
        <nav className="tabbar">{nav.map(([h, l, i]) => <a key={h} href={h} className={active(h) ? 'on' : ''}><span className="ic"><Dots rows={art.TABS[i]} pal={{ x: 'currentColor' }} d={22 / 9} crisp /></span>{l}{h === '#/' && asks > 0 && <span className="badge">{asks}</span>}</a>)}</nav>
      </div>
      {sheet && <AskSheet c={sheet} who={crew.find((h) => h.id === sheet.helper)} chiefSays={ctx.state.asks.find((a: Json) => a.id === sheet.id)?.detail?.chief} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {book && <PreviewPanel bot={book.bot} path={book.path} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {party && <Celebrate title={party.title} href={hrefOf(party.helper)} onDone={() => setParty(null)} />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
