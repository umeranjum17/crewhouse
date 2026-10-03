// Crewhouse, direction C "Pocket Pals" with A's night mode and ASCII moments. Every screen reads the adapter's
// plain-words view models (adapter.ts), never crewd's raw rows.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { qrMatrix } from '@byokit/ui-core';
import { api, demo, subscribe, type Json } from './api.ts';
import * as A from './adapter.ts';
import * as art from './art.ts';
type Helper = ReturnType<typeof A.crew>[number];
import { AiMark, AskCard, Banner, AskSheet, attempt, Celebrate, setAway, setChiefMood, setNight, ChiefArt, Composer, Face, Icon, Logo, Media, ChatText, PalArt, Pill, Splash, Steps, Toasts, toast, useListen, PreviewPanel } from './parts.tsx';
import { keepDraft } from './draft.ts';
import type { IconName } from './icons.ts';
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
    if (!address.trim()) { setOther(true); toast('First, tell me what to call you.'); input.current?.focus(); return; }
    void attempt(async () => { await api.onboard(address.trim(), ask, bot); refresh(); go('#/chief'); });
  };
  return (
    <div className="hello">
      <div className="hello-brand" role="img" aria-label="Crewhouse"><Banner /></div>
      <span className="halo"><ChiefArt mood={tipped ? 'idle' : 'hello'} d={7.4} hero whole /></span>
      <div className="speech">
        <h1>{A.greeting()}{address.trim() ? `, ${address.trim()}` : ''}</h1>
        <p className="lead">I am Chief, your personal assistant. I manage your crew of helpers.</p>
      </div>
      <ul className="promises">
        <li>Your helpers live on this computer. They use your own ChatGPT to think.</li>
        <li>{A.atHome()[1]}</li>
        <li>I ask you before I send messages, delete things or spend money.</li>
      </ul>
      <h2 className="plate">What can I do for you?</h2>
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
        <input ref={input} className="input name" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="What do you want me to call you?" aria-label="What do you want me to call you?" />
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
  if (!text) return <div className="page"><div className="card empty">I did not get anything. Share it again.</div></div>;
  return (
    <div className="page share">
      <div className="card shared"><div className="mute small">Shared with Crewhouse</div><div className="clamp">{text}</div></div>
      <div className="line chief"><div className="bubble-text">I have it. What do you want the crew to do with this?</div></div>
      <div className="chips">
        <button className="chip on" onClick={() => send('Add this to my calendar and remind me the day before')}>📅 Add to my calendar + remind me</button>
        <button className="chip" onClick={() => send('Just remember this for me')}>Just remember it</button>
        <button className="chip" onClick={() => setOther(true)}>Something else…</button>
      </div>
      {other && <div className="dock"><Composer placeholder="What do you want the crew to do with it?" onSend={send} /></div>}
    </div>
  );
}

// ---------- home ----------
/** A helper that has gone quiet: Chief offers to stop it, or you take the wheel, or leave it be. */
const leftAlone = new Map<string, number>();
function Stuck({ h, refresh }: { h: A.Helper; refresh: () => void }) {
  const [, redraw] = useState(0);
  if (!h.stuckFor || leftAlone.get(h.id) === h.quietSince) return null;
  return (
    <div className="stuck">
      <span><Face who="chief" size={20} /> {h.name} sent no update for {h.stuckFor} minute{h.stuckFor === 1 ? '' : 's'}. Do you want me to stop the job? Or do you want to take over?</span>
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
  const crew = A.crew(state), list = A.chats(state);
  // The desk feed shows the two most recent (B1), and any helper gone quiet, so Stuck's choices never hide.
  const [all, setAll] = useState(false);
  const shown = desk && !all ? list.filter((c, i) => i < 2 || (c.who !== 'chief' && c.who.stuckFor)) : list;
  return <section className={`home-section${desk ? '' : ' phone-only'}`} aria-label="Chats">
    <div className="section-head"><span className="label">Chats</span>{desk && list.length > shown.length && !all && <button className="link" onClick={() => setAll(true)}>{`See all ${list.length}`}</button>}{desk && all && <button className="link" onClick={() => setAll(false)}>Show less</button>}</div><div className="list-group chats">
      {shown.map((c) => {
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
  return <a className="card nudge" href="#/settings"><span className="grow">Setup: {left} {left === 1 ? 'thing' : 'things'} to do</span><b>›</b></a>;
}

/** Chief's inbox rows only open the review sheet; nothing commits from Home. Chief brings each; the helper is context. */
function NeedsRows({ cards, quiet, all = false }: { cards: A.Card[]; quiet?: boolean; all?: boolean }) {
  const shown = all ? cards : cards.slice(0, 3);
  return (
    <>
      {shown.map((c) => (
        <a key={c.id} className="needs-row list-row" href={`#/ask/${c.id}`}>
          <Face who="chief" size={36} />
          <span className="grow"><b className="clamp1">{c.head}</b><span className="small clamp1">{c.words}</span></span>
          <span className="chat-end"><time>{A.briefTime(c.at)}</time><i className="need-dot" /></span>
        </a>
      ))}
      {quiet && !cards.length && <div className="mute small needs-quiet">Nothing else for you to decide.</div>}
    </>
  );
}

/** Home's top (B1): in Office the serif greeting with the Chat | Office switch beside it (on a phone the name wraps
 *  under "Good evening," and the switch sits beside the name), then the counts with your quiet hours to the right; in Chat the counts and quiet hours in one line. Counts come from `A.office` alone (every
 *  open request is Chief's to bring, so the count is his). On a narrow screen the gear sits by the switch: there is no tab bar. */
function HomeBar({ ctx, mode, pick }: { ctx: Ctx; mode: HomeMode; pick: (m: HomeMode) => void }) {
  const n = ctx.live.counts, name = String(ctx.state.person?.name ?? '').trim(), quiet = A.quietLine(ctx.state.person);
  const needs = <span className="m-needs" data-n={n.needs}><i />{n.needs ? `Chief has ${n.needs} for you` : 'Nothing for you right now'}</span>;
  const busy = <span className="m-working" data-n={n.working}><i />{n.working} working</span>;
  const still = quiet && <span className="m-quiet"><Icon name="moon" size={14} />{quiet}</span>;
  const tools = <div className="home-tools">
    <a className="icon-btn home-gear" href="#/settings" aria-label="Settings"><Icon name="settings" size={18} /></a>
    <div className="seg home-mode" role="tablist" aria-label="Home view">{HOME_MODES.map(([m, l]) => <button key={m} role="tab" aria-selected={mode === m} data-mode={m} className={mode === m ? 'on' : ''} onClick={() => pick(m)}><Icon name={m === 'chat' ? 'chief' : 'office'} />{l}</button>)}</div>
  </div>;
  if (mode === 'chat') return <header className="home-bar is-chat"><div className="home-meta">{needs}{busy}{still}</div>{tools}</header>;
  return (
    <header className="home-bar">
      <h1 className="home-greet">{A.greeting()}{name && <>,<span className="nm"> <i>{name}</i></span></>}</h1>
      {tools}
      <div className="home-sub"><div className="home-meta">{busy}{needs}</div><div className="home-aside">{still}</div></div>
    </header>
  );
}

/** The right column's heading: the part of the day and the date ("Tonight Wed 1 Oct"). */
const tonight = (d = new Date()) => <h2 className="feed-head">{d.getHours() >= 17 || d.getHours() < 5 ? 'Tonight' : d.getHours() < 12 ? 'This morning' : 'This afternoon'}<small>{d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</small></h2>;

/** On it now (B1): a card per helper at work, their face, name and the step they are on; honest when nobody is. */
function OnItNow({ live, waiting }: { live: A.OfficeView; waiting: number }) {
  const working = live.crew.filter((c) => A.seatOf(c) === 'working');
  return <section className="home-section working" aria-label="Working now"><div className="section-head"><span className="label">Working now</span><span className="small mute">{working.length} working</span></div>
    {working.length ? <div className="on-cards">{working.map((c) => <a key={c.id} className="list-row on-card" href={hrefOf(c.id)}>
      <Face who={{ kind: c.kind, name: c.name, mood: c.mood }} size={30} /><span className="grow"><b className="clamp1">{c.name}</b><span className="small">{c.step || c.status}</span></span>
    </a>)}</div> : <Empty>{waiting ? `No helper is busy. ${waiting} ${waiting === 1 ? 'waits' : 'wait'} for Chief.` : 'No helper is busy now. The crew is free.'}</Empty>}
  </section>;
}

/** Chief's inbox, pinned in both views: its first row, and every row behind an exact "See all N". */
function NeedsPin({ cards, flat }: { cards: A.Card[]; flat?: boolean }) {
  const [all, setAll] = useState(false);
  // "Not now" moves a card behind the others on this screen only: the question stays open and counted until answered.
  const [later, setLater] = useState<number[]>([]);
  // With one card, "Not now" folds it under its heading (still counted); a different question unfolds it.
  const [folded, setFolded] = useState<number | null>(null);
  if (!cards.length) return null;
  const fold = cards.length === 1 && folded === cards[0].id;
  const order = [...cards.filter((c) => !later.includes(c.id)), ...later.map((id) => cards.find((c) => c.id === id)).filter((c): c is A.Card => !!c)];
  return (
    <section className={`home-section needs-pin${flat ? ' flat' : ''}`} aria-label="For you to decide">
      <div className="section-head"><span className="label">For you to decide<span className="count">{cards.length}</span></span>{cards.length > 1 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${cards.length}`}</button>}{fold && <button className="link" onClick={() => setFolded(null)}>Show</button>}</div>
      {!fold && <NeedsCard c={order.slice(0, 1)[0]} flat={flat} onLater={(id) => (cards.length > 1 ? setLater([...later.filter((x) => x !== id), id]) : setFolded(id))} />}
      {all && <div className="list-group needs-card"><NeedsRows cards={order.slice(1)} all /></div>}
    </section>
  );
}

/** The pinned question as the B1 card: Chief brings it (whose job it is about as context), what is asked, the evidence's first lines and the money read from the
 *  page, then the three ways on. Home commits nothing: the yes opens the review sheet (its "…" says so), Ask Chief
 *  fills Chief's box without sending, Not now moves the card back, or folds the only one under its heading; it stays counted either way. */
function NeedsCard({ c, flat, onLater }: { c: A.Card; flat?: boolean; onLater?: (id: number) => void }) {
  const yes = c.choices[0]?.body.answer === 'allow' ? c.choices[0] : null;
  // A known total shows once, in whole dollars when it has no cents ("$412"); the preview's own repeat of it is dropped.
  const shown = c.order?.known ? c.order.shown : '', price = shown.replace(/\.00$/, '');
  const lines = (c.preview?.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !shown || !l.startsWith('Total ')).map((l) => (shown ? l.replace(` — ${shown}`, '') : l)).slice(0, flat ? 1 : 2);
  const question = c.question ?? (c.review && c.preview?.head ? c.preview.head : c.words);
  const about = c.about && <span className="ask-about">About {c.about}'s job</span>;
  const ask = () => { keepDraft('chief', `About ${c.about ? `${c.about}'s job` : 'your question'} (${c.head}): `); go('#/chief'); };
  return (
    <article className="needs-row needs-big" aria-label={`Chief: ${c.head}`}>
      <div className="nb-top">
        {flat ? <span className="nb-av"><ChiefArt d={3} /></span> : <Face who="chief" size={40} />}
        {flat
          ? <div className="grow"><b className="nb-title">{question}</b>{lines.length > 0 && <span className="nb-ask">{lines.join(' · ')}</span>}{about}</div>
          : <div className="grow"><b className="nb-title">{c.head}</b><span className="nb-ask">{question}</span>{about}</div>}
        {flat ? price && <span className="nb-price">{price}</span> : <time className="nb-when">{A.briefTime(c.at)}</time>}
      </div>
      {!flat && (lines.length > 0 || price) && <div className="nb-detail">
        <div className="grow">{lines.map((l, i) => (i ? <span key={i}>{l}</span> : <b key={i}>{l}</b>))}</div>
        {price && <span className="nb-price">{price}</span>}
      </div>}
      <div className="nb-acts">
        <a className="btn go" href={`#/ask/${c.id}`}><Icon name="check" />{yes ? yes.label.replace(shown, price) : c.reply ? 'Answer…' : 'Review…'}</a>
        <button className="btn" onClick={ask}>Ask Chief</button>
        {onLater && <button className="btn ghost" onClick={() => onLater(c.id)}>Not now</button>}
      </div>
    </article>
  );
}

/** "Scout", "Reel and Scribe", "Reel, Scribe and Pip". */
const names = (l: string[]) => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`);
// A helper never calls on the person: waiting on Chief wears no badge, only a calm face.
const BADGE: Partial<Record<A.Seat | 'done', string>> = { working: '', failed: '!', done: '✓', resting: 'z' };

/** Home's chat opens on Chief (B1): his figure, his own line in a bubble, and the crew in a row with a badge each and
 *  one plain caption, every word from the office's state. */
function ChiefHero({ live, state }: { live: A.OfficeView; state: Json }) {
  const crew = A.roster(live.crew), seat = (c: A.OfficeMember) => A.railWord(c, live).seat;
  const by = (k: (A.Seat | 'done')[]) => crew.filter((c) => k.includes(seat(c))).map((c) => c.name);
  const said = [[by(['waiting']), 'waits for Chief', 'wait for Chief'], [by(['working']), 'works', 'work'], [by(['failed']), 'is stuck', 'are stuck'], [by(['resting']), 'rests', 'rest']] as const;
  const caption = said.filter(([l]) => l.length).map(([l, one, many]) => `${names([...l])} ${l.length === 1 ? one : many}`).join(' · ');
  return (
    <section className="chief-hero" aria-label="Chief">
      <span className="ch-art"><ChiefArt mood={live.chief.mood} d={9} hero whole /></span>
      <div className="ch-body">
        <h2 className="ch-name">Chief <small>Studio Chief</small></h2>
        <p className="ch-say">{A.chiefSaid(state) || live.chief.line}</p>
        {crew.length > 0 && <div className="ch-crew">{crew.slice(0, 5).map((c) => { const k = seat(c); return <a key={c.id} href={hrefOf(c.id)} className="ch-face" aria-label={`${c.name}: ${A.railWord(c, live).word}`}>
          <Face who={c} size={44} />{BADGE[k] !== undefined && <i className={`ch-badge ${k}`} aria-hidden>{BADGE[k]}</i>}</a>; })}
          {crew.length > 5 && <a className="ch-more" href="#/crew">+{crew.length - 5}</a>}</div>}
        {caption && <p className="ch-caption">{caption}</p>}
      </div>
    </section>
  );
}

/** The desk's right rail beside Chief's chat (B1): tonight's working helpers, what is ready in your tray, and who is
 *  resting, each a card; a section with nothing in it says so. */
function TonightRail({ live }: { live: A.OfficeView }) {
  const crew = A.roster(live.crew), seat = (c: A.OfficeMember) => A.seatOf(c);
  const working = crew.filter((c) => seat(c) === 'working'), resting = crew.filter((c) => seat(c) === 'resting');
  const day = new Date().setHours(0, 0, 0, 0), ready = live.done.filter((t) => t.at >= day);
  const who = (id: string) => live.crew.find((c) => c.id === id);
  const card = (c: A.OfficeMember, line: string, tag?: string) => <a key={c.id} className="tr-card" href={hrefOf(c.id)}><Face who={c} size={52} /><span className="grow"><b>{c.name}</b><span className="clamp2">{line}</span></span>{tag && <em>{tag}</em>}</a>;
  return <>
    {tonight()}
    <div className="label">Working now</div>
    {working.length ? working.map((c) => card(c, c.step || c.status, 'Working')) : <p className="tr-empty">No helper is busy now.</p>}
    <div className="label">Ready for you</div>
    {ready.length ? ready.slice(0, 3).map((t) => { const h = who(t.helper); return <a key={t.id} className="tr-card" href={`#/things/t${t.id}`}>{h ? <Face who={h} size={52} /> : <Face who="chief" size={52} />}<span className="grow"><b className="clamp1">{t.title}</b><span className="clamp1">From {h?.name ?? 'Chief'} · in your tray</span></span></a>; })
      : <p className="tr-empty">Nothing new in your tray today.</p>}
    <div className="label">Resting</div>
    {resting.length ? resting.map((c) => card(c, c.status)) : <p className="tr-empty">Nobody is resting.</p>}
  </>;
}

/** An empty list, said warmly: a small mark and a plain line, never a blank box. */
const Empty = ({ children }: { children: ReactNode }) => <div className="frame-empty">{children}</div>;

/** Home opens on Chat every time the app starts (kept in memory only, never stored): Chief's thread under the bar and
 *  Chief's pinned inbox. Office is the optional view of the same state; neither view hides that inbox or Chief's box. */
type HomeMode = 'chat' | 'office';
const HOME_MODES: [HomeMode, string][] = [['chat', 'Chat'], ['office', 'Office']];
let homeMode: HomeMode = 'chat';

function Home(ctx: Ctx) {
  const { state, live, refresh, tick, accounts } = ctx;
  const [mode, setMode] = useState(homeMode);
  // On a phone Chief's thread holds the page scrolled to its newest line; the other view starts at its top, or Office
  // opens scrolled past its room.
  const pick = (m: HomeMode) => { homeMode = m; setMode(m); scrollTo(0, 0); };
  const g = A.account(accounts);
  const toChief = async (t: string) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) { refresh(); go('#/chief'); } return ok; };
  const waiting = live.crew.filter(A.waitsOnChief).length;
  const top = <>
    <HomeBar ctx={ctx} mode={mode} pick={pick} />
    {/* Chief's thread shows its own sign-in card and resting line; Office shows them here. */}
    {mode === 'office' && (g.state === 'signed-out' || g.notIncluded) && <AccountCard g={g} onReady={refresh} />}
    <SetupRow state={state} accounts={accounts} tick={tick} />
    {mode === 'office' && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. I will continue the work then.</span></div>}
    {A.gettingReady(state) && <div className="card nudge"><span className="grow">{A.gettingReady(state)}</span></div>}
    {A.update(state) && <div className="card nudge"><span className="grow">{A.update(state)!.words}</span><a className="btn go" href={A.update(state)!.url} target="_blank" rel="noreferrer">Download</a></div>}
  </>;
  // Chat: Chief's own thread, its box and (on a wide desk) its side column of who is on what.
  if (mode === 'chat') return <div className="page chat-page home-chat"><div className="home-top">{top}<ChiefHero live={live} state={state} /><NeedsPin cards={live.needs} flat /></div><Chat {...ctx} id="chief" hero rail={<TonightRail live={live} />} /></div>;
  // Office (B1): the greeting and the room with its strip in the middle; Tonight down the right on a computer (Chief's inbox,
  // On it now, chats, a job to hand over, Chief's box), and under the room on a phone.
  return (
    <div className="home home-office">
      <div className="office-main">
        <div className="home-top">{top}</div>
        <Office state={state} live={live} night={ctx.night} />
        <div className="phone-only">
          <NeedsPin cards={live.needs} />
          <OnItNow live={live} waiting={waiting} />
          <Chats state={state} refresh={refresh} /><JobList state={state} phone refresh={refresh} />
        </div>
      </div>
      <aside className="feed desk-only" aria-label="What's going on">
        <div className="feed-list">
          {tonight()}
          <NeedsPin cards={live.needs} />
          <OnItNow live={live} waiting={waiting} />
          <Chats state={state} refresh={refresh} desk />
          <JobList state={state} few refresh={refresh} />
        </div>
        <div className="feed-ask"><Composer placeholder="Ask Chief anything…" onSend={toChief} {...typeInto('chief')} chips={A.ideas(state).map((i: Json) => ({ label: i.ask.trim(), ask: i.ask }))} /></div>
      </aside>
      <div className="dock phone-only"><Composer placeholder="Ask Chief anything" onSend={toChief} {...typeInto('chief')} chips={[]} /></div>
    </div>
  );
}

/** The standing "hand me a job" list (docs/ui-contract.md, `ideas[]`): what the crew offers to do end to end, money back
 *  first. A row fills Chief's box with the words and never sends; a job still waiting on an app says what it needs and
 *  leads to the apps screen instead of dead-ending. A row offering a helper not hired yet brings them on first, then
 *  fills Chief's box (he is the only one you talk to). The same rows sit in the desk's third frame and under the chats on a phone. */
function JobList({ state, phone, few, refresh }: { state: Json; phone?: boolean; few?: boolean; refresh: () => void }) {
  const crew = A.crew(state);
  const rows = A.jobs(state);
  const [all, setAll] = useState(false);
  const shown = phone ? rows.slice(0, 3) : few && !all ? rows.slice(0, 1) : rows; // the desk feed shows one, as B1 does
  const hand = (ask: string) => { keepDraft('chief', ask); go('#/chief'); };
  // The gallery hire, then the words in Chief's box: nothing starts until they send.
  const hire = async (template: string, ask: string) => {
    const name = state.templates.find((t: Json) => t.id === template)?.display ?? template;
    let id = '';
    if (await attempt(async () => { id = (await api.recruit(template, name)).id; }, `${name} joined the crew`)) { refresh(); hand(`${name}: ${ask}`); }
  };
  return (
    <section className={`home-section jobs${phone ? ' phone-only' : ''}`} aria-label="Give me a job">
      <div className="section-head"><span className="label">Give me a job</span>{few && rows.length > 1 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${rows.length}`}</button>}</div><div className="list-group">
      {shown.length ? shown.map((j) => {
        const h = crew.find((x) => x.id === j.bot);
        const body = <>{j.money ? <span className="job-ic" aria-hidden><Icon name="money" /></span> : <Face who={h ?? { kind: 'pip', name: j.bot }} size={phone ? 28 : 36} />}
          <span className="grow"><b className="clamp">{j.label}</b>{j.says && <span className="small mute clamp">{j.says}</span>}{j.needs.length > 0 && <span className="small clamp1">{A.jobNeeds(j.needs)}</span>}</span><span className="mute" aria-hidden><Icon name="next" /></span></>;
        return j.needs.length ? <a key={j.bot + j.label} className="list-row" href="#/apps">{body}</a>
          : j.hire ? <button key={j.bot + j.label} className="list-row" onClick={() => hire(j.hire!, j.ask)}>{body}</button>
          : <button key={j.bot + j.label} className="list-row" onClick={() => hand(A.forHelper(state, j.bot, j.ask))}>{body}</button>;
      }) : <div className="frame-empty">There are no jobs here yet. Hire a helper to add jobs to this list.</div>}
      </div>
    </section>
  );
}

/** The starters live in Chief's empty chat: a tap fills the box with the words, it never sends. */
function ChiefIdeas({ state, chat, picked }: { state: Json; chat: string; picked: () => void }) {
  return <><p className="ideas-intro">I can add Scout for research, Scribe for writing or Reel for videos.</p><div className="chips center">{A.ideas(state).map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft(chat, i.ask); picked(); }}>✦ {i.label}</button>
  ))}</div></>;
}

/** A helper's starters in its own fresh record: its own ready rows only, never another helper's. A tap fills Chief's
 *  box and opens his chat; it never sends. */
function HelperIdeas({ state, chat }: { state: Json; chat: string }) {
  const rows = A.ideas(state).filter((i: Json) => i.bot === chat);
  if (!rows.length) return null;
  return <div className="chips center">{rows.map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft('chief', A.forHelper(state, i.bot, i.ask)); go('#/chief'); }}>✦ {i.label}</button>
  ))}</div>;
}

/** Chief's hand-off in a helper's chat: the collapsed ask, with the full assignment words behind Show details. */
function ChiefAsk({ l }: { l: { text: string; detail: string } }) {
  const [open, setOpen] = useState(false);
  return <div className="bubble-text"><ChatText text={l.text} /> <button className="link inline" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Show details'}</button>
    {open && <ChatText text={l.detail} />}</div>;
}

/** The receipt on the line a finished job ended on, once crewd says done: in the helper's record, or on Chief's line
 *  passing it on (`Line.by`). Watch opens that helper's screen, the one way in to see the work. */
function Receipt({ who, offline }: { who?: Helper; offline: boolean }) {
  return <div className="receipt"><span className="grow"><b>Done</b></span>{who?.computer && !offline && <a className="link" href={`#/h/${who.id}/screen`}>Watch {who.name}</a>}</div>;
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
function Chat({ id, m, state, tick, refresh, accounts, offline, hero, rail }: Ctx & { id: string; m?: string; hero?: boolean; rail?: ReactNode }) {
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
  const lines = hero ? A.trayNotes(state, A.lines(page, id, state)) : A.lines(page, id, state);
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
  // The thread scrolls by its own column on a desk and in Home's chat on a phone (a scrollIntoView here once dragged the
  // whole page up with it, hiding Chief's hero); other phone chats keep the document scroll. An anchored landing
  // scrolls to the line instead. Every chat opens at its newest line (Main600) under a hero that stays in place (096).
  useEffect(() => {
    if (around) return;
    if (hero || matchMedia('(min-width: 900px)').matches) { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }
    else end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, around, !!echoed, !!waiting, partial, hero]);
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
  // Every open request is Chief's to bring, whoever's job it came from; a helper's thread is a work record, so none.
  const cards = id === 'chief' ? A.needsYou(state) : [];
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
        {start && !hero && <div className="chat-intro">
          <span className="halo">{h ? <PalArt kind={h.kind} mood={h.mood} d={4.4} name={h.name} /> : <ChiefArt mood="idle" d={3.6} />}</span>
          <b>{name}</b><span>{h ? `${h.role} · Reports to Chief` : 'Manages the crew for you'}</span>
        </div>}
        {!page && <div className="skeleton" aria-busy="true" aria-label="Opening the chat"><i /><i /><i /></div>}
        {fresh && page && (id === 'chief'
          ? <ChiefIdeas state={state} chat={id} picked={() => setSeed((n) => n + 1)} />
          : <HelperIdeas state={state} chat={id} />)}
        {lines.map((l, i) => start && i === 0 && l.from === 'note' && l.text.startsWith(`${name} joined the crew`) ? null : <div key={l.id} className="line-wrap">{dayOf(l.at)}
          <div id={`m${l.id}`} className={`line ${l.from}${l.unsure || l.failed ? ' unsure' : ''}${l.recap ? ' recap' : ''}${l.id > (opened.current ?? Infinity) ? ' fresh' : ''}${i && lines[i - 1].from === l.from && l.from !== 'me' && !l.recap && !lines[i - 1].recap ? ' consecutive' : ''}`}>
            {l.from !== 'me' && l.from !== 'note' && <div className="line-by"><Face who={l.from === 'chief' ? 'chief' : h ?? 'chief'} size={28} /><span className="who">{l.from === 'chief' ? 'Chief' : name}</span><time>{l.at ? A.clock(l.at) : ''}</time></div>}
            {l.by && l.from === 'note' && <span className="note-by"><Face who={A.crew(state).find((x) => x.id === l.by) ?? 'chief'} size={20} /></span>}
            {l.text && (l.detail ? <ChiefAsk l={{ text: l.text, detail: l.detail }} /> : <div className="bubble-text"><ChatText text={l.text} /></div>)}
            {id === 'chief' && l.text === 'Sign in with ChatGPT.' && <AccountCard g={{ ...g, state: 'signed-out' }} inChat onReady={() => { void load(); refresh(); }} />}
            {l.files.map((f) => <Media key={f.url} f={f} big />)}
            {l.done && <Receipt who={h ?? crew.find((x) => x.id === l.by)} offline={offline} />}
            {phoneOffer?.message === l.id && <PhoneCard offer={phoneOffer} reload={() => void load()} />}
            {cards.filter((c) => lines.findLastIndex((x) => (x.at ?? 0) <= c.at) === i).map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={c.about} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} onDone={refresh} />)}
          </div></div>
        )}
        {echoed && <div className="line me fresh"><div className="bubble-text">{pending.text}</div></div>}
        {waiting && id === 'chief' && <div className="line them fresh" role="status"><div className="line-by"><Face who="chief" size={28} /><span className="who">Chief</span></div><div className="bubble-text"><span className="typing" aria-hidden><i /><i /><i /></span><span className="sr">Chief works on it</span></div></div>}
        {!!partial && <div className="line them streaming" aria-live="polite"><div className="line-by"><Face who={h ?? 'chief'} size={28} /><span className="who">{name}</span></div><div className="bubble-text"><ChatText text={partial} /></div></div>}
        {A.building(lines, live) && <div className="line them" role="status"><div className="line-by"><Face who={h ?? 'chief'} size={28} /><span className="who">{name}</span></div><div className="building-card" aria-label="Building it"><i aria-hidden /><i aria-hidden /><div className="bubble-text">I will share it here when it is ready.</div></div></div>}
        {!h && last?.choices.length ? <div className="chips">{last.choices.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div> : null}
        {cards.filter((c) => !lines.length || lines.every((x) => (x.at ?? 0) > c.at)).map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={c.about} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} onDone={refresh} />)}
        {h?.ring === 'waiting' && <a className="line note waiting-chief" href="#/chief"><span className="bubble-text">Waiting for Chief ›</span></a>}
        {h && <Stuck h={h} refresh={refresh} />}
        {(g.state === 'signed-out' || g.notIncluded) && <AccountCard g={g} inChat onReady={() => { void load(); refresh(); }} />}
        {g.state === 'ready' && !g.notIncluded && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. {name === 'Chief' ? 'I will' : `${name} will`} finish then.</span></div>}
        <div ref={end} className="end" />
      </div>
      <aside className={`working-on${rail ? ' tonight-rail' : ''}`}>
        {rail}
        {live && h && <section className="working-on-frame"><div className="label">Working on</div><div className="list-group"><div className="work-title"><b>{A.plain(live.title)}</b><span className="small">{h.status}</span></div>{trail.length > 0 && <Steps steps={trail} max={3} />}<a className="link" href={`#/h/${id}/did`}>What happened ›</a></div></section>}
        {A.things(state).filter((x) => x.helper === id).length > 0 && <section className="home-section"><div className="label">Made in this chat</div><div className="list-group">{A.things(state).filter((x) => x.helper === id).map((x) => { const t = A.fileTarget(x.files[0]); return <a className="list-row" key={x.id} href={t?.href.startsWith('#') ? t.href : `#/things/t${x.id}`}><span className="file-chip">{t?.chip ?? '—'}</span><span className="grow"><b className="clamp1">{x.title}</b><span className="small clamp1">{x.summary}</span></span></a>; })}</div></section>}
      </aside>
      {/* Chief is the only one you talk to: a helper's thread is its work, reported to him, and asking about it fills his box. */}
      {h ? <div className="dock report-dock"><span className="grow mute small">{name} reports this work to Chief.</span>
        <button className="btn" onClick={() => { keepDraft('chief', `About ${name}'s job${live ? ` “${A.plain(live.title)}”` : ''}: `); go('#/chief'); }}>Ask Chief about this</button></div>
        : <div className="dock"><Composer key={seed} placeholder={hero && !matchMedia('(min-width: 900px)').matches ? 'Ask Chief anything' : 'Ask Chief anything…'} onSend={send} chips={hero ? A.ideas(state).map((i: Json) => ({ label: i.ask.trim(), ask: i.ask })) : undefined} {...typeInto(id)} /></div>}
    </div>
  );
}

function Room(ctx: Ctx) {
  const { state, tick, refresh } = ctx;
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.room().then(setPage).catch(() => {}), []);
  useEffect(() => { void load(); }, [load, tick]);
  const lines = A.room(page, state);
  const helpers = A.crew(state);
  // Chief is the only one you talk to, here too; any request the crew's work raised waits in his chat.
  const send = async (text: string) => { const ok = await attempt(() => api.post('chief', text, { room: true }), undefined, true); if (ok) { await load(); refresh(); } return ok; };
  return <div className="page chat-page"><header className="chat-head sticky-top"><a href="#/" className="back">‹</a><span className="row">{helpers.slice(0, 3).map((h) => <Face key={h.id} who={h} size={30} ring={h.ring} />)}</span><div className="grow"><b>The crew</b><div className="mute small">Work handed between helpers</div></div></header>
    <div className="chat"><div className="lines">{lines.length ? lines.map((l: ReturnType<typeof A.room>[number]) => <div className={`line ${l.author === 'person' ? 'me' : 'them'}`} key={l.id}>
      {l.who && <div className="row"><Face who={l.who} size={30} ring={l.who.ring} /><b>{l.from && l.to ? `${l.from} → ${l.to}` : l.author === 'person' ? 'You → ' + l.who.name : l.who.name}</b></div>}
      {l.text && <div className="bubble-text"><ChatText text={l.text} /></div>}{l.files.map((f: ReturnType<typeof A.room>[number]['files'][number]) => <Media key={f.url} f={f} big />)}
    </div>) : <div className="mute center empty">Start a job here. Then watch the crew work together.</div>}
</div>
      <aside className="working-on">{(page?.busy ?? []).length > 0 && <section className="frame working-on-frame"><div className="label ascii">Working on</div>{(page.busy as string[]).map((id) => { const h = helpers.find((x) => x.id === id); return h && <div className="frame-row head" key={id}><Face who={h} size={32} ring={h.ring} /><b>{h.name}</b></div>; })}</section>}</aside>
      <div className="dock"><Composer placeholder="Message Chief…" onSend={send} {...typeInto('room')} /></div>
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
  return <div className="page rest-screen"><a href="#/" className="back phone-only">‹ Home</a><h1>Your crew</h1><p className="lead">All helpers report to Chief.</p><div className="card list">
    <a className="row-item crew-row" href="#/chief"><Face who="chief" size={44} ring={ctx.live.needs.length ? 'needs' : undefined} /><span className="grow"><b>Chief</b><span className="mute small clamp1">Manages the crew for you</span></span><span className="status-word">{chief.line}</span></a>
    {helpers.map((h) => <a key={h.id} className="row-item crew-row" href={hrefOf(h.id)}><Face who={h} size={44} ring={h.ring} /><span className="grow"><b>{h.name}</b><span className="mute small clamp1">{h.role}</span></span><span className="status-word"><i className={h.ring} />{h.status}</span></a>)}
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
  if (!h && id !== 'chief') return <div className="page mute">{state.bots.some((b: Json) => b.id === id) ? '' : 'This helper left the crew.'}</div>;
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
          {b?.task ? (trail.length ? <Steps steps={trail} max={7} /> : <p className="mute">Current job: “{A.plain(b.task.title)}”. Each step shows here when it occurs.</p>)
            : <p className="mute">Nothing right now.</p>}
          <a className="link" href={`#/h/${id}/did`}>What happened</a>
          <h2 className="plate">Things</h2>
          <ThingsGrid list={A.things(state).filter((t) => t.helper === id)} state={state} empty={`${h.name}'s finished work shows here.`} />
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
        <p className="lead">This list shows what {name} does, when it occurs. Crewhouse records it. {name} does not remember it.</p>
        {A.steps(page.trail ?? []).length ? <Steps steps={A.steps(page.trail ?? [])} max={40} onUndo={(s) => attempt(async () => { await api.undoMemory(id, s.seq); void load(); }, 'Forgotten')} />
          : <div className="card empty">Nothing yet. Give {name} something to do.</div>}
      </> : null)}
      {tab === 'screen' && h && <div className="sticky-top"><header className="chat-head">
        <a href={`#/h/${id}/chat`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
        <div className="grow"><b>{h.name}'s computer</b></div>
      </header></div>}
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
  return <div className="page rest-screen"><a href="#/" className="back phone-only">‹ Home</a><h1>Things</h1><p className="lead">Everything the crew has made for you.</p>{(['Today', 'Yesterday', 'Earlier'] as const).map((group) => {
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
            {[r.on, r.watching ? `Watches ${r.watching}` : '', r.when].filter(Boolean).join(' · ')}{r.paused ? ' · paused' : r.next ? ` · next ${r.next}` : ''}{r.quiet && !r.watching ? ' · says nothing when there is no news' : ''}
          </button> : <div className="mute small">Type a new time below. Then tap Save, or tap Cancel.</div>}
          {r.last && <div className="mute small">{r.last}{r.result && <> · <a className="link pink" href={r.result.thing ? `#/things/t${r.result.thing}` : `#/h/${r.helper}/chat/m${r.result.msg}`}>See result</a></>}</div>}
        </div>
      </div>
      {when !== null && <form className="row" onSubmit={(e) => { e.preventDefault(); if (when.trim() && preview && !preview.bad) void save(); }}>
        <input className="input grow" value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When? For example: every Saturday 10am" aria-label="When" autoFocus />
        <button className="btn go" disabled={!when.trim() || !preview || preview.bad}>Save</button>
        <button className="btn ghost" type="button" onClick={() => setWhen(null)}>Cancel</button>
      </form>}
      {when !== null && preview && !preview.bad && <div className="mute small">{preview.words}. First time {preview.first}.</div>}
      {when !== null && preview?.bad && <div className="mute small">I do not understand that time. Try “every Monday 9:00”.</div>}
      <div className="btns">
        <button className="btn" onClick={() => act(() => api.runRoutine(r.id), 'Asked to run')}>Do it now</button>
        <label className="routine-switch"><input type="checkbox" role="switch" checked={!r.paused} aria-label={`${r.paused ? 'Resume' : 'Pause'} ${r.name}`} onChange={(e) => act(() => api.routine(r.id, { state: e.target.checked ? 'on' : 'paused' }))} /><span>{r.paused ? 'Paused' : 'On'}</span></label>        {!r.digest && !r.watching && <button className={`chip ${r.quiet ? 'on' : ''}`} aria-pressed={r.quiet} onClick={() => act(() => api.routine(r.id, { quiet: !r.quiet }), r.quiet ? 'It will always send a report' : 'It will only tell you when there is news')}>Only tell me when there is news</button>}
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
        <div><b>Tell Chief what should happen regularly</b><div className="mute small">Use your own words. Chief sends you a card to start it.</div></div>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Plan the week's dinners every Saturday morning" aria-label="Tell Chief what should happen regularly" />
        <button className="send" aria-label="Send" disabled={!text.trim()}>↑</button>
      </form>
    </div>
  );
}
function Routines(ctx: Ctx) {
  return <div className="page rest-screen"><a href="#/" className="back phone-only">‹ Home</a><h1>Routines</h1><p className="lead">What the crew does on a schedule or when something happens, and whether it's on.</p><RoutineList {...ctx} /><p className="mute small routine-footnote">The crew only runs routines you have approved.</p><div className="label">New routine</div><RoutineAsk /></div>;
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
            <button className="btn ghost" onClick={() => attempt(async () => { await api.removePhone(p.id); await load(); }, `${p.name} cannot reach the crew now`)}>Remove</button>
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
            <button className="btn" onClick={() => attempt(async () => { await api.answerPhone(a.id, false); await load(); }, `You said no to ${a.name}`)}>No</button>
          </div>
        </div>
      ))}
      {offer && !link.asking.length && (
        <div className="card pair">
          {left > 0 ? <div className="qr"><PairQR text={offer.qr} /></div> : <div className="qr expired">This code expired.</div>}
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

const GO_TO: [string, string, IconName][] = [['#/things', 'Your things', 'things'], ['#/routines', 'Routines', 'routines'], ['#/apps', 'Apps', 'apps'], ['#/crew', 'Your crew', 'chief']];
function Settings({ state, refresh, tick, accounts, look, setLook }: Ctx & { look: string; setLook: (l: string) => void }) {
  const [signing, setSigning] = useState<{ ai: (typeof A.AIS)[number]; tab: Window | null } | null | false>(sheet === 'signin' ? null : false);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <div className="page settings">
      <a href="#/" className="back phone-only">‹ Home</a>
      <h1>Settings</h1>
      <p className="mute small">{A.atHome().join(' ')}</p>
      {/* No tab bar on a phone (B1): the desk rail's places, reached from here. */}
      <div className="card list phone-only">{GO_TO.map(([h, l, i]) => <a key={h} href={h} className="row-item go-to"><span className="o-ic"><Icon name={i} /></span><span className="grow">{l}</span><Icon name="next" /></a>)}</div>
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

/** The rail's crew list (B1): every helper, the one who matters most first (A.roster), each with the word the office
 *  uses for them on the right, never a count or a call on you: Chief has his own line, and the only count, in the nav above. */
function SideCrew({ live, id }: { live: A.OfficeView; id?: string }) {
  return (
    <div className="side-crew">
      <a className="label side-label" href="#/crew">Your crew<span>{live.crew.length}</span></a>
      {A.roster(live.crew).map((h) => {
        const r = A.railWord(h, live);
        return <a key={h.id} href={hrefOf(h.id)} className={`side-row ${id === h.id ? 'on' : ''}`}>
          <Face who={{ kind: h.kind, name: h.name, mood: h.mood }} size={26} /><b className="clamp1 grow">{h.name}</b>
          <span className={`side-seat ${r.seat}`}><i /><span className="clamp1">{r.seat === 'done' ? 'Done' : r.word}</span></span>
        </a>;
      })}
      {!live.crew.length && <div className="mute small side-blank">No helpers yet.</div>}
    </div>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const under = useRef<Route>({ view: 'home' });
  if (route.view !== 'ask') under.current = route;
  const [state, setState] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  setAway(offline);
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
  useEffect(() => { if (wasOffline.current && !offline && state) toast('Connected to the home computer again ✓'); wasOffline.current = offline; }, [offline]);
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
  const asks = ctx.live.needs.length; // the badge counts only Chief's inbox, the one count
  const sheet = route.view === 'ask' ? A.cards(ctx.state).find((c) => String(c.id) === route.id) : undefined;
  const book = route.file && route.id ? { bot: route.id, path: route.file } : undefined;
  // The desk rail (B1): Chief, your things, routines and apps; the crew under it; you and the gear at the foot.
  const rail: [string, string, IconName, number][] = [['#/', 'Chief', 'chief', asks], ['#/things', 'Your things', 'things', ctx.live.counts.done], ['#/routines', 'Routines', 'routines', 0], ['#/apps', 'Apps', 'apps', 0]];
  const railOn = (h: string) => (h === '#/' ? ['home', 'chief'].includes(v.view) : h === `#/${v.view}`);
  const me = String(ctx.state.person?.name ?? '').trim(), quiet = A.quietLine(ctx.state.person);
  return (
    <>
      {splash}
      <div className={`shell ${['chief', 'helper', 'room', 'home'].includes(v.view) ? 'is-chat' : ''}${book ? ' with-book' : ''}`}>
        <aside className="side">
          <a href="#/" className="brand"><Logo night={night} />{demo && <span className="demo-tag">Demo</span>}</a>
          <nav className="side-navs">{rail.map(([h, l, i, n]) => <a key={h} href={h} className={`side-nav ${railOn(h) ? 'on' : ''}`}><Icon name={i} />{l}{n > 0 && <span className={`side-count${h === '#/' ? ' hot' : ''}`}>{n}</span>}</a>)}</nav>
          <SideCrew live={ctx.live} id={v.view === 'helper' ? v.id : undefined} />
          <div className="grow" />
          {A.meter(ctx.state) && <a href="#/settings" className="side-meter mute small">{A.meter(ctx.state)}</a>}
          <a href="#/settings" className={`side-me ${v.view === 'settings' ? 'on' : ''}`} aria-label={`Settings${me ? `, ${me}` : ''}`}>
            <span className="me-av">{(me[0] ?? '·').toUpperCase()}</span><span className="grow"><b className="clamp1">{me || 'You'}</b>{quiet && <span className="clamp1">{quiet}</span>}</span><Icon name="settings" />
          </a>
        </aside>
        <main className="main">
          {offline && <div className="offline" role="status">The home computer does not answer. If it is asleep, the crew stops until it wakes. Its last answer was at {A.clock(heard.current)}. Connecting again… <button className="link inline" onClick={refresh}>Try now</button></div>}
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
      </div>
      {sheet && <AskSheet c={sheet} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {book && <PreviewPanel bot={book.bot} path={book.path} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {party && <Celebrate title={party.title} href={hrefOf(party.helper)} onDone={() => setParty(null)} />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
