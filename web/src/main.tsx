import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, setMember, subscribe, type Json } from './api.ts';
import { stateWords } from './tokens.ts';
import { Screen } from './screen.tsx';

type Route = { view: 'home' | 'chief' | 'crew' | 'needs' | 'routines' | 'activity' | 'settings' | 'bot'; id?: string; tab?: string };

function parseRoute(): Route {
  const [view, id, tab] = location.hash.replace(/^#\/?/, '').split('/');
  if (view === 'bot' && id) return { view: 'bot', id, tab: tab || 'chat' };
  return { view: (['home', 'chief', 'crew', 'needs', 'routines', 'activity', 'settings'].includes(view) ? view : 'home') as Route['view'] };
}
const go = (hash: string) => { location.hash = hash; };

// ---------- small pieces ----------
function Avatar({ bot, size = 40, status }: { bot: Json; size?: number; status?: string }) {
  const lead = bot?.id === 'chief';
  return (
    <span className={`avatar ${status ?? ''}`} style={{ width: size, height: size, background: `${bot?.color ?? '#888'}22`, color: bot?.color ?? '#888', fontSize: size * 0.42 }}>
      {lead ? '★' : (bot?.display ?? '?').slice(0, 1)}
      {status && <i className="ring" />}
    </span>
  );
}

/** One word for where a bot is, from crewd's facts only: its task, its asks and how long it has been quiet. */
function live(b: Json): [string, string] {
  if (b?.controls === 'person') return ['resting', 'You have the controls'];
  if (b?.task?.state === 'needs_you') return ['needs', 'Needs you'];
  if (b?.stuck) return ['stuck', 'Stuck?'];
  if (b?.task) return ['working', 'Working'];
  if (b?.queued) return ['queued', 'Waiting its turn'];
  if (b?.pausedUntil) return ['resting', `Resting until ${resetWords(b.pausedUntil)}`];
  return b?.state === 'on' ? ['ready', 'Ready'] : ['resting', 'Resting'];
}

function Pill({ bot }: { bot: Json }) {
  const [k, words] = live(bot);
  return <span className={`pill ${k}`}>{words}</span>;
}

/** A limit's reset time in plain words: "6:40 pm", or "Sat 6:40 pm" when it isn't today. */
function resetWords(at: any) {
  if (at == null) return '';
  const t = new Date(typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : Date.parse(at));
  if (isNaN(+t)) return '';
  const time = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return t.toDateString() === new Date().toDateString() ? time : `${t.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** The whole crew in one line, under Chief's avatar: the heartbeat of Home. */
function crewLine(state: Json) {
  const parts = state.bots.filter((b: Json) => b.task || b.queued || b.pausedUntil).map((b: Json) => {
    const [k, words] = live(b);
    return k === 'needs' ? `${b.display} needs you` : k === 'stuck' ? `${b.display} may be stuck`
      : k === 'queued' ? `${b.display} is waiting its turn` : k === 'resting' ? `${b.display} is ${words.toLowerCase()}` : `${b.display} is working`;
  });
  // crewd's own word on accounts: resting from a limit hit, or a window at 95% or more.
  const resting = Object.entries(state.resting ?? {}).filter(([, t]) => t) as [string, number][];
  if (resting.length && resting.length === Object.keys(state.resting).length) parts.unshift(`The crew is resting until ${resetWords(Math.min(...resting.map(([, t]) => t)))}`);
  else for (const [r, t] of resting) parts.unshift(`${r === 'codex' ? 'ChatGPT' : 'Claude'} is resting until ${resetWords(t)}`);
  if (parts.length) return parts.join(' · ');
  return state.bots.length > 1 ? 'All quiet. Nothing needs you.' : 'The crew is empty. Tell me what needs doing.';
}

const clock = (t: number) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};
const base = (p = '') => p.split('/').pop() || p;
const cut = (t = '', n = 70) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** One plain line per step for the "What I did" trail. The raw terminal stays behind Show the work. */
function step(e: Json): string | null {
  const d = e.data ?? {};
  switch (e.kind) {
    case 'bot.recruited': return 'Joined the crew';
    case 'task.created': return d.origin === 'chief' ? `Chief handed over “${d.title}”` : `Got a task: “${d.title}”`;
    case 'task.working': return `Started on “${d.title}”`;
    case 'task.progress': return d.text;
    case 'run.tool': {
      const s = d.summary ?? '';
      if (d.tool === 'Bash') return /^crew (report|deliver|remember)/.test(s) ? null : `Ran a command: ${cut(s, 60)}`;
      if (d.tool === 'Read') return `Read ${base(s)}`;
      if (d.tool === 'Write') return `Wrote ${base(s)}`;
      if (d.tool === 'Edit') return `Changed ${base(s)}`;
      if (d.tool === 'WebSearch') return `Searched the web for “${cut(s)}”`;
      if (d.tool === 'WebFetch') { try { return `Read a page on ${new URL(s).hostname}`; } catch { return 'Read a web page'; } }
      if (d.tool === 'Grep' || d.tool === 'Glob') return `Looked through files for “${cut(s, 40)}”`;
      if (/^mcp__browser__/.test(d.tool)) return `Used its browser: ${d.tool.replace(/^mcp__browser__browser_/, '').replace(/_/g, ' ')}${s ? ` ${cut(s, 50)}` : ''}`;
      return `Used ${d.tool}`;
    }
    case 'run.allowed': return `Went ahead with ${cut(d.summary, 50)}, as you allowed`;
    case 'run.typed': return 'You took over and typed into the terminal';
    case 'ask.opened': return d.kind === 'permission' ? `Asked your leave to ${String(d.title ?? `use ${d.tool}`).replace(/^.* would like to /, '')}: ${cut(d.summary, 50)}` : 'Stopped at a question in its terminal';
    case 'ask.parked': return 'Paused until you answer';
    case 'ask.answered': return `You answered: ${d.answer}`;
    case 'file.delivered': return `Delivered ${d.path}${d.note ? `: ${d.note}` : ''}`;
    case 'memory.learned': return `Learned: ${d.text}`;
    case 'bot.allowed': return `You allowed ${d.covers} from now on`;
    case 'task.done': return `Finished “${d.title}”`;
    case 'task.failed': return `Stopped: ${d.result ?? d.title}`;
    default: return null;
  }
}

function Trail({ events, empty }: { events: Json[]; empty: string }) {
  // A task goes back to work after every answer; "Started on" belongs only to the first time.
  const first = new Map<number, number>();
  for (const e of events) if (e.kind === 'task.working') first.set(e.data.task, e.seq); // newest first, so the oldest wins
  const rows = events.filter((e) => e.kind !== 'task.working' || first.get(e.data.task) === e.seq).map((e) => ({ e, s: step(e) })).filter((x) => x.s);
  if (!rows.length) return <div className="muted empty">{empty}</div>;
  return (
    <ol className="trail">
      {rows.map(({ e, s }) => <li key={e.seq}><time>{clock(e.at)}</time><span>{s}</span></li>)}
    </ol>
  );
}

/** Quiet too long: Chief offers to stop it or hand over the controls. "Leave it" lasts until the bot's next step. */
const leftAlone = new Map<string, number>();
function Stuck({ bot, refresh }: { bot: Json; refresh: () => void }) {
  const [, redraw] = useState(0);
  if (live(bot)[0] !== 'stuck' || leftAlone.get(bot.id) === bot.quietSince) return null;
  const mins = Math.max(1, Math.round((Date.now() - bot.quietSince) / 60_000));
  return (
    <div className="stuck-note">
      <div><b>No news from {bot.display} for {mins} minute{mins === 1 ? '' : 's'}.</b> Shall I stop it, or would you like to take over?</div>
      <div className="row wrap">
        <button className="btn" onClick={async () => { await api.reset(bot.id); refresh(); }}>Stop {bot.display}</button>
        {/* With a desktop, Take over pauses the bot and hands you its screen; without one, its terminal. */}
        {bot.computer
          ? <button className="btn" onClick={async () => { await api.takeOver(bot.id); refresh(); go(`#/bot/${bot.id}/screen`); }}>Take over</button>
          : <a className="btn" href={`#/bot/${bot.id}/work`}>Take over</a>}
        <button className="btn quiet" onClick={() => { leftAlone.set(bot.id, bot.quietSince); redraw((n) => n + 1); }}>Leave it running</button>
      </div>
    </div>
  );
}

/** Pre-filled composer text, set by an Idea and used once by that bot's thread. */
const drafts: Record<string, string> = {};

function Dot({ state }: { state: string }) {
  const c = state === 'needs_you' || state === 'blocked' || state === 'paused' ? 'amber' : state === 'working' || state === 'queued' ? 'blue' : state === 'failed' ? 'red' : 'green';
  return <span className={`dot ${c}`} />;
}

/** "Thinks with: Claude Opus · falls back to ChatGPT"; a resting account says until when. */
function thinksWith(b: Json) {
  const t: Json[] = b.thinks ?? [];
  if (!t.length) return '';
  const rest = (x: Json) => x.restingUntil ? ` (resting until ${new Date(x.restingUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : '';
  const others = t.slice(1).map((x) => x.name + rest(x)).join(', then ');
  return `Thinks with: ${t[0].name}${rest(t[0])}${others ? ` · falls back to ${others}` : ''}`;
}

const MODEL_SUGGESTIONS = ['claude:opus', 'claude:sonnet', 'claude:haiku', 'codex', 'codex:gpt-5.5', 'codex:gpt-5-mini'];

function botStatus(b: Json) {
  if (b.controls === 'person') return 'Paused · you have the controls';
  if (b.task) return b.task.title;
  if (b.queued) return `${b.queued} waiting`;
  return b.state === 'on' ? 'Ready' : 'Resting';
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** One plain sentence per feed event; internal events return null. */
/** A tool's "asks first" rules in plain words. */
const asksLine = (asks: string[] = []) =>
  /^never/i.test(asks[0] ?? '') ? `Never asks you${asks[0].replace(/^never/i, '')}` : `Asks you first when: ${asks.join('; ')}`;

function sentence(e: Json, name: (id: string) => string, who: (id: number) => string | null): string | null {
  const b = e.bot ? name(e.bot) : '';
  const d = e.data ?? {};
  const whose = d.member && who(d.member) ? `${who(d.member)}'s ` : '';
  switch (e.kind) {
    case 'system.started': return 'Crewhouse started';
    case 'person.onboarded': return `Chief will address ${d.member && who(d.member) ? who(d.member) : 'you'} as ${d.address}`;
    case 'person.added': return `${d.name} joined the household`;
    case 'bot.recruited': return `${d.display} joined the crew${d.by === 'chief' ? ', recruited by Chief' : ''}`;
    case 'task.created': return `${b} got a task: “${d.title}”${d.origin === 'chief' ? ' from Chief' : ''}`;
    case 'task.working': return `${b} is working on “${d.title}”`;
    case 'task.needs_you': return `${b} needs you on “${d.title}”`;
    case 'task.done': return `${b} finished “${d.title}”`;
    case 'task.failed': return `${b} stopped: ${d.result ?? d.title}`;
    case 'task.progress': return `${b}: ${d.text}`;
    case 'ask.opened': return d.kind === 'permission' ? `${b} asked to use ${d.tool}: ${d.summary}` : `${b} is waiting on a question`;
    case 'ask.answered': return `You answered ${b}: ${d.answer}`;
    case 'memory.learned': return `${b} learned: ${d.text}`;
    case 'memory.edited': return `You edited what ${b} knows`;
    case 'file.delivered': return `${b} delivered ${d.path}`;
    case 'desktop.takeover': return `You took the controls of ${b}'s screen`;
    case 'desktop.giveback': return `You gave ${b} its controls back${d.note ? `: ${d.note}` : ''}`;
    case 'bot.tools': return `You changed ${b}'s tools`;
    case 'run.tool': return `${b} ${d.tool === 'Bash' ? 'ran' : /^mcp__browser__/.test(d.tool) ? `used its browser (${d.tool.replace(/^mcp__browser__browser_/, '')})` + (d.summary ? ':' : '') : 'used ' + d.tool + ':'} ${d.summary}`;
    case 'tool.installing': return `Installing ${d.tool}…`;
    case 'tool.installed': return `Installed ${d.tool}`;
    case 'tool.failed': return `Couldn't install ${d.tool}: ${d.error}`;
    case 'routine.created': return `${d.by === 'chief' ? 'Chief' : 'You'} set up a routine for ${b}: “${d.name}”, ${String(d.words).toLowerCase()}`;
    case 'routine.fired': return d.task ? `Routine “${d.name}” started ${b}${d.why === 'late' ? ', catching up after the computer slept' : d.why === 'now' ? ', as you asked' : ''}` : `Chief wrote the ${String(d.name).toLowerCase()}`;
    case 'routine.skipped': return `Routine “${d.name}” skipped a run: ${b} was still on the last one`;
    case 'routine.paused': return `You paused the routine “${d.name}”`;
    case 'routine.resumed': return `You resumed the routine “${d.name}”`;
    case 'bot.models': return `You changed which models ${b} thinks with`;
    case 'account.resting': return `${whose}${d.runtime === 'codex' ? 'ChatGPT' : 'Claude'} is resting until ${new Date(d.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    case 'task.paused': return `${b} paused “${d.title}”: ${d.result ?? ''}`;
    case 'ask.parked': return `${b} is waiting for your answer; the rest of its work is paused`;
    case 'run.allowed': return `${b} went ahead with ${d.summary}, as you allowed`;
    case 'bot.allowed': return `You allowed ${b} ${d.covers} from now on`;
    case 'run.typed': return `You took over ${b}'s terminal`;
    case 'bot.settings': return `You changed ${b}'s settings`;
    case 'account.limit': return d.fiveHour ? `Claude has used ${d.fiveHour.used}% of its 5-hour window${d.sevenDay ? ` and ${d.sevenDay.used}% of the week` : ''}` : null;
    default: return null;
  }
}

function Media({ bot, path }: { bot: string; path: string }) {
  const src = `/files/${bot}/${path.replace(/^files\//, '').split('/').map(encodeURIComponent).join('/')}`;
  if (/\.(mp4|webm)$/i.test(path)) return <video className="media" src={src} controls preload="metadata" />;
  if (/\.(png|jpe?g|webp|gif)$/i.test(path)) return <img className="media" src={src} alt={path} />;
  return <a href={src} target="_blank" rel="noreferrer">{path}</a>;
}

// ---------- asks ----------
function AskCard({ ask, bots, onDone }: { ask: Json; bots: Json[]; onDone: () => void }) {
  const bot = bots.find((b) => b.id === ask.bot);
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');
  const send = async (body: Json) => {
    setErr('');
    try { await api.answer(ask.id, body); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="card ask">
      <div className="ask-head">
        <Avatar bot={bot} size={28} />
        <span className="muted">{bot?.display}</span>
        <span className="tag">{ask.kind === 'permission' ? 'PERMISSION' : ask.kind === 'trust' ? 'FIRST RUN' : 'QUESTION'}</span>
      </div>
      <div className="ask-title">{ask.title}</div>
      {ask.kind === 'permission' ? (
        <>
          <pre className="mono small">{ask.detail.summary}</pre>
          <div className="scopes">
            <button className="btn primary" onClick={() => send({ answer: 'allow', scope: 'once' })}>Allow once</button>
            {ask.task_id && ask.detail.rule && <button className="btn" onClick={() => send({ answer: 'allow', scope: 'task' })}>For this task</button>}
            {ask.detail.rule && <button className="btn" onClick={() => send({ answer: 'allow', scope: 'always' })}>Always for {bot?.display}</button>}
            <button className="btn deny" onClick={() => send({ answer: 'deny' })}>Don't allow</button>
          </div>
          {ask.detail.spends && <p className="tiny">This can spend your money, so {bot?.display} asks you every time. Check the price cap in the command above.</p>}
          {ask.detail.covers && <p className="tiny">“For this task” and “Always” cover {ask.detail.covers}. You can take “Always” back on {bot?.display}'s Tools tab.</p>}
        </>
      ) : ask.kind === 'trust' ? (
        <>
          <p className="muted small">{ask.detail.note}</p>
          <div className="row">
            <button className="btn primary" onClick={() => send({ answer: 'allow' })}>Trust it</button>
            <button className="btn deny" onClick={() => send({ answer: 'deny' })}>Don't allow</button>
          </div>
        </>
      ) : (
        <>
          <pre className="mono small pane">{ask.detail.pane}</pre>
          <div className="row wrap">
            {['1', '2', '3'].map((k) => <button key={k} className="btn" onClick={() => send({ keys: [k] })}>{k}</button>)}
            <button className="btn" onClick={() => send({ keys: ['enter'] })}>Enter</button>
            <button className="btn" onClick={() => send({ keys: ['esc'] })}>Esc</button>
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send({ text: reply.trim() }); }}>
            <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Or type a reply…" />
            <button className="btn primary">Send</button>
          </form>
        </>
      )}
      {err && <div className="error">{err}</div>}
      <div className="muted small">waiting since {ago(ask.at)}</div>
    </div>
  );
}

// ---------- chat ----------
function Thread({ botId, state, tick, compact, refresh }: { botId: string; state: Json; tick: number; compact?: boolean; refresh: () => void }) {
  const [page, setPage] = useState<Json>(null);
  const [text, setText] = useState(() => { const d = drafts[botId] ?? ''; delete drafts[botId]; return d; });
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [byName, setByName] = useState(false);
  const load = useCallback(() => api.bot(botId).then(setPage).catch((e) => setErr(e.message)), [botId]);
  useEffect(() => { load(); }, [load, tick]);
  const box = useRef<HTMLDivElement>(null);
  // On Home the thread scrolls inside its own box, so the page stays on Chief's status line.
  useEffect(() => { if (compact) box.current?.scrollTo(0, box.current.scrollHeight); else end.current?.scrollIntoView({ block: 'end' }); }, [page?.messages?.length, compact]);

  const bot = state.bots.find((b: Json) => b.id === botId);
  const chief = state.bots.find((b: Json) => b.id === 'chief');
  const onboarding = botId === 'chief' && !state.person.onboarded;
  const send = async (t: string) => {
    if (!t.trim()) return;
    setErr('');
    setText('');
    try { onboarding ? await api.onboard(t) : await api.post(botId, t); load(); } catch (e: any) { setErr(e.message); setText(t); }
  };
  const asks = state.asks.filter((a: Json) => a.bot === botId);

  return (
    <div className={`thread ${compact ? 'compact' : ''}`}>
      <div className="messages" ref={box}>
        {(page?.messages ?? []).map((m: Json) => {
          if (m.author === 'system') {
            const file = /^Delivered (files\/.+?)(?::\s|$)/.exec(m.text)?.[1];
            return (
              <div key={m.id} className="note">
                <span>{m.text}</span>
                {file && <Media bot={botId} path={file} />}
              </div>
            );
          }
          const mine = m.author === 'person';
          const from = m.author === 'chief' ? chief : bot;
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''}`}>
              {!mine && <Avatar bot={from} size={30} />}
              <div className="bubble">
                {!mine && m.author === 'chief' && <div className="from">Chief · task #{m.task_id}</div>}
                {mine && m.task_id && botId !== 'chief' && <div className="from">Task #{m.task_id}</div>}
                {m.text}
              </div>
            </div>
          );
        })}
        {asks.map((a: Json) => <AskCard key={a.id} ask={a} bots={state.bots} onDone={refresh} />)}
        {bot?.task && <LiveCard bot={bot} refresh={refresh} />}
        <div ref={end} />
      </div>
      {onboarding && (
        <div className="row wrap quick">
          {['Sir', "Ma'am"].map((q) => <button key={q} className="btn" onClick={() => send(q)}>{q}</button>)}
          <button className="btn" onClick={() => { setByName(true); input.current?.focus(); }}>By my name…</button>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea
          ref={input}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
          placeholder={onboarding ? (byName ? 'Your name' : 'How should Chief address you?') : botId === 'chief' ? 'Ask Chief…' : `Give ${bot?.display ?? 'this bot'} a task or just chat…`}
        />
        <button className="send" aria-label="Send">➤</button>
      </form>
    </div>
  );
}

/** The bot at work, inline in its thread: status, its latest step, and the way to watch or take over. */
function LiveCard({ bot, refresh }: { bot: Json; refresh: () => void }) {
  const last = bot.step && step(bot.step);
  return (
    <div className="card live">
      <div className="row">
        <Avatar bot={bot} size={30} status={live(bot)[0]} />
        <div className="grow">
          <div><b>{bot.display}</b> <Pill bot={bot} /> <span className="muted small">{bot.task.title}</span></div>
          <div className="muted small">{last ? `${clock(bot.step.at)} · ${last}` : 'Getting started…'}</div>
        </div>
        <a className="btn" href={`#/bot/${bot.id}/${bot.computer ? 'screen' : 'work'}`}>Watch</a>
      </div>
      <Stuck bot={bot} refresh={refresh} />
    </div>
  );
}

// ---------- views ----------
function Usage({ limits, resting }: { limits: Json; resting: Json }) {
  return <Windows limits={limits?.claude} resting={resting?.claude} />;
}

/** Claude's usage windows as meters, with "resting until" once one is spent. */
function Windows({ limits: c, resting }: { limits: Json; resting: number }) {
  const rows = ([['5-hour window', c?.fiveHour], ['This week', c?.sevenDay]] as [string, Json][]).filter(([, w]) => w);
  if (!rows.length) return null;
  return (
    <div className="usage">
      {rows.map(([label, w]) => {
        const until = resetWords(w.resetsAt);
        const full = w.used >= 95 && !!resting;
        return (
          <div key={label} className="use">
            <div className="row between small"><span>Claude · {label}</span><span className="muted">{full ? `Resting until ${until || resetWords(resting)}` : `${w.used}% used${until ? ` · fresh at ${until}` : ''}`}</span></div>
            <div className={`meter ${full ? 'full' : w.used >= 80 ? 'high' : ''}`}><span style={{ width: `${Math.min(100, w.used)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Home({ state, name, tick, refresh }: { state: Json; name: (id: string) => string; tick: number; refresh: () => void }) {
  const chief = state.bots.find((b: Json) => b.id === 'chief');
  const working = state.bots.filter((b: Json) => b.task || b.queued);
  const done = state.tasks.filter((t: Json) => t.state === 'done' && Date.now() - t.updated_at < 86_400_000);
  const busy = working.some((b: Json) => b.task?.state === 'working');
  const soon = state.routines.filter((r: Json) => r.state === 'on').sort((a: Json, b: Json) => a.next_at - b.next_at).slice(0, 3);
  return (
    <div className="home">
      <header className="heartbeat">
        <Avatar bot={chief} size={56} status={state.asks.length ? 'needs' : busy ? 'working' : undefined} />
        <div className="grow">
          <h1>{greeting()}{state.person.address ? `, ${state.person.address}` : ''}</h1>
          <div className="status-line" aria-live="polite">{crewLine(state)}</div>
        </div>
      </header>
      <Usage limits={state.limits} resting={state.resting} />
      {state.asks.length > 0 && (
        <section>
          <h4>Needs you <span className="badge">{state.asks.length}</span></h4>
          {state.asks.map((a: Json) => <AskCard key={a.id} ask={a} bots={state.bots} onDone={refresh} />)}
        </section>
      )}
      <section>
        <h4>Working now</h4>
        {working.length === 0 && <div className="muted empty">Nobody is working right now.</div>}
        {working.map((b: Json) => {
          const last = b.step && step(b.step);
          return (
            <div key={b.id} className="card work">
              <a className="row" href={b.id === 'chief' ? '#/chief' : `#/bot/${b.id}`}>
                <Avatar bot={b} size={32} status={live(b)[0]} />
                <div className="grow">
                  <div><b>{b.display}</b> <Pill bot={b} /></div>
                  <div className="small">{b.task?.title ?? `${b.queued} waiting`}</div>
                  {last && <div className="muted small">{clock(b.step.at)} · {last}</div>}
                </div>
              </a>
              <Stuck bot={b} refresh={refresh} />
            </div>
          );
        })}
      </section>
      <section>
        <h4>Done today</h4>
        {done.length === 0 && <div className="muted empty">Finished work shows up here.</div>}
        {done.slice(0, 6).map((t: Json) => (
          <a key={t.id} className="card" href={`#/bot/${t.bot}`}>
            <div className="row">
              <Avatar bot={state.bots.find((b: Json) => b.id === t.bot)} size={32} />
              <div className="grow"><b>{name(t.bot)}</b> · {t.title}<div className="muted small clamp">{t.result}</div></div>
              <span className="muted small">{ago(t.updated_at)}</span>
            </div>
            {t.files.slice(0, 2).map((f: string) => <Media key={f} bot={t.bot} path={f} />)}
          </a>
        ))}
      </section>
      {soon.length > 0 && (
        <section>
          <h4>Coming up</h4>
          {soon.map((r: Json) => (
            <a key={r.id} className="card line" href="#/routines">
              <Avatar bot={state.bots.find((b: Json) => b.id === r.bot)} size={28} />
              <div className="grow"><b>{r.name}</b> <span className="muted small">· {name(r.bot)} · {r.words}</span></div>
              <span className="muted small">{clock(r.next_at)}</span>
            </a>
          ))}
        </section>
      )}
      {state.ideas.length > 0 && (
        <section>
          <h4>Ideas from the crew</h4>
          <div className="ideas">
            {state.ideas.map((i: Json) => (
              <button key={i.bot + i.ask} className="card idea" onClick={() => { drafts[i.bot] = i.ask; go(`#/bot/${i.bot}/chat`); }}>
                <Avatar bot={state.bots.find((b: Json) => b.id === i.bot)} size={28} />
                <span><b>{name(i.bot)}</b> <span className="muted">“{i.promise}”</span></span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h4>Talk to Chief</h4>
        <Thread botId="chief" state={state} tick={tick} refresh={refresh} compact />
      </section>
      <p className="tiny leaves">What leaves this computer: only what the crew sends your own AI account (Claude or ChatGPT) to do the work. Crewhouse itself sends nothing anywhere.</p>
    </div>
  );
}

function Crew({ state, refresh }: { state: Json; refresh: () => void }) {
  const [recruiting, setRecruiting] = useState(false);
  const busy = state.bots.filter((b: Json) => b.task).length;
  return (
    <div>
      <div className="head">
        <div>
          <h1>Your crew</h1>
          <div className="muted">{state.bots.length} on the crew · {busy} working · {state.asks.length} waiting on you · everyone reports to Chief</div>
        </div>
        <button className="btn primary" onClick={() => setRecruiting(true)}>＋ Add a bot</button>
      </div>
      <div className="grid">
        {state.bots.map((b: Json) => (
          <div key={b.id} className="card bot">
            <div className="row">
              <Avatar bot={b} status={live(b)[0]} />
              <div className="grow">
                <div><b>{b.display}</b> {b.id === 'chief' && <span className="lead">LEAD</span>} <Pill bot={b} /></div>
                <div className="muted small clamp">{botStatus(b)}</div>
              </div>
            </div>
            <p className="muted">{b.role}</p>
            {state.members.length > 1 && b.id !== 'chief' && <div className="tiny">Works for {state.members.find((m: Json) => m.id === (b.member ?? 1))?.name}, on their own AI accounts</div>}
            <div className="row between">
              <span className="muted tiny">{thinksWith(b)}</span>
              <a className="btn" href={b.id === 'chief' ? '#/chief' : `#/bot/${b.id}`}>Message</a>
            </div>
          </div>
        ))}
        <button className="card add" onClick={() => setRecruiting(true)}>＋ Add a bot from a template, or describe the job to Chief</button>
      </div>
      {recruiting && <Recruit state={state} onClose={() => setRecruiting(false)} onDone={(id) => { setRecruiting(false); refresh(); go(`#/bot/${id}`); }} />}
    </div>
  );
}

function Recruit({ state, onClose, onDone }: { state: Json; onClose: () => void; onDone: (id: string) => void }) {
  const [pick, setPick] = useState<Json>(state.templates[0]);
  const [name, setName] = useState(state.templates[0]?.display ?? '');
  const [err, setErr] = useState('');
  const hire = async () => {
    setErr('');
    try { const b = await api.recruit(pick.id, name); onDone(b.id); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Recruit a bot</h2>
        <p className="muted">Start from a template. You can rename it, and change what it knows later.</p>
        <div className="templates">
          {state.templates.map((t: Json) => (
            <button key={t.id} className={`card tpl ${pick?.id === t.id ? 'on' : ''}`} onClick={() => { setPick(t); setName(t.display); }}>
              <Avatar bot={{ ...t, id: t.id }} size={34} />
              <div>
                <b>{t.display}</b><div className="muted small">{t.role}</div>
                {pick?.id === t.id ? (
                  <ul className="kit">
                    {t.kit.map((k: Json) => <li key={k.id} className="tiny"><b>{k.name}</b>{k.ready ? '' : ' (not installed yet)'}: {asksLine(k.asks)}</li>)}
                  </ul>
                ) : <div className="tiny muted">tools: {t.kit.map((k: Json) => k.name).join(', ')}</div>}
              </div>
            </button>
          ))}
        </div>
        <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {err && <div className="error">{err}</div>}
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={hire} disabled={!pick || !name.trim()}>Hire {name}</button>
        </div>
      </div>
    </div>
  );
}

function BotPage({ id, tab, state, tick, refresh }: { id: string; tab: string; state: Json; tick: number; refresh: () => void }) {
  const [page, setPage] = useState<Json>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api.bot(id).then(setPage).catch((e) => setMsg(e.message)), [id]);
  useEffect(() => { load(); }, [load, tick]);
  const bot = state.bots.find((b: Json) => b.id === id);
  if (!bot || !page) return <div className="muted">{msg || 'Loading…'}</div>;
  const tabs = ['chat', 'did', 'knows', 'skills', 'tools', 'models', 'routines', 'files', 'history', 'screen', 'work'];
  const label: Record<string, string> = { did: 'What I did', work: 'Show the work', models: 'Thinks with' };
  const save = async (body: Json) => { await api.settings(id, body).catch((e) => setMsg(e.message)); load(); };
  const toggle = async (tool: string, on: boolean) => {
    const granted = page.tools.filter((t: Json) => t.granted).map((t: Json) => t.id).filter((t: string) => t !== tool);
    await api.tools(id, on ? [...granted, tool] : granted).catch((e) => setMsg(e.message));
    load();
  };
  return (
    <div className="botpage">
      <div className="head">
        <div className="row">
          <Avatar bot={bot} size={52} status={live(bot)[0]} />
          <div>
            <h1>{bot.display} <Pill bot={bot} /></h1>
            <div className="muted">{bot.task ? bot.task.title : bot.role}</div>
            <div className="muted small">{thinksWith(bot)}</div>
          </div>
        </div>
        {bot.task && <button className="btn" onClick={async () => { await api.reset(id); refresh(); }}>Stop</button>}
      </div>
      {tab !== 'chat' && <Stuck bot={bot} refresh={refresh} />}
      <nav className="tabs">
        {tabs.map((t) => <a key={t} className={t === tab ? 'on' : ''} href={`#/bot/${id}/${t}`}>{label[t] ?? t[0].toUpperCase() + t.slice(1)}</a>)}
      </nav>
      {msg && <div className="error">{msg}</div>}
      {tab === 'chat' && <Thread botId={id} state={state} tick={tick} refresh={refresh} />}
      {tab === 'did' && (
        <div className="card">
          <b>What {bot.display} did</b>
          <Trail events={page.trail} empty={`Nothing yet. Every step ${bot.display} takes shows up here, in plain words.`} />
          <p className="tiny">Recorded by Crewhouse as it happens, not recalled by {bot.display}. The raw terminal is under Show the work.</p>
        </div>
      )}
      {tab === 'knows' && (
        <div className="card">
          <div className="row between">
            <b>What {bot.display} knows</b>
            <span className="muted small">{(notes ?? page.notes).length} / {page.notesCap} characters</span>
          </div>
          <label className="row small switch">
            <input type="checkbox" checked={page.memory} onChange={(e) => save({ memory: e.target.checked })} />
            {page.memory ? `Memory on: ${bot.display} reads this at the start of every session and can add to it.` : `Memory off: ${bot.display} neither reads nor adds to this.`}
          </label>
          <div className="meter"><span style={{ width: `${Math.min(100, ((notes ?? page.notes).length / page.notesCap) * 100)}%` }} /></div>
          <textarea className="notes" value={notes ?? page.notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nothing learned yet. Bots add a line here when they learn a preference of yours." />
          {notes !== null && notes !== page.notes && (
            <div className="row end">
              <button className="btn" onClick={() => setNotes(null)}>Undo</button>
              <button className="btn primary" onClick={async () => { try { await api.notes(id, notes); setNotes(null); load(); } catch (e: any) { setMsg(e.message); } }}>Save</button>
            </div>
          )}
          <p className="muted small">Lives in {page.folder}/notes.md, loaded at the start of every session.</p>
        </div>
      )}
      {tab === 'skills' && (
        <div className="list">
          {page.skills.length === 0 && <div className="muted empty">No skills yet.</div>}
          {page.skills.map((s: Json) => <div key={s.name} className="card"><b>{s.name}</b><div className="muted small">{s.description}</div></div>)}
          <p className="muted small">Skills are SKILL.md files in {page.folder}/skills. Only these load; your global skills stay out.</p>
        </div>
      )}
      {tab === 'tools' && (
        <div className="list">
          {page.tools.filter((t: Json) => t.source !== 'planned').map((t: Json) => (
            <label key={t.id} className="card line tool">
              <input type="checkbox" checked={t.granted} disabled={t.id === 'crew'} onChange={(e) => toggle(t.id, e.target.checked)} />
              <div className="grow">
                <b>{t.name}</b> <span className={`chip ${t.ready ? 'green' : 'amber'}`}>{t.ready ? 'ready' : `missing ${t.missing.join(', ')}`}</span>
                <div className="muted small">{t.provides}</div>
                <div className="small">{asksLine(t.asks)}</div>
                <div className="tiny">{t.license}{t.note ? ` · ${t.note}` : ''}</div>
                {!t.ready && !t.installable && <div className="mono tiny">{t.howto}</div>}
                {t.installable && (!t.ready || t.outdated) && (
                  <button className="btn small" onClick={async (e) => { e.preventDefault(); await api.install(t.id).catch((x) => setMsg(x.message)); setMsg(`Installing ${t.name} into Crewhouse's own tool folder; this can take a few minutes.`); }}>
                    {t.outdated ? 'Update' : 'Install'}
                  </button>
                )}
              </div>
            </label>
          ))}
          <p className="muted small">Changes apply the next time {bot.display} starts. Anything not granted asks you first.</p>
          <div className="card">
            <b>Always allowed for {bot.display}</b>
            {page.allow.length === 0 && <div className="muted small">Nothing yet. “Always for {bot.display}” on a question adds it here.</div>}
            {page.allow.map((r: string) => (
              <div key={r} className="row between small allow"><code>{r}</code><button className="btn quiet" onClick={() => save({ allow: page.allow.filter((x: string) => x !== r) })}>Take back</button></div>
            ))}
          </div>
        </div>
      )}
      {tab === 'models' && <Models id={id} bot={bot} onSaved={refresh} />}
      {tab === 'routines' && <Routines state={state} bot={id} refresh={refresh} />}
      {tab === 'files' && (
        <div className="list">
          {page.files.length === 0 && <div className="muted empty">No files yet. Deliverables land in {page.folder}/files.</div>}
          {page.files.map((f: Json) => (
            <div key={f.path} className="card">
              <div className="row between"><b>{f.path}</b><span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB · {ago(f.mtime)}</span></div>
              <Media bot={id} path={f.path} />
            </div>
          ))}
        </div>
      )}
      {tab === 'history' && (
        <div className="list">
          {page.tasks.length === 0 && <div className="muted empty">No tasks yet.</div>}
          {page.tasks.map((t: Json) => (
            <details key={t.id} className="card">
              <summary className="row between"><b>#{t.id} · {t.title}</b><span className="muted small"><Dot state={t.state} /> {stateWords[t.state]} · {ago(t.updated_at)}</span></summary>
              {t.result && <div className="muted small clamp">{t.result}</div>}
              <Trail events={page.trail.filter((e: Json) => e.data.task === t.id)} empty="No steps recorded for this task." />
            </details>
          ))}
        </div>
      )}
      {tab === 'screen' && <Screen bot={{ ...page.bot, ...bot }} missing={state.desktops?.missing ?? []} refresh={() => { refresh(); load(); }} />}
      {tab === 'work' && <ShowWork id={id} bot={bot} />}
    </div>
  );
}

/** The bot's models in fallback order. The first one does the work; the next takes over when an account rests. */
function Models({ id, bot, onSaved }: { id: string; bot: Json; onSaved: () => void }) {
  const saved: string[] = (bot.thinks ?? []).map((t: Json) => t.key);
  const [list, setList] = useState<string[]>(saved);
  const [add, setAdd] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => setList(saved), [saved.join()]);
  const move = (i: number, d: number) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; setList(l); };
  const save = async () => { setErr(''); try { await api.models(id, list); onSaved(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="list">
      <div className="card">
        <b>{thinksWith(bot)}</b>
        <p className="muted small">When an account is resting, {bot.display} carries on with the next one in a new session, briefed on the work so far.</p>
      </div>
      {list.map((m, i) => (
        <div key={m} className="card line">
          <div className="grow"><b>{i === 0 ? 'First choice' : `Then`}</b> <span className="mono">{m}</span></div>
          <button className="btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button className="btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="btn" disabled={list.length === 1} onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <input className="input grow" list="model-suggestions" value={add} placeholder="claude:haiku or codex:gpt-5.5" onChange={(e) => setAdd(e.target.value)} />
        <datalist id="model-suggestions">{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        <button className="btn" disabled={!add.trim() || list.includes(add.trim())} onClick={() => { setList([...list, add.trim()]); setAdd(''); }}>Add</button>
      </div>
      {err && <div className="error">{err}</div>}
      {list.join() !== saved.join() && (
        <div className="row end">
          <button className="btn" onClick={() => setList(saved)}>Undo</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      )}
      <p className="muted small">Written as cli:model. Chief can also pick a model for a single task, a cheap one for bulk work and a strong one for judgment. Changes apply to {bot.display}'s next task.</p>
    </div>
  );
}

/** Live terminal of the bot's CLI, and taking over by typing into it. Hidden behind a tab on purpose: most people never need it. */
function ShowWork({ id, bot }: { id: string; bot: Json }) {
  const [text, setText] = useState('');
  const [line, setLine] = useState('');
  const [err, setErr] = useState('');
  const type = async (body: Json) => { setErr(''); try { await api.type(id, body); setLine(''); } catch (e: any) { setErr(e.message); } };
  useEffect(() => {
    let alive = true;
    const pull = () => fetch(`/api/bots/${id}/screen`).then((r) => r.json()).then((r) => alive && setText(r.text ?? '')).catch(() => {});
    pull();
    const t = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [id]);
  return (
    <div className="card">
      <div className="row between"><b>{bot.display}'s terminal</b><span className="muted tiny">live · {bot.runtime}</span></div>
      <pre className="terminal">{text || `${bot.display} isn't running right now.`}</pre>
      {text && (
        <form className="row takeover" onSubmit={(e) => { e.preventDefault(); if (line.trim()) type({ text: line }); }}>
          <input className="input" value={line} onChange={(e) => setLine(e.target.value)} placeholder={`Type into ${bot.display}'s terminal…`} />
          <button className="btn primary">Send</button>
          <button type="button" className="btn" title="Interrupt what it is doing" onClick={() => type({ keys: ['esc'] })}>Esc</button>
        </form>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

const WHEN_EXAMPLES = ['every Monday 9:00', 'weekdays 8am', 'every day 6pm', 'every Friday 17:00'];

/** Work on a schedule: the whole list on the Routines screen, or one bot's on its page. */
function Routines({ state, bot, refresh }: { state: Json; bot?: string; refresh: () => void }) {
  const [adding, setAdding] = useState(false);
  const list = state.routines.filter((r: Json) => !bot || r.bot === bot);
  const who = bot ? state.bots.find((b: Json) => b.id === bot)?.display : '';
  return (
    <div className="list">
      <div className="head">
        <div>
          {!bot && <h1>Routines</h1>}
          <div className="muted">{bot ? `Work ${who} does on a schedule.` : 'Work the crew does on a schedule, by this computer\'s clock.'} Or tell Chief: “every Friday at five, have Reel make a demo of what shipped”.</div>
        </div>
        {!adding && <button className="btn primary" onClick={() => setAdding(true)}>＋ Add a routine</button>}
      </div>
      {adding && <AddRoutine state={state} bot={bot} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {list.length === 0 && !adding && <div className="muted empty">No routines yet.</div>}
      {list.map((r: Json) => <RoutineCard key={r.id} r={r} state={state} refresh={refresh} />)}
      <p className="muted small">If the computer is asleep when a routine is due, it runs once when it wakes. If the last run is still going, the next one is skipped rather than stacked.</p>
    </div>
  );
}

function RoutineCard({ r, state, refresh }: { r: Json; state: Json; refresh: () => void }) {
  const [when, setWhen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const b = state.bots.find((x: Json) => x.id === r.bot);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); setWhen(null); refresh(); } catch (e: any) { setErr(e.message); } };
  const last = r.history[0];
  const lastWords = (h: Json) => h.kind === 'routine.skipped' ? 'Skipped: still on the last run'
    : h.task ? `${stateWords[h.state] ?? h.state}${h.why === 'late' ? ' · caught up after sleep' : h.why === 'now' ? ' · run by you' : ''}` : 'Written';
  return (
    <div className="card routine">
      <div className="row">
        <Avatar bot={b} size={34} />
        <div className="grow">
          <div><b>{r.name}</b> {r.state === 'paused' && <span className="pill">Paused</span>}</div>
          <div className="muted small">{r.kind === 'digest' ? 'Chief: while you were away, what finished, what needs you, what is coming up' : `${b?.display}${r.brain ? ` · thinks with ${r.brain}` : ''}`}</div>
        </div>
      </div>
      <div className="row wrap small routine-when">
        <span className="chip">{r.words}</span>
        <span>{r.state === 'paused' ? 'Paused; nothing runs until you resume it' : <>Next: <b>{clock(r.next_at)}</b></>}</span>
        {last && <span className="muted">Last: {clock(last.at)} · {lastWords(last)}</span>}
      </div>
      {when !== null && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); act(() => api.routine(r.id, { schedule: when })); }}>
          <input className="input" autoFocus value={when} onChange={(e) => setWhen(e.target.value)} placeholder="every Monday 9:00" />
          <button className="btn primary">Save</button>
          <button type="button" className="btn" onClick={() => setWhen(null)}>Cancel</button>
        </form>
      )}
      {err && <div className="error">{err}</div>}
      <div className="row wrap end">
        <button className="btn" onClick={() => act(() => api.runRoutine(r.id))}>Run now</button>
        <button className="btn" onClick={() => act(() => api.routine(r.id, { state: r.state === 'on' ? 'paused' : 'on' }))}>{r.state === 'on' ? 'Pause' : 'Resume'}</button>
        <button className="btn" onClick={() => setWhen(r.schedule)}>Change time</button>
        {r.kind !== 'digest' && <button className="btn quiet" onClick={() => confirm(`Remove “${r.name}”?`) && act(() => api.removeRoutine(r.id))}>Remove</button>}
      </div>
      {r.history.length > 0 && (
        <details>
          <summary className="small muted">History</summary>
          <ol className="trail">
            {r.history.map((h: Json, i: number) => (
              <li key={i}><time>{clock(h.at)}</time><span>{h.task ? <a href={`#/bot/${r.bot}/history`}>Task #{h.task}</a> : null} {lastWords(h)}</span></li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function AddRoutine({ state, bot, onClose, onDone }: { state: Json; bot?: string; onClose: () => void; onDone: () => void }) {
  const crew = state.bots.filter((b: Json) => b.id !== 'chief');
  const [f, setF] = useState({ bot: bot ?? crew[0]?.id ?? '', task: '', schedule: '', model: '', name: '' });
  const [preview, setPreview] = useState<Json>(null);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  useEffect(() => {
    if (!f.schedule.trim()) return setPreview(null);
    const t = setTimeout(() => api.schedule(f.schedule).then(setPreview).catch((e) => setPreview({ error: e.message })), 250);
    return () => clearTimeout(t);
  }, [f.schedule]);
  if (!crew.length) return <div className="card muted">Recruit a bot first; a routine hands one of the crew a task on a schedule.</div>;
  const save = async () => { setErr(''); try { await api.addRoutine({ ...f, model: f.model.trim() || undefined }); onDone(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="card">
      <b>A new routine</b>
      {!bot && (
        <label className="label">Who does it
          <select className="input" value={f.bot} onChange={(e) => set('bot', e.target.value)}>
            {crew.map((b: Json) => <option key={b.id} value={b.id}>{b.display} · {b.role}</option>)}
          </select>
        </label>
      )}
      <label className="label">What should {crew.find((b: Json) => b.id === f.bot)?.display ?? 'it'} do each time
        <textarea className="input" rows={3} value={f.task} onChange={(e) => set('task', e.target.value)} placeholder="Make a 30-second demo from this week's screenshots in Pictures/Screenshots" />
      </label>
      <label className="label">When
        <input className="input" value={f.schedule} onChange={(e) => set('schedule', e.target.value)} placeholder="every Monday 9:00" />
      </label>
      <div className="row wrap examples">{WHEN_EXAMPLES.map((w) => <button key={w} type="button" className="chip" onClick={() => set('schedule', w)}>{w}</button>)}</div>
      {preview && <div className={`small ${preview.error ? 'error' : 'muted'}`}>{preview.error ?? `${preview.words}. First run ${clock(preview.next)}.`}</div>}
      <details className="small">
        <summary className="muted">More: a name, a different model</summary>
        <label className="label">Name<input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Weekly demo" /></label>
        <label className="label">Model for this routine
          <input className="input" list="model-suggestions" value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="the bot's own (a cheap one such as claude:haiku suits routine work)" />
        </label>
        <datalist id="model-suggestions">{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
      </details>
      {err && <div className="error">{err}</div>}
      <div className="row end">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!f.bot || !f.task.trim() || !preview || preview.error} onClick={save}>Add routine</button>
      </div>
    </div>
  );
}

function NeedsYou({ state, refresh }: { state: Json; refresh: () => void }) {
  return (
    <div>
      <h1>Needs you</h1>
      {state.asks.length === 0 && <div className="muted empty">Nothing is waiting on you. Questions and approvals from the crew land here.</div>}
      {state.asks.map((a: Json) => <AskCard key={a.id} ask={a} bots={state.bots} onDone={refresh} />)}
    </div>
  );
}

function Activity({ state, name }: { state: Json; name: (id: string) => string }) {
  const who = (id: number) => (state.members.length > 1 ? state.members.find((m: Json) => m.id === id)?.name ?? null : null);
  const items = [...state.events].reverse().map((e: Json) => ({ e, s: sentence(e, name, who) })).filter((x) => x.s);
  return (
    <div>
      <h1>Activity</h1>
      <div className="feed">
        {items.length === 0 && <div className="muted empty">Nothing yet.</div>}
        {items.map(({ e, s }) => (
          <a key={e.seq} className="feed-item" href={e.bot && e.bot !== 'chief' ? `#/bot/${e.bot}` : '#/chief'}>
            {e.bot ? <Avatar bot={state.bots.find((b: Json) => b.id === e.bot)} size={26} /> : <span className="avatar" style={{ width: 26, height: 26 }}>·</span>}
            <span className="grow">{s}</span>
            <span className="muted tiny">{ago(e.at)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------- settings ----------
const PLAN = (p?: string) => (p ? ` · ${p[0].toUpperCase()}${p.slice(1)}` : '');
/** Sign-in output with its links clickable. */
function Linked({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/\S+)/).map((t, i) => (i % 2 ? <a key={i} href={t} target="_blank" rel="noreferrer">{t}</a> : t))}</>;
}

/** The people in the house and each one's own AI accounts. One person needs none of this; a second one does. */
function Settings({ state, me, switchTo, tick, refresh }: { state: Json; me: number; switchTo: (id: number) => void; tick: number; refresh: () => void }) {
  const [accounts, setAccounts] = useState<Json[] | null>(null);
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.accounts().then(setAccounts).catch((e) => setErr(e.message)); }, [tick]);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); refresh(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="settings">
      <h1>Settings</h1>
      <h4>People</h4>
      <p className="muted small">Everyone here has their own thread with Chief, is addressed their own way, and runs their bots on their own AI accounts.</p>
      {state.members.length > 1 && (
        <label className="card line small">
          <span className="grow"><b>Who is using this screen?</b><div className="muted tiny">Picks whose threads, questions and accounts you see here.</div></span>
          <select className="input narrow" value={me} onChange={(e) => switchTo(Number(e.target.value))}>
            {state.members.map((m: Json) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}
      {state.members.map((m: Json) => <Person key={m.id} m={m} me={me} act={act} />)}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) act(async () => { await api.addPerson(adding); setAdding(''); }); }}>
        <input className="input" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add someone to the household: their name" />
        <button className="btn primary" disabled={!adding.trim()}>Add</button>
      </form>
      {err && <div className="error">{err}</div>}
      <h4>AI accounts</h4>
      <p className="muted small">Each person signs in to their own Claude or ChatGPT through Anthropic's or OpenAI's own sign-in page. Crewhouse never sees a password or token, and never lends one person's account to another: both companies' terms forbid sharing an account.</p>
      {!accounts && <div className="muted empty">Checking each account…</div>}
      {accounts && state.members.map((m: Json) => (
        <div key={m.id} className="card">
          <div className="row between"><b>{m.id === me ? 'Your accounts' : `${m.name}'s accounts`}</b>
            <button className="btn quiet small" onClick={() => api.accounts(true).then(setAccounts).catch((e) => setErr(e.message))}>Check again</button></div>
          {accounts.filter((a) => a.member === m.id).map((a) => <Account key={a.runtime} a={a} mine={m.id === me} act={act} />)}
        </div>
      ))}
    </div>
  );
}

function Person({ m, me, act }: { m: Json; me: number; act: (fn: () => Promise<unknown>) => void }) {
  const [name, setName] = useState(m.name ?? '');
  const [address, setAddress] = useState(m.address ?? '');
  useEffect(() => { setName(m.name ?? ''); setAddress(m.address ?? ''); }, [m.name, m.address]);
  const [from, to] = (m.quiet ?? '22:00-07:00').split('-');
  const you = m.id === me;
  return (
    <div className="card person">
      <div className="row">
        <span className="avatar" style={{ width: 36, height: 36 }}>{(m.name ?? '?')[0]}</span>
        <div className="grow">
          <b>{m.name}</b> {m.id === 1 && <span className="lead">OWNER</span>} {you && <span className="chip">you</span>} {m.quietNow && <span className="pill">quiet hours</span>}
          <div className="muted small">{m.address ? `Chief calls ${you ? 'you' : 'them'} “${m.address}”` : `Hasn't met Chief yet; Chief greets ${you ? 'you' : 'them'} in ${you ? 'your' : 'their'} own thread`}</div>
        </div>
      </div>
      <div className="fields">
        <label className="label">Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && act(() => api.person(m.id, { name }))} />
        </label>
        <label className="label">Chief calls {you ? 'you' : 'them'}
          <input className="input" value={address} placeholder="sir, ma'am, or a name" onChange={(e) => setAddress(e.target.value)} onBlur={() => address.trim() && address !== m.address && act(() => api.person(m.id, { address }))} />
        </label>
      </div>
      <label className="row small switch">
        <input type="checkbox" checked={!!m.quiet} onChange={(e) => act(() => api.person(m.id, { quiet: e.target.checked ? '22:00-07:00' : null }))} />
        Quiet hours{m.quiet ? '' : ': off'}
      </label>
      {m.quiet && (
        <div className="row small">
          <input className="input narrow" type="time" value={from} onChange={(e) => e.target.value && act(() => api.person(m.id, { quiet: `${e.target.value}-${to}` }))} />
          <span>to</span>
          <input className="input narrow" type="time" value={to} onChange={(e) => e.target.value && act(() => api.person(m.id, { quiet: `${from}-${e.target.value}` }))} />
          <span className="tiny grow">The crew keeps working on what {you ? 'you have' : 'they have'} already allowed; anything new waits for {you ? 'you' : 'them'} instead of holding a bot.</span>
        </div>
      )}
    </div>
  );
}

function Account({ a, mine, act }: { a: Json; mine: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const [code, setCode] = useState('');
  const signing = a.login?.state === 'running';
  const [k, words] = a.state === 'ready' ? ['green', `Signed in${PLAN(a.plan)}`] : a.state === 'missing' ? ['', `${a.name} isn't installed on this computer`] : ['amber', 'Not signed in'];
  return (
    <div className="account">
      <div className="row between wrap">
        <span><b>{a.name}</b> <span className={`chip ${k}`}>{words}</span> {a.restingUntil > 0 && <span className="chip amber">Resting until {resetWords(a.restingUntil)}</span>}</span>
        {a.state === 'signed-out' && !signing && (
          <button className="btn primary" onClick={() => act(() => api.signIn(a.member, a.runtime))}>Sign in with {mine ? 'your' : 'their'} own {a.name}</button>
        )}
      </div>
      <Windows limits={a.limits} resting={a.restingUntil} />
      {a.login && a.login.state !== 'done' && (
        <div className="signin">
          <pre className="terminal small"><Linked text={a.login.out || `Starting ${a.name}'s sign-in…`} /></pre>
          {signing && a.runtime === 'claude' && (
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (code.trim()) act(async () => { await api.signInCode(a.member, a.runtime, code); setCode(''); }); }}>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code Claude's page shows you" />
              <button className="btn primary" disabled={!code.trim()}>Send</button>
            </form>
          )}
          <div className="row">
            <span className="tiny grow">{signing ? `Open the link and sign in as ${mine ? 'yourself' : 'them'}. ${a.runtime === 'codex' ? 'Enter the one-time code shown above.' : ''}` : "The sign-in didn't finish."}</span>
            <button className="btn quiet small" onClick={() => act(() => api.signInCancel(a.member, a.runtime))}>{signing ? 'Cancel' : 'Close'}</button>
          </div>
        </div>
      )}
      <div className="tiny">Kept by {a.name} in {a.where}{a.member === 1 ? ' (its usual place)' : ''}</div>
    </div>
  );
}

// ---------- shell ----------
function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [state, setState] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
  const [me, setMe] = useState(() => { const id = Number(localStorage.getItem('crewhouse.member')) || 1; setMember(id); return id; });
  const switchTo = useCallback((id: number) => { localStorage.setItem('crewhouse.member', String(id)); setMember(id); setMe(id); }, []);
  const refresh = useCallback(() => {
    api.state().then((s) => { setState(s); setOffline(false); }).catch(() => setOffline(true));
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    addEventListener('hashchange', onHash);
    refresh();
    let pending: any;
    const stop = subscribe(() => { clearTimeout(pending); pending = setTimeout(refresh, 120); });
    const poll = setInterval(refresh, 15000); // belt and braces if the socket is quietly gone
    return () => { removeEventListener('hashchange', onHash); stop(); clearInterval(poll); };
  }, [refresh]);
  useEffect(() => { refresh(); }, [me, refresh]);
  // crewd shows the owner for an id it doesn't know (a fresh install, say); follow it.
  useEffect(() => { if (state && state.person.id !== me) switchTo(state.person.id); }, [state, me, switchTo]);
  const name = useMemo(() => {
    const m = new Map((state?.bots ?? []).map((b: Json) => [b.id, b.display]));
    return (id: string) => (m.get(id) as string) ?? id;
  }, [state]);

  if (!state) return <div className="boot">{offline ? 'Crewhouse is not running. Start it with ./crewhouse start' : 'Opening Crewhouse…'}</div>;
  const nav: [Route['view'], string, string][] = [
    ['home', 'Home', '⌂'], ['chief', 'Chief', '★'], ['needs', 'Needs you', '◉'], ['crew', 'Crew', '☺'], ['routines', 'Routines', '↻'], ['activity', 'Activity', '∿'], ['settings', 'Settings', '≡'],
  ];
  const active = route.view === 'bot' ? 'crew' : route.view;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo">⌂</span> Crewhouse</div>
        {nav.map(([v, label, icon]) => (
          <a key={v} className={`nav ${active === v ? 'on' : ''}`} href={`#/${v}`}>
            <span className="icon">{icon}</span>{label}
            {v === 'needs' && state.asks.length > 0 && <span className="badge">{state.asks.length}</span>}
          </a>
        ))}
        <div className="grow" />
        {state.bots.filter((b: Json) => b.id !== 'chief').map((b: Json) => (
          <a key={b.id} className={`nav small ${route.id === b.id ? 'on' : ''}`} href={`#/bot/${b.id}`}><Avatar bot={b} size={22} status={live(b)[0]} /> {b.display}</a>
        ))}
        <div className="me">
          <span className="avatar" style={{ width: 32, height: 32, background: '#2E2925', color: '#fff' }}>{(state.members.length > 1 ? state.person.name : state.person.address ?? 'Y')[0]}</span>
          <div className="grow">
            <b>{state.members.length > 1 ? state.person.name : state.person.address ?? 'You'}</b>
            {state.members.length > 1
              ? <select className="who tiny" aria-label="Who is using this screen" value={me} onChange={(e) => switchTo(Number(e.target.value))}>
                  {state.members.map((m: Json) => <option key={m.id} value={m.id}>{m.id === me ? 'switch person…' : m.name}</option>)}
                </select>
              : <div className="tiny muted">owner · this computer</div>}
          </div>
        </div>
      </aside>
      <main className={`main ${route.view === 'chief' ? 'chat-view' : ''}`}>
        {offline && <div className="offline">Lost touch with Crewhouse; retrying…</div>}
        {route.view === 'home' && <Home state={state} name={name} tick={tick} refresh={refresh} />}
        {route.view === 'chief' && (
          <div className="chief">
            <div className="head"><div className="row"><Avatar bot={state.bots.find((b: Json) => b.id === 'chief')} size={44} /><div><h1>Chief</h1><div className="status-line">{crewLine(state)}</div></div></div></div>
            <Thread botId="chief" state={state} tick={tick} refresh={refresh} />
          </div>
        )}
        {route.view === 'crew' && <Crew state={state} refresh={refresh} />}
        {route.view === 'needs' && <NeedsYou state={state} refresh={refresh} />}
        {route.view === 'routines' && <Routines state={state} refresh={refresh} />}
        {route.view === 'activity' && <Activity state={state} name={name} />}
        {route.view === 'settings' && <Settings state={state} me={me} switchTo={switchTo} tick={tick} refresh={refresh} />}
        {route.view === 'bot' && route.id && (route.id === 'chief' ? (go('#/chief'), null) : <BotPage id={route.id} tab={route.tab!} state={state} tick={tick} refresh={refresh} />)}
      </main>
      <nav className="tabbar">
        {nav.map(([v, label, icon]) => (
          <a key={v} className={active === v ? 'on' : ''} href={`#/${v}`}>
            <span className="icon">{icon}</span>{label}
            {v === 'needs' && state.asks.length > 0 && <span className="badge">{state.asks.length}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
