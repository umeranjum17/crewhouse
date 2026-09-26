// Crewhouse, direction C "Pocket Pals" with A's night mode and ASCII moments. Every screen reads the adapter's
// plain-words view models (adapter.ts), never crewd's raw rows.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { api, demo, setMember, subscribe, type Json } from './api.ts';
import * as A from './adapter.ts';
type Helper = ReturnType<typeof A.crew>[number];
import { AskCard, AskSheet, attempt, Celebrate, setChiefMood, setNight, ChiefArt, Composer, Face, Laptop, Logo, Media, PalArt, Pill, Splash, Steps, Toasts, toast, useHeld, useListen, PreviewPanel } from './parts.tsx';
import { keepDraft } from './draft.ts';
import { Screen } from './screen.tsx';
import { AccountCard, ConnectApp, ConnectCard, openTab, sheet, SignIn, Unreachable } from './flows.tsx';

type View = 'home' | 'chief' | 'crew' | 'add' | 'helper' | 'things' | 'routines' | 'settings' | 'apps' | 'ask' | 'share';
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
  return { view: (['chief', 'crew', 'things', 'routines', 'settings', 'apps'].includes(a) ? a : 'home') as View };
}
const go = (hash: string) => { location.hash = hash; };
let moved = false; // this session has navigated inside the app, so Back has somewhere to go back to
/** Back returns where you came from: the previous screen when there is one, else Chats. */
const back = () => { if (moved && history.length > 1) history.back(); else go('#/'); };
/** ?splash keeps the boot splash up, for design review. */
const hrefOf = (id: string) => (id === 'chief' ? '#/chief' : `#/h/${id}`);
/** Which chat each composer writes into: its held draft lives in web/src/draft.ts. */
const typeInto = (id: string) => ({ chat: id });

type Ctx = { state: Json; me: number; tick: number; refresh: () => void; night: boolean; offline: boolean; accounts: Json[] | null };

/** What Chief knows from the app itself, not the state: the computer out of reach, his composer, the sign-in. */
function chiefLocal(ctx: Ctx, listen = false): A.ChiefLocal {
  const g = A.account(ctx.accounts, ctx.me);
  return { offline: ctx.offline, listen, signedOut: g.state === 'signed-out' || g.notIncluded };
}

// ---------- first run ----------
function useAccounts(poll: number, tick = 0) {
  const [list, setList] = useState<Json[] | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => api.accounts().then((l) => alive && setList(l)).catch(() => {});
    pull();
    const t = poll ? setInterval(pull, poll) : undefined;
    return () => { alive = false; clearInterval(t); };
  }, [poll, tick]);
  return list;
}

/**
 * First run, as the onboarding prototype: Chief greets her by the name the owner gave, two promises, and three things he
 * can take off her plate. One tap on an idea is both "hello" and her first job; the sign-in comes right after, in the
 * chat, when she already wants something. Nothing to type.
 */
function Hello({ state, refresh, night }: Ctx) {
  const me = state.person;
  const isOwner = me.id === A.OWNER;
  const owner = state.members.find((m: Json) => m.id === A.OWNER)?.name ?? 'the owner';
  const named = me.name && !(isOwner && me.name === 'Owner') ? me.name : '';
  const [address, setAddress] = useState<string>(me.address || named);
  const [other, setOther] = useState(!named);
  const input = useRef<HTMLInputElement>(null);
  const [tipped, setTipped] = useState(false); // he raises his bowler as he greets, then settles
  const [own, setOwn] = useState(false);
  const [words, setWords] = useState('');
  useEffect(() => { const t = setTimeout(() => setTipped(true), 2400); return () => clearTimeout(t); }, []);
  const pick = (ask: string) => {
    if (!address.trim()) { setOther(true); toast('First, what shall I call you?'); input.current?.focus(); return; }
    void attempt(async () => { await api.onboard(address.trim(), ask); refresh(); go('#/chief'); });
  };
  return (
    <div className="hello">
      <div className="hello-brand"><Logo night={night} /></div>
      <span className="halo"><ChiefArt mood={tipped ? 'idle' : 'hello'} d={8.5} /></span>
      <h1>{A.greeting()}{address.trim() ? `, ${address.trim()}` : ''}</h1>
      <p className="lead">I'm Chief. I run the crew in this house{isOwner ? '.' : `; ${owner} set me up for you.`}</p>
      <div className="promises">
        <div>› Your helpers live on this computer, and think with your own ChatGPT.</div>
        <div>› {A.atHome()[1]}</div>
        <div>› I'll ask before sending messages, deleting things or spending money.</div>
      </div>
      <h2 className="plate">What can I take off your plate?</h2>
      <div className="ideas">
        {A.firstIdeas(state).map((i) => <button key={i.label} className="idea" onClick={() => pick(i.label)}><span aria-hidden>{i.icon}</span><b>{i.label}</b><i aria-hidden>›</i></button>)}
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

/** Every chat, like a messaging app: Chief on top, then whoever spoke last. A search box finds words across them. */
function Chats({ state, refresh }: { state: Json; refresh: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Json | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setHits(null);
    const t = setTimeout(() => api.search(q.trim()).then(setHits).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  const crew = A.crew(state);
  const found = A.found(state, hits);
  return (
    <div className="card jobs chats">
      <input className="input search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your chats" aria-label="Search your chats" />
      {hits ? (found.length ? found.map((f) => (
        <a key={f.key} className="job" href={f.msg ? (f.bot === 'chief' ? `#/chief/m${f.msg}` : `#/h/${f.bot}/chat/m${f.msg}`) : f.thing ? `#/things/t${f.thing}` : hrefOf(f.bot)}>
          {f.bot === 'chief' ? <Face who="chief" size={40} /> : <Face who={crew.find((h) => h.id === f.bot) ?? { kind: 'pip', name: f.name }} size={40} />}
          <div className="grow"><b>{f.name}</b><div className="mute clamp1">{f.text}</div></div>
          <span className="mute small">{A.clock(f.at)}</span>
        </a>
      )) : <div className="mute center empty">Nothing matches “{q.trim()}”.</div>) : A.chats(state).map((c) => {
        const h = c.who === 'chief' ? undefined : c.who;
        return (
          <div key={c.id}>
            <a className="job" href={hrefOf(c.id)}>
              {c.who === 'chief' ? <span className="face" style={{ width: 46, height: 46, background: '#fff7e8' }}><ChiefArt mood={A.chief(state).mood} d={2.2} /></span> : <Face who={c.who} size={46} ring={c.ring} />}
              <div className="grow"><b>{c.name}</b><div className={`clamp1 ${c.unread ? '' : 'mute'}`}>{c.line}</div></div>
              <span className="chat-end"><span className="mute small">{c.at ? A.clock(c.at) : ''}</span>{c.unread > 0 && <span className="badge" aria-label={`${c.unread} new`}>{A.unreadBadge(c.unread)}</span>}</span>
            </a>
            {h && <Stuck h={h} refresh={refresh} />}
          </div>
        );
      })}
    </div>
  );
}

/** The owner's row until the house is fully set up: how many of the three jobs are left. */
function SetupRow({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  const { left } = A.homeSetup(state, A.account(accounts, A.OWNER), link);
  if (!left) return null;
  return <a className="card nudge" href="#/settings"><span className="grow">Home setup: {left} {left === 1 ? 'thing' : 'things'} left</span><b>›</b></a>;
}

/** Needs you as one compact list: a number, the face, the subject, one plain line. A row opens the review sheet;
 *  nothing commits from Home. At most three rows, then "N more", which expands in place. */
function NeedsRows({ state, cards, quiet }: { state: Json; cards: A.Card[]; quiet?: boolean }) {
  const crew = A.crew(state);
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, 3);
  return (
    <>
      {shown.map((c, i) => (
        <a key={c.id} className="needs-row" href={`#/ask/${c.id}`}>
          <span className="n" aria-hidden>{i + 1}</span>
          <Face who={crew.find((h) => h.id === c.helper) ?? { kind: 'pip', name: c.helper }} size={24} />
          <span className="grow"><b>{c.head}</b><span className="mute small clamp1">{c.words}</span></span>
          <span className="mute" aria-hidden>›</span>
        </a>
      ))}
      {!all && cards.length > 3 && <button className="link needs-more" onClick={() => setAll(true)}>{cards.length - 3} more {cards.length - 3 === 1 ? 'needs' : 'need'} you</button>}
      {quiet && (all || cards.length <= 3) && <div className="mute small needs-quiet">Nothing else needs you.</div>}
    </>
  );
}

function Home({ state, me, refresh, tick, accounts, offline, night }: Ctx) {
  const listen = useListen();
  const ctx: Ctx = { state, me, tick, refresh, night, offline, accounts };
  const cards = A.needsYou(state);
  const works = A.work(state).filter((w) => !w.waiting);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const todays = A.things(state).filter((t) => t.at >= day.getTime());
  const g = A.account(accounts, me);
  const toChief = async (t: string) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) { refresh(); go('#/chief'); } return ok; };
  return (
    <div className="home">
      <div className="desk-col">
        {/* The phone's Home is Chats: one header row — his face, her greeting — then Needs you, search, the list. */}
        <header className="home-head phone-only">
          <span className="face" style={{ width: 32, height: 32, background: '#fff7e8' }}><ChiefArt mood={A.chief(state, chiefLocal(ctx, listen)).mood} d={1.6} /></span>
          <h1>{A.greeting()}, {state.person.address ?? state.person.name}</h1>
        </header>
        {(g.state === 'signed-out' || g.notIncluded) && <AccountCard me={me} owner={ownerName(state)} isOwner={me === A.OWNER} g={g} onReady={refresh} />}
        {state.person.id === A.OWNER && <SetupRow state={state} accounts={accounts} tick={tick} />}
        {A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. I'll pick things back up then.</span></div>}
        {A.gettingReady(state) && <div className="card nudge"><span className="grow">{A.gettingReady(state)}</span></div>}
        {A.update(state) && <div className="card nudge"><span className="grow">{A.update(state)!.words}</span><a className="btn go" href={A.update(state)!.url} target="_blank" rel="noreferrer">Download</a></div>}
        {cards.length > 0 && <section className="card needs-card phone-only" aria-label="Needs you"><NeedsRows state={state} cards={cards} /></section>}
        <div className="phone-only"><Chats state={state} refresh={refresh} /></div>
        <h1 className="hi desk-only">{A.greeting()}, {state.person.address ?? state.person.name}</h1>
        <div className="desk">
          <section className="frame needs">
            <div className="label ascii">Needs you</div>
            {cards.length ? <NeedsRows state={state} cards={cards} quiet /> : <div className="frame-empty">All clear. Nothing needs you.</div>}
          </section>
          <div className="desk-side">
            <section className="frame working">
              <div className="label ascii">Working now</div>
              {works.length ? works.map((w) => {
                const h = A.crew(state).find((x) => x.id === w.helper);
                return (
                  <a key={w.helper} className="frame-row" href={hrefOf(w.helper)}>
                    {h && <Face who={h} size={40} ring={h.ring} />}
                    <span className="grow"><b>{w.title}</b><div className="mute small clamp1">{w.line}</div></span>
                    <span className="ascii mark-ok" aria-label="working">●</span>
                  </a>
                );
              }) : <div className="frame-empty">Nothing right now.</div>}
            </section>
            <section className="frame done">
              <div className="label ascii">Done today</div>
              {todays.length ? todays.map((t) => {
                const h = A.crew(state).find((x) => x.id === t.helper);
                return (
                  <div key={t.id} className="frame-row">
                    {h && <Face who={h} size={26} />}
                    <span className="grow"><b>{t.title}</b><div className="mute small clamp1">{t.summary}</div></span>
                    {t.files[0] ? <a className="btn" href={t.files[0].url} target="_blank" rel="noreferrer">Open</a> : <a className="btn" href={hrefOf(t.helper)}>Open</a>}
                  </div>
                );
              }) : <div className="frame-empty">Nothing yet today.</div>}
            </section>
          </div>
        </div>
      </div>
      <div className="dock">
        <div className="desk-col">
          <Composer placeholder="Ask Chief anything…" onSend={toChief} {...typeInto('chief')} />
        </div>
      </div>
    </div>
  );
}
const ownerName = (state: Json) => state.members.find((m: Json) => m.id === A.OWNER)?.name ?? 'the owner';

/** The starters live in Chief's empty chat: a tap fills the box with the words, it never sends. */
function ChiefIdeas({ state, chat, picked }: { state: Json; chat: string; picked: () => void }) {
  return <div className="chips center">{A.ideas(state).map((i: Json) => (
    <button key={i.bot + i.label} className="chip" onClick={() => { keepDraft(chat, i.ask); picked(); }}>✦ {i.label}</button>
  ))}</div>;
}

// ---------- a chat ----------
function Chat({ id, m, state, me, tick, refresh, accounts }: Ctx & { id: string; m?: string }) {
  const g = A.account(accounts, me);
  const [page, setPage] = useState<Json>(null);
  const [seed, setSeed] = useState(0); // a starter chip fills the box from outside; remount reads the draft back
  // A search landing on an old line loads a window around it; once you send, the anchor goes and the thread reads to the end.
  const [around, setAround] = useState(m ? Number(m.slice(1)) : 0);
  const load = useCallback((ar = around) => api.bot(id, ar || undefined).then(setPage).catch(() => {}), [id, around]);
  useEffect(() => { void load(); }, [load, tick]);
  const end = useRef<HTMLDivElement>(null);
  const lines = A.lines(page, id);
  const box = useRef<HTMLDivElement>(null);
  // The thread scrolls by its own column on a desk (a scrollIntoView here once dragged the whole page up with it,
  // leaving a dead band on top); the phone keeps the document scroll. An anchored landing scrolls to the line instead.
  useEffect(() => {
    if (around) return;
    if (matchMedia('(min-width: 900px)').matches) { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }
    else end.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, around]);
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
  const send = async (t: string) => { const ok = await attempt(() => api.post(id, t), undefined, true); if (ok) { setAround(0); void load(0); refresh(); } return ok; };
  const name = h?.name ?? 'Chief';
  return (
    <div className={`chat${live && h ? ' with-live' : ''}`}>
      <div className="lines" ref={box}>
        {!lines.length && page && <div className="mute center empty">Say hello to {name}. Ask for anything, in your own words.
          {id === 'chief' && <ChiefIdeas state={state} chat={id} picked={() => setSeed((n) => n + 1)} />}
        </div>}
        {lines.map((l) => (
          <div key={l.id} id={`m${l.id}`} className={`line ${l.from}${l.unsure ? ' unsure' : ''}`}>
            {l.from === 'chief' && <span className="who">Chief</span>}
            {l.text && <div className="bubble-text">{l.text}</div>}
            {l.files.map((f) => <Media key={f.url} f={f} big />)}
          </div>
        ))}
        {last?.choices.length ? <div className="chips">{last.choices.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div> : null}
        <div className="thread-side">
          {trail.length > 0 && <Steps steps={trail} />}
          {cards.map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={h?.name} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} who={h} onDone={refresh} />)}
        </div>
        {h && <Stuck h={h} refresh={refresh} />}
        {(g.state === 'signed-out' || g.notIncluded) && <AccountCard me={me} owner={ownerName(state)} isOwner={me === A.OWNER} g={g} inChat onReady={() => { void load(); refresh(); }} />}
        {g.state === 'ready' && !g.notIncluded && A.resting(state) && <div className="card nudge"><span className="grow">{A.resting(state)}. {name === 'Chief' ? "I'll" : `${name} will`} finish then.</span></div>}
        <div ref={end} className="end" />
      </div>
      <aside className="working-on">
        {live && h && <section className="frame working-on-frame">
          <div className="label ascii">Working on</div>
          <div className="frame-row head"><Face who={h} size={32} ring={h.ring} /><span className="grow"><b>{h.name}</b><div className="mute small clamp1">{A.plain(live.title)}</div></span></div>
          {trail.length > 0 && <Steps steps={trail} max={7} />}
          {cards.map((c) => c.kind === 'connect' ? <ConnectCard key={c.id} c={c} helper={h?.name} state={state} onDone={refresh} /> : <AskCard key={c.id} c={c} who={h} onDone={refresh} />)}
        </section>}
      </aside>
      <div className="dock"><Composer key={seed} placeholder={id === 'chief' ? 'Ask Chief anything…' : `Message ${name}…`} onSend={send} {...typeInto(id)} /></div>
    </div>
  );
}

function ChiefPage(ctx: Ctx & { m?: string }) {
  const { mood, line } = A.chief(ctx.state, chiefLocal(ctx, useListen()));
  return (
    <div className="page chat-page">
      <header className="chat-head sticky-top"><a href="#/" className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a><span className="face" style={{ width: 44, height: 44, background: '#fff7e8' }}><ChiefArt mood={mood} d={2.1} /></span>
        <div className="grow"><b>Chief</b><div className="mute small clamp1">{line}</div></div></header>
      <Chat {...ctx} id="chief" m={ctx.m} />
    </div>
  );
}

// ---------- the crew ----------
function Crew(ctx: Ctx) {
  const { state } = ctx;
  const c = A.chief(state, chiefLocal(ctx));
  return (
    <div className="page">
      <h1>Your crew</h1>
      <p className="lead">Everyone answers to Chief. Tap a helper to chat, or add one for something new.</p>
      <div className="grid">
        <a className="card pal-card" href="#/chief"><span className="halo"><ChiefArt mood={c.mood} d={4} /></span><b>Chief</b><Pill tone={c.tone}>{c.line}</Pill><span className="mute small">Runs the crew and answers to you</span></a>
        {A.crew(state).map((h) => (
          <a key={h.id} className="card pal-card" href={hrefOf(h.id)}>
            <span className="halo"><PalArt kind={h.kind} mood={h.mood} d={5} name={h.name} /></span>
            <b>{h.name}</b>
            <Pill tone={h.ring === 'needs' ? 'wait' : h.ring ? 'ok' : 'off'}>{h.status}</Pill>
            <span className="mute small">{h.role}</span>
          </a>
        ))}
        <a className="card pal-card add" href="#/crew/add"><span className="face add" style={{ width: 64, height: 64 }}>+</span><b>Add a helper</b><span className="mute small">Pick one, or tell Chief what you need</span></a>
      </div>
    </div>
  );
}

function AddHelper({ state, refresh }: Ctx) {
  const [names, setNames] = useState<Record<string, string>>({});
  const welcome = async (t: Json) => {
    const name = (names[t.id] ?? t.name).trim() || t.name;
    let id = '';
    if (await attempt(async () => { id = (await api.recruit(t.id, name)).id; }, `${name} joined the crew`)) { refresh(); go(`#/h/${id}`); }
  };
  return (
    <div className="page">
      <a href="#/crew" className="back">‹ Crew</a>
      <h1>Add a helper</h1>
      <p className="lead">Each helper has its own little computer at home and gets better as it learns what you like. It always asks before sending, paying or deleting anything.</p>
      <div className="grid">
        {A.gallery(state).map((t: Json) => (
          <div key={t.id} className="card pal-card">
            <span className="halo"><PalArt kind={t.kind} mood="happy" d={5} name={t.name} /></span>
            <span className="mute">{t.does}</span>
            <input className="input center" value={names[t.id] ?? t.name} onChange={(e) => setNames({ ...names, [t.id]: e.target.value })} aria-label={`Name for ${t.name}`} />
            <button className="btn go" onClick={() => welcome(t)}>Welcome {(names[t.id] ?? t.name) || t.name}</button>
          </div>
        ))}
      </div>
      <div className="card"><b>Need something else?</b><p className="mute">Tell Chief in your own words, like "I need help with the kids' school stuff", and he'll find the right helper.</p>
        <Composer placeholder="Tell Chief what you need help with…" onSend={async (t) => { const ok = await attempt(() => api.post('chief', t), undefined, true); if (ok) go('#/chief'); return ok; }} {...typeInto('chief')} /></div>
    </div>
  );
}

function HelperPage(ctx: Ctx & { id: string; tab: string }) {
  const { id, tab, state, tick, refresh, offline } = ctx;
  const h = A.crew(state).find((x) => x.id === id);
  const [page, setPage] = useState<Json>(null);
  const load = useCallback(() => api.bot(id).then(setPage).catch(() => {}), [id]);
  useEffect(() => { void load(); }, [load, tick]);
  if (!h) return <div className="page mute">{state.bots.some((b: Json) => b.id === id) ? '' : 'This helper has left the crew.'}</div>;
  const b = state.bots.find((x: Json) => x.id === id);
  // The chat is the page; everything else lives behind Details. Old deep links to a section land on Details too.
  const details = tab !== 'chat' && tab !== 'did' && tab !== 'screen';
  const trail = page ? A.steps(page.trail ?? [], b?.task?.id, true) : [];
  return (
    <div className={`page helper ${tab === 'chat' ? 'chat-page' : ''}`}>
      {tab === 'chat' && <>
        <div className="sticky-top">
          <header className="chat-head">
            <a href="#/" className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
            <Face who={h} size={48} ring={h.ring} />
            <div className="grow"><b>{h.name}</b><div className="mute small clamp1">{h.status}</div></div>
            {b?.task && <button className="btn" onClick={() => confirm(`Stop ${h.name}'s job?`) && attempt(async () => { await api.reset(id); refresh(); }, `Stopped ${h.name}`)}>Stop</button>}
            <button className="link" onClick={() => go(`#/h/${id}/details`)}>Details</button>
          </header>
        </div>
        <Chat key={id} {...ctx} id={id} />
      </>}
      {details && <>
        <div className="sticky-top">
          <header className="chat-head">
            <a href={`#/h/${id}/chat`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
            <Face who={h} size={40} ring={h.ring} />
            <div className="grow"><b>{h.name}</b><div className="mute small clamp1">{h.status}</div></div>
            <button className="link" onClick={() => go(`#/h/${id}/chat`)}>Chat</button>
          </header>
        </div>
        <section className="detail">
          <h2 className="plate">What {h.name} is doing</h2>
          {b?.task ? (trail.length ? <Steps steps={trail} max={7} /> : <p className="mute">Working on “{A.plain(b.task.title)}”. Steps show as they happen.</p>)
            : <p className="mute">Nothing right now.</p>}
          <a className="link" href={`#/h/${id}/did`}>Every step</a>
          <h2 className="plate">Things</h2>
          <ThingsGrid list={A.things(state).filter((t) => t.helper === id)} state={state} empty={`${h.name}'s finished work shows up here.`} />
          <h2 className="plate">Routines</h2>
          <RoutineList {...ctx} bot={id} />
          <h2 className="plate">About {h.name}</h2>
          {page && <AboutMe id={id} name={h.name} page={page} reload={load} />}
          <h2 className="plate">What {h.name} remembers</h2>
          {page && <Remembers id={id} name={h.name} page={page} reload={load} />}
          {h.computer && <>
            <h2 className="plate">See {h.name}'s screen</h2>
            <Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} />
          </>}
        </section>
      </>}
      {tab === 'did' && (page ? <>
        <div className="sticky-top"><header className="chat-head">
          <a href={`#/h/${id}/details`} className="back" aria-label="Back" onClick={(e) => { e.preventDefault(); back(); }}>‹</a>
          <div className="grow"><b>Every step</b></div>
        </header></div>
        <p className="lead">Every step {h.name} takes, as it happens. Recorded by Crewhouse, not remembered by {h.name}.</p>
        {A.steps(page.trail ?? []).length ? <Steps steps={A.steps(page.trail ?? [])} max={40} onUndo={(s) => attempt(async () => { await api.undoMemory(id, s.seq); void load(); }, 'Forgotten')} />
          : <div className="card empty">Nothing yet. Give {h.name} something to do.</div>}
      </> : null)}
      {tab === 'screen' && <Screen bot={{ ...page?.bot, ...b }} showing={A.showing(state, id)} refresh={() => { refresh(); void load(); }} />}
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
      <p className="lead">What {name} has learned about how you like its work. It reads this every time it starts a job for you. Others in the house have their own.</p>
      <label className="card toggle"><span className="grow"><b>Remember things</b><div className="mute small">{page.memory === false ? `${name} starts fresh every time.` : `${name} keeps notes on what you like.`}</div></span>
        <input type="checkbox" role="switch" checked={page.memory !== false} onChange={(e) => attempt(async () => { await api.settings(id, { memory: e.target.checked }); reload(); })} /></label>
      <MemoryList notes={page.notes ?? ''} save={async (t) => { await api.notes(id, t); reload(); }}
        empty={`Nothing yet. ${name} adds a line when it learns something you like.`} placeholder={`Tell ${name} something to keep in mind`} />
    </>
  );
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
      <p className="mute small">What the whole crew knows about you. Every helper reads it before a job for you; nobody else in the house sees it.</p>
      <MemoryList notes={notes} save={async (t) => { await api.setAbout(t); await load(); }}
        empty="Nothing yet. Tell Chief things like “we're vegetarian” and the whole crew will know." placeholder="For example: we're vegetarian" />
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
  return (<div className="page"><h1>Things</h1><p className="lead">Everything the crew has made for you.</p><ThingsGrid list={list} state={state} empty="Videos, lists, letters and plans the crew makes for you land here." /></div>);
}

// ---------- routines ----------
function RoutineList({ state, refresh, bot }: Ctx & { bot?: string }) {
  const crew = A.crew(state);
  const list = A.routines(state, bot);
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <>
      {list.map((r: Json) => <RoutineRow key={r.id} r={r} h={crew.find((x) => x.id === r.helper)} act={act} />)}
      {!list.length && <div className="card empty">Nothing on a schedule yet.</div>}
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
          {when === null ? <button className="link line-when" onClick={() => setWhen(r.when)}>
            {r.watching ? `Keeps an eye on ${r.watching} · ` : ''}{r.when}{r.paused ? ' · paused' : ` · next ${r.next}`}{r.quiet && !r.watching ? " · stays quiet if there's nothing" : ''}
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
        <button className="btn" onClick={() => act(() => api.runRoutine(r.id), 'Started')}>Do it now</button>
        <button className="btn" onClick={() => act(() => api.routine(r.id, { state: r.paused ? 'on' : 'paused' }))}>{r.paused ? 'Resume' : 'Pause'}</button>
        {!r.digest && !r.watching && <button className={`chip ${r.quiet ? 'on' : ''}`} aria-pressed={r.quiet} onClick={() => act(() => api.routine(r.id, { quiet: !r.quiet }), r.quiet ? 'It will always report back' : "It will only speak up when something's up")}>Only tell me if something's up</button>}
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
  return (<div className="page"><h1>Routines</h1><RoutineAsk /><RoutineList {...ctx} /></div>);
}

// ---------- settings ----------
/** Settings, Phones: pair the phone app by its camera, see each phone, take one away. Only this computer can. */
function Phones({ tick }: { tick: number }) {
  const [phones, setPhones] = useState<Json[] | null | undefined>(undefined);
  const [link, setLink] = useState<Json>(null);
  const [offer, setOffer] = useState<Json>(null);
  const [qr, setQr] = useState('');
  const [typed, setTyped] = useState<Json>(null);
  const [relay, setRelay] = useState<string | null>(null);
  const [enrol, setEnrol] = useState('');
  const [now, setNow] = useState(Date.now());
  const load = () => Promise.all([api.phones(), api.phoneLink()]).then(([p, l]) => { setPhones(p); setLink(l); }).catch(() => setPhones(null));
  useEffect(() => { void load(); }, [tick]);
  useEffect(() => { if (offer) QRCode.toString(offer.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setQr); }, [offer]);
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
            <span className="grow"><b>{p.name}</b><div className="mute small">{p.role === 'view' ? 'Can watch, not answer' : 'Can answer and give jobs'}{p.person ? ` · ${p.person}'s` : ''} · {p.online ? 'with you now' : `last seen ${A.clock(p.seen)}`}</div>
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
          <p className="mute small">{a.role === 'view' ? 'It will watch the crew but not answer or give jobs.' : 'It will answer the crew and give them jobs, as you.'}</p>
          <div className="btns">
            <button className="btn go" onClick={() => attempt(async () => { await api.answerPhone(a.id, true); await load(); })}>Yes, the words match</button>
            <button className="btn" onClick={() => attempt(async () => { await api.answerPhone(a.id, false); await load(); }, `${a.name} was turned away`)}>No</button>
          </div>
        </div>
      ))}
      {offer && !link.asking.length && (
        <div className="card pair">
          {left > 0 ? <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="qr expired">This code ran out.</div>}
          <div className="grow">
            <b>Scan this with the Crewhouse app</b>
            <p className="mute small">{offer.role === 'view' ? 'This phone will watch the crew but not answer or give jobs.' : 'This phone will answer the crew and give them jobs, as you.'}</p>
            <p className="mute small">Then check the two words the phone shows against the ones that appear here.</p>
            <p className="mute small">{left > 0 ? `Works once, for ${left} more seconds.` : 'Make a new one when the phone is ready.'}</p>
            {left > 0 && A.reach(link).online && (typed ? <p className="small">On the phone, tap <b>Type a code</b> and enter <b>{typed.short}</b>, then <b>{typed.code}</b>.</p>
              : <button className="link inline small" onClick={() => attempt(async () => setTyped(await api.phoneCode(offer.role)))}>Can't scan? Type a code instead</button>)}
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
        <p className="mute small"><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Get Tailscale ↗</a> · Free for a family. Tailscale sees which devices are yours, never what they say.</p>
      </div>
      <details className="card" open={!!link.relay}><summary className="small">Other ways: a relay you run yourself</summary>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { setLink(await api.phoneRelay((relay ?? link.relay).trim(), enrol)); setRelay(null); setEnrol(''); }, 'Saved'); }}>
        <p className="mute small">{A.reach(link).words}</p>
        <p className="mute small">A relay passes messages between your phones and this computer, so this computer opens nothing to the internet. <a href="https://github.com/umeranjum17/crewhouse/blob/main/relay/README.md" target="_blank" rel="noreferrer">Run your own ↗</a></p>
        <input className="input" value={relay ?? link.relay ?? ''} onChange={(e) => setRelay(e.target.value)} placeholder="Relay address, like https://relay.example.com" aria-label="Relay address" autoComplete="off" />
        <input className="input" value={enrol} onChange={(e) => setEnrol(e.target.value)} placeholder="Invitation, if the relay gave you one" aria-label="Invitation" autoComplete="off" />
        <div className="btns"><button className="btn go" disabled={relay === null && !enrol}>Save</button>
          {!!link.relay && <button type="button" className="btn ghost" onClick={() => attempt(async () => setLink(await api.phoneRelay('')), 'Turned off')}>Turn off</button>}</div>
      </form></details>
    </>)}
  </>);
}

/** Owner only: the house's three setup jobs, and where each one is finished. The family never sees Google's own
 *  words here — those live inside the Google panel alone. */
function HomeSetup({ state, accounts, tick }: { state: Json; accounts: Json[] | null; tick: number }) {
  const [link, setLink] = useState<Json>(null);
  useEffect(() => { api.phoneLink().then(setLink).catch(() => {}); }, [tick]);
  const { rows, left } = A.homeSetup(state, A.account(accounts, A.OWNER), link);
  const jump = (key: string) => document.getElementById(`setup-${key}`)?.scrollIntoView({ behavior: 'smooth' });
  return (<>
    <div className="label">Home setup</div>
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

function Settings({ state, me, refresh, tick, accounts, look, setLook, switchTo }: Ctx & { look: string; setLook: (l: string) => void; switchTo: (id: number) => void }) {
  const [signing, setSigning] = useState<Window | null | false>(sheet === 'signin' ? null : false);
  const [adding, setAdding] = useState('');
  const owner = state.person.id === A.OWNER;
  const act = (fn: () => Promise<unknown>, ok?: string) => attempt(async () => { await fn(); refresh(); }, ok);
  return (
    <div className="page settings">
      <h1>Settings</h1>
      <p className="mute small">{A.atHome().join(' ')}</p>
      {owner && <HomeSetup state={state} accounts={accounts} tick={tick} />}
      {state.members.length > 1 && (<><div className="label">Who's using this screen</div>
        <div className="chips">{state.members.map((m: Json) => <button key={m.id} className={`chip ${m.id === me ? 'on' : ''}`} onClick={() => switchTo(m.id)}>{m.name}</button>)}</div></>)}

      <div className="label">Your ChatGPT</div>
      {A.AIS.map((ai) => {
        const g = A.account(accounts, me, ai.key);
        return (
          <div key={ai.key} className="card row">
            <span className="app-ic" style={{ background: '#10a37f' }}>◎</span>
            <div className="grow"><b>{ai.name}</b><div className="mute small">{g.state === 'ready'
              ? g.notIncluded ? "Your plan doesn't include helpers yet." : `Connected${g.work ? ` as ${g.work}, a work account` : ''}. The crew can think with it.${g.resting ? ` ${g.resting}.` : ''}`
              : g.state === 'checking' ? 'Checking…' : `Not signed in. You'll say yes once on ${ai.name}; it calls the access your helpers use “Codex”.`}</div></div>
            {g.state === 'signed-out' && <button className="btn go" onClick={() => setSigning(openTab())}>Sign in</button>}
            {g.state === 'ready' && <button className="btn" onClick={() => attempt(async () => { await api.signOut(me, ai.key); refresh(); }, `Signed out of ${ai.name}`)}>Sign out</button>}
          </div>
        );
      })}

      <div className="label">How much of it the crew may use</div>
      <div className="seg">{A.SHARES.map((o) => <button key={o.key} className={A.share(state).choice === o.key ? 'on' : ''} title={o.says}
        onClick={() => act(() => api.person(me, { share: o.key }), o.says)}>{o.label}</button>)}</div>
      <p className="mute small">{A.SHARES.find((o) => o.key === A.share(state).choice)?.says}. {A.share(state).today} {A.share(state).week}</p>

      <AboutYou key={me} tick={tick} />

      <div className="label">Your apps</div>
      <a className="card row" href="#/apps"><span className="app-row">{A.apps(state).slice(0, 5).map((a) => <span key={a.id} className="app-ic sm" style={{ background: a.bg }}>{a.mark}</span>)}</span><span className="grow mute">{A.apps(state).filter((a) => a.on).length} connected</span><b>›</b></a>

      <div className="label">People in this house</div>
      {state.members.map((m: Json) => <Person key={m.id} m={m} you={m.id === me} act={act} />)}
      {owner && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) void act(async () => { await api.addPerson(adding.trim()); setAdding(''); }, `${adding.trim()} is in`); }}>
          <input className="input grow" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add someone: their name" aria-label="Add someone" />
          <button className="btn go" disabled={!adding.trim()}>Add</button>
        </form>
      )}

      <Phones tick={tick} />

      <div className="label">Look</div>
      <div className="seg">{[['auto', 'Evenings dark'], ['day', 'Day'], ['night', 'Night']].map(([k, l]) => <button key={k} className={look === k ? 'on' : ''} onClick={() => setLook(k)}>{l}</button>)}</div>
      {owner && <Money state={state} refresh={refresh} />}
      {owner && <HouseGoogle on={!!state.house?.google} steps={state.house?.steps} refresh={refresh} />}
      {signing !== false && <SignIn me={me} owner={ownerName(state)} tab={signing} onReady={() => { setSigning(false); refresh(); }} onClose={() => setSigning(false)} />}
    </div>
  );
}

/** Owner only: the house's monthly money cap. Helpers ask before every spend; past this they can't spend at all. */
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

/** Owner only: switch Google on for the house, once. Each step opens the Google page it happens on, in turn, and the
 *  last one ends with two things to paste here (docs/google-setup.md has the same steps with the why). */
function HouseGoogle({ on, steps, refresh }: { on: boolean; steps?: A.GoogleStep[] | null; refresh: () => void }) {
  const [edit, setEdit] = useState(false);
  const [step, setStep] = useState(0);
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const last = step === A.GOOGLE_STEPS.length - 1;
  const s = A.GOOGLE_STEPS[step];
  return (<>
    <div className="label" id="setup-google">Google for the house</div>
    {on && !edit ? <div className="card">
        <div className="row"><span className="grow"><b>{A.googleHeadline(steps)}</b><div className="mute small">What Google itself has answered so far. Steps nobody has tried yet say “you said done”.</div></span>
          <button className="btn" onClick={() => { setEdit(true); setStep(A.GOOGLE_STEPS.length - 1); }}>Change key</button></div>
        {steps?.map((m, i) => <div key={i} className="row">
          <span className="grow"><b>{i + 1}. {A.GOOGLE_STEPS[i].title}</b> <span className={m.state === 'checked' ? 'ok' : m.state === 'missing' ? 'warn-line' : 'mute'}>{A.STEP_MARK[m.state]}</span><div className="mute small">{m.note}</div></span>
          {m.state === 'missing' && <a className="btn go" href={A.GOOGLE_STEPS[i].url} target="_blank" rel="noreferrer">Open Google's page</a>}
        </div>)}
      </div>
      : <form className="card form" onSubmit={(e) => { e.preventDefault(); void attempt(async () => { await api.houseGoogle(id, secret); setEdit(false); refresh(); }, 'Google is on for the house'); }}>
        <b>Switch Google on, once for everyone</b>
        <p className="mute small">About twenty minutes on Google's own pages, free. Then anyone here can let a helper use their Calendar, Gmail or Drive with one tap.</p>
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

function Person({ m, you, act }: { m: Json; you: boolean; act: (fn: () => Promise<unknown>, ok?: string) => unknown }) {
  const [address, setAddress] = useState(m.address ?? '');
  useEffect(() => setAddress(m.address ?? ''), [m.address]);
  const [from, to] = (m.quiet ?? '22:00-07:00').split('-');
  return (
    <div className="card person">
      <div className="row">
        <span className="initial">{(m.name ?? '?')[0]}</span>
        <div className="grow"><b>{m.name}</b>{you && <span className="tag">you</span>}{m.id === A.OWNER && <span className="tag">owner</span>}
          <div className="mute small">{m.address ? `Chief calls ${you ? 'you' : 'them'} “${m.address}”` : `Chief will say hello the first time ${you ? 'you open' : 'they open'} Crewhouse`}</div></div>
      </div>
      <label className="field">Chief calls {you ? 'you' : 'them'}
        <input className="input" value={address} placeholder="sir, ma'am, or a name" onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() && address !== m.address && act(() => api.person(m.id, { address }), 'Saved')} /></label>
      <label className="toggle-row"><span className="grow">Quiet hours{m.quiet ? `, ${from} to ${to}` : ''}<div className="mute small">Nothing new pings {you ? 'you' : 'them'} then; the crew keeps going on what's already OK.</div></span>
        <input type="checkbox" role="switch" checked={!!m.quiet} onChange={(e) => act(() => api.person(m.id, { quiet: e.target.checked ? '22:00-07:00' : null }))} /></label>
    </div>
  );
}

function Apps({ state, refresh }: Ctx) {
  const list = A.apps(state);
  const on = list.filter((a) => a.on);
  const [connecting, setConnecting] = useState<{ app: A.App; tab: Window | null } | null>(null);
  return (
    <div className="page">
      <a href="#/settings" className="back">‹ Settings</a>
      <h1>Your apps</h1>
      <div className="chief-says"><Face who="chief" size={34} /><span>No need to do this now. When a helper needs an app, it will ask right there in the chat.</span></div>
      <div className="apps">
        {list.map((a) => (
          <button key={a.id} className={`card app ${a.on ? 'on' : ''}`} onClick={() => a.on
            ? confirm(`Disconnect ${a.name}? Your helpers will stop using it.`) && attempt(async () => { await api.disconnect(a.id); refresh(); }, `${a.name} disconnected`)
            : setConnecting({ app: a, tab: A.needsHouse(state, a) ? null : openTab() })}>
            <span className="app-ic" style={{ background: a.bg }}>{a.mark}</span><b>{a.name}</b><span className={a.on ? 'ok' : 'mute'}>{a.on ? '✓ On' : 'Tap to add'}</span>
          </button>
        ))}
      </div>
      {on.map((a) => <div key={a.id} className="card"><b>{a.name} is on.</b> {a.does} <span className="mute">Turn it off any time.</span></div>)}
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

/** The sidebar's CHIEF frame: the full 22-dot cut, his laptop while he works, and his status line. The one hero on a
 *  desktop screen; every other Chief face is still. */
function ChiefFrame({ ctx, on }: { ctx: Ctx; on: boolean }) {
  const listen = useListen();
  const { mood, line } = useHeld(A.chief(ctx.state, chiefLocal(ctx, listen)));
  return (
    <a href="#/chief" className={`chief-frame ${on ? 'on' : ''}`}>
      <div className="label ascii">Chief</div>
      <ChiefArt mood={mood} d={4.5} hero />
      {mood === 'work' && <Laptop />}
      <div className="chief-line"><span className="art" aria-hidden>▸ </span><span>{line}</span><span className={`cur${mood === 'work' ? ' live' : ''}`} aria-hidden /></div>
    </a>
  );
}

/** The crew room's wall: every helper, one line each, with a search above. */
function SideCrew({ state, view, id }: { state: Json; view: View; id?: string }) {
  const [q, setQ] = useState('');
  const rows = A.chats(state).filter((c) => c.who !== 'chief');
  const shown = q.trim() ? rows.filter((c) => (c.name + ' ' + c.line).toLowerCase().includes(q.trim().toLowerCase())) : rows;
  return (
    <>
      <div className="label ascii">Crew</div>
      <input className="input side-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
      {shown.map((c) => (
        <a key={c.id} href={hrefOf(c.id)} className={`side-row ${id === c.id ? 'on' : ''}`}><Face who={c.who as A.Helper} size={32} ring={c.ring} /><span className="grow"><b>{c.name}</b><span className="mute small clamp1">{c.line}</span></span>{c.unread > 0 && <span className="badge">{A.unreadBadge(c.unread)}</span>}</a>
      ))}
      {!shown.length && <div className="mute small side-blank">Nobody by that name.</div>}
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
  const [me, setMe] = useState(() => { const id = Number(localStorage.getItem('crewhouse.member')) || 1; setMember(id); return id; });
  const switchTo = useCallback((id: number) => { localStorage.setItem('crewhouse.member', String(id)); setMember(id); setMe(id); }, []);
  const refresh = useCallback(() => {
    api.state().then((s) => { setState(s); setOffline(false); heard.current = Date.now(); }).catch(() => setOffline(true));
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const onHash = () => { moved = true; setRoute(parseRoute()); };
    addEventListener('hashchange', onHash);
    refresh();
    let pending: any;
    const stop = subscribe(() => { clearTimeout(pending); pending = setTimeout(refresh, 120); });
    const poll = setInterval(refresh, 15000); // belt and braces if the socket is quietly gone
    if (new URLSearchParams(location.search).has('celebrate')) setParty({ title: "Mum's birthday video", helper: 'reel' });
    return () => { removeEventListener('hashchange', onHash); stop(); clearInterval(poll); };
  }, [refresh]);
  useEffect(() => { refresh(); }, [me, refresh]);
  const wasOffline = useRef(false);
  useEffect(() => { if (wasOffline.current && !offline && state) toast('Back in touch with the home computer ✓'); wasOffline.current = offline; }, [offline]);
  // crewd shows the owner for an id it doesn't know (a fresh install, say); follow it.
  useEffect(() => { if (state && state.person.id !== me) switchTo(state.person.id); }, [state, me, switchTo]);
  // A job that finishes while you watch gets a little party.
  useEffect(() => {
    if (!state) return;
    const done = A.things(state);
    if (seenDone.current) { const fresh = done.find((t) => !seenDone.current!.has(t.id)); if (fresh) setParty({ title: fresh.title, helper: fresh.helper }); }
    seenDone.current = new Set(done.map((t) => t.id));
  }, [state]);
  const ctx: Ctx | null = useMemo(() => (state ? { state, me, tick, refresh, night, offline, accounts } : null), [state, me, tick, refresh, night, offline, accounts]);

  const splash = <Splash done={!!ctx || offline} />;
  if (!ctx) return <>{splash}{offline && <Unreachable retry={refresh} owner={me === A.OWNER} />}</>;
  // Every little Chief face on the page carries the mood from here, the way the night palette does.
  setChiefMood(A.chief(ctx.state, chiefLocal(ctx)).mood);
  if (!ctx.state.person.onboarded) return <>{splash}<Hello {...ctx} /><Toasts /></>;
  const v = under.current;
  const crew = A.crew(ctx.state);
  const asks = A.needsYou(ctx.state).length; // the badge counts only what Needs you shows
  const sheet = route.view === 'ask' ? A.cards(ctx.state).find((c) => String(c.id) === route.id) : undefined;
  const book = route.file && route.id ? { bot: route.id, path: route.file } : undefined;
  const nav: [string, string, string, number?][] = [['#/', 'Chats', '⌂'], ['#/crew', 'Crew', '☺'], ['#/things', 'Things', '▤'], ['#/routines', 'Routines', '↻'], ['#/settings', 'Settings', '✲']];
  const active = (h: string) => (h === '#/' ? ['home', 'helper', 'chief'].includes(v.view) : h === '#/crew' ? ['crew', 'add'].includes(v.view) : h === `#/${v.view}` || (h === '#/settings' && v.view === 'apps'));
  return (
    <>
      {splash}
      <div className={`shell ${['chief', 'helper'].includes(v.view) ? 'is-chat' : ''}`}>
        <aside className="side">
          <a href="#/" className="brand"><Logo night={night} /></a>
          <ChiefFrame ctx={ctx} on={v.view === 'chief'} />
          <SideCrew state={ctx.state} view={v.view} id={v.id} />
          <div className="grow" />
          <a href="#/settings" className="side-meter mute small">{A.meter(ctx.state)}</a>
          {nav.map(([h, l, i]) => <a key={h} href={h} className={`side-nav ${active(h) ? 'on' : ''}`}><span className="ic">{i}</span>{l}{h === '#/' && asks > 0 && <span className="badge">{asks}</span>}</a>)}
        </aside>
        <main className="main">
          {offline && <div className="offline" role="status">The home computer isn't answering. If it's asleep, the crew has paused and carries on when it wakes. Last heard from it at {A.clock(heard.current)}. Reconnecting… <button className="link inline" onClick={refresh}>Try now</button></div>}
          {v.view === 'home' && <Home {...ctx} />}
          {v.view === 'chief' && <ChiefPage {...ctx} m={v.m} />}
          {v.view === 'crew' && <Crew {...ctx} />}
          {v.view === 'add' && <AddHelper {...ctx} />}
          {v.view === 'helper' && v.id && <HelperPage {...ctx} id={v.id} tab={v.tab!} />}
          {v.view === 'things' && <Things {...ctx} id={v.id} />}
          {v.view === 'routines' && <Routines {...ctx} />}
          {v.view === 'settings' && <Settings {...ctx} look={look} setLook={setLook} switchTo={switchTo} />}
          {v.view === 'apps' && <Apps {...ctx} />}
          {v.view === 'share' && <Share {...ctx} />}
        </main>
        <nav className="tabbar">{nav.map(([h, l, i]) => <a key={h} href={h} className={active(h) ? 'on' : ''}><span className="ic">{i}</span>{l}{h === '#/' && asks > 0 && <span className="badge">{asks}</span>}</a>)}</nav>
      </div>
      {sheet && <AskSheet c={sheet} who={crew.find((h) => h.id === sheet.helper)} chiefSays={ctx.state.asks.find((a: Json) => a.id === sheet.id)?.detail?.chief} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {book && <PreviewPanel bot={book.bot} path={book.path} onClose={() => history.length > 1 ? history.back() : go('#/')} />}
      {party && <Celebrate title={party.title} href={hrefOf(party.helper)} onDone={() => setParty(null)} />}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
