import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, subscribe, type Json } from './api.ts';
import { stateWords } from './tokens.ts';
import { Screen } from './screen.tsx';

type Route = { view: 'home' | 'chief' | 'crew' | 'needs' | 'activity' | 'bot'; id?: string; tab?: string };

function parseRoute(): Route {
  const [view, id, tab] = location.hash.replace(/^#\/?/, '').split('/');
  if (view === 'bot' && id) return { view: 'bot', id, tab: tab || 'chat' };
  return { view: (['home', 'chief', 'crew', 'needs', 'activity'].includes(view) ? view : 'home') as Route['view'] };
}
const go = (hash: string) => { location.hash = hash; };

// ---------- small pieces ----------
function Avatar({ bot, size = 40 }: { bot: Json; size?: number }) {
  const lead = bot?.id === 'chief';
  return (
    <span className="avatar" style={{ width: size, height: size, background: `${bot?.color ?? '#888'}22`, color: bot?.color ?? '#888', fontSize: size * 0.42 }}>
      {lead ? '★' : (bot?.display ?? '?').slice(0, 1)}
    </span>
  );
}

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
  if (b.task) return `${stateWords[b.task.state]} · ${b.task.title}`;
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

function sentence(e: Json, name: (id: string) => string): string | null {
  const b = e.bot ? name(e.bot) : '';
  const d = e.data ?? {};
  switch (e.kind) {
    case 'system.started': return 'Crewhouse started';
    case 'person.onboarded': return `Chief will address you as ${d.address}`;
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
    case 'bot.models': return `You changed which models ${b} thinks with`;
    case 'account.resting': return `${d.runtime === 'codex' ? 'ChatGPT' : 'Claude'} is resting until ${new Date(d.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    case 'task.paused': return `${b} paused “${d.title}”: ${d.result ?? ''}`;
    case 'ask.parked': return `${b} is waiting for your answer; the rest of its work is paused`;
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
      {ask.kind === 'permission' || ask.kind === 'trust' ? (
        <>
          {ask.kind === 'trust' ? <p className="muted small">{ask.detail.note}</p> : <pre className="mono small">{ask.detail.summary}</pre>}
          <div className="row">
            <button className="btn primary" onClick={() => send({ answer: 'allow' })}>{ask.kind === 'trust' ? 'Trust it' : 'Allow once'}</button>
            <button className="btn" onClick={() => send({ answer: 'deny' })}>Don't allow</button>
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
function Thread({ botId, state, tick, compact }: { botId: string; state: Json; tick: number; compact?: boolean }) {
  const [page, setPage] = useState<Json>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [byName, setByName] = useState(false);
  const load = useCallback(() => api.bot(botId).then(setPage).catch((e) => setErr(e.message)), [botId]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [page?.messages?.length]);

  const bot = state.bots.find((b: Json) => b.id === botId);
  const chief = state.bots.find((b: Json) => b.id === 'chief');
  const onboarding = botId === 'chief' && !state.person.onboarded;
  const send = async (t: string) => {
    if (!t.trim()) return;
    setErr('');
    setText('');
    try { onboarding ? await api.onboard(t) : await api.post(botId, t); load(); } catch (e: any) { setErr(e.message); setText(t); }
  };
  const working = bot?.task && bot.task.state === 'working';

  return (
    <div className={`thread ${compact ? 'compact' : ''}`}>
      <div className="messages">
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
        {working && <div className="typing"><Avatar bot={bot} size={22} /> {bot.display} is working…</div>}
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

// ---------- views ----------
function Home({ state, name, tick, refresh }: { state: Json; name: (id: string) => string; tick: number; refresh: () => void }) {
  const working = state.bots.filter((b: Json) => b.id !== 'chief' && b.task);
  const done = state.tasks.filter((t: Json) => t.state === 'done' && Date.now() - t.updated_at < 86_400_000);
  return (
    <div className="home">
      <h1>{greeting()}{state.person.address ? `, ${state.person.address}` : ''}</h1>
      <div className="row wrap chips">
        <span className="chip green">✓ {done.length} done today</span>
        {state.asks.length > 0 && <span className="chip amber">{state.asks.length} need you</span>}
        <span className="chip">{state.bots.length - 1} on the crew</span>
        {state.limits?.claude?.fiveHour && <span className="chip" title="From Claude's own status line">Claude · {state.limits.claude.fiveHour.used}% of the 5-hour window used</span>}
      </div>
      {state.asks.length > 0 && (
        <section>
          <h4>Needs you <span className="badge">{state.asks.length}</span></h4>
          {state.asks.map((a: Json) => <AskCard key={a.id} ask={a} bots={state.bots} onDone={refresh} />)}
        </section>
      )}
      <section>
        <h4>Working now</h4>
        {working.length === 0 && <div className="muted empty">Nobody is working right now.</div>}
        {working.map((b: Json) => (
          <a key={b.id} className="card line" href={`#/bot/${b.id}`}>
            <Avatar bot={b} size={32} />
            <div className="grow"><b>{b.display}</b> · {b.task.title}<div className="bar"><span /></div></div>
          </a>
        ))}
      </section>
      <section>
        <h4>Done lately</h4>
        {done.length === 0 && <div className="muted empty">Finished work shows up here.</div>}
        {done.slice(0, 6).map((t: Json) => (
          <a key={t.id} className="card line" href={`#/bot/${t.bot}`}>
            <Avatar bot={state.bots.find((b: Json) => b.id === t.bot)} size={32} />
            <div className="grow"><b>{name(t.bot)}</b> · {t.title}<div className="muted small clamp">{t.result}</div></div>
            <span className="muted small">{ago(t.updated_at)}</span>
          </a>
        ))}
      </section>
      <section>
        <h4>Talk to Chief</h4>
        <Thread botId="chief" state={state} tick={tick} compact />
      </section>
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
              <Avatar bot={b} />
              <div className="grow">
                <div><b>{b.display}</b> {b.id === 'chief' && <span className="lead">LEAD</span>}</div>
                <div className="muted small"><Dot state={b.task?.state ?? (b.state === 'on' ? 'idle' : 'off')} /> {botStatus(b)}</div>
              </div>
            </div>
            <p className="muted">{b.role}</p>
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
  const tabs = ['chat', 'knows', 'skills', 'tools', 'models', 'files', 'history', 'screen', 'work'];
  const label: Record<string, string> = { work: 'Show the work', models: 'Thinks with' };
  const toggle = async (tool: string, on: boolean) => {
    const granted = page.tools.filter((t: Json) => t.granted).map((t: Json) => t.id).filter((t: string) => t !== tool);
    await api.tools(id, on ? [...granted, tool] : granted).catch((e) => setMsg(e.message));
    load();
  };
  return (
    <div className="botpage">
      <div className="head">
        <div className="row">
          <Avatar bot={bot} size={52} />
          <div>
            <h1>{bot.display}</h1>
            <div className="muted"><Dot state={bot.task?.state ?? 'idle'} /> {botStatus(bot)} · {bot.role}</div>
            <div className="muted small">{thinksWith(bot)}</div>
          </div>
        </div>
        {bot.task && <button className="btn" onClick={async () => { await api.reset(id); refresh(); }}>Stop</button>}
      </div>
      <nav className="tabs">
        {tabs.map((t) => <a key={t} className={t === tab ? 'on' : ''} href={`#/bot/${id}/${t}`}>{label[t] ?? t[0].toUpperCase() + t.slice(1)}</a>)}
      </nav>
      {msg && <div className="error">{msg}</div>}
      {tab === 'chat' && <Thread botId={id} state={state} tick={tick} />}
      {tab === 'knows' && (
        <div className="card">
          <div className="row between">
            <b>What {bot.display} knows</b>
            <span className="muted small">{(notes ?? page.notes).length} / {page.notesCap} characters</span>
          </div>
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
        </div>
      )}
      {tab === 'models' && <Models id={id} bot={bot} onSaved={refresh} />}
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
            <div key={t.id} className="card">
              <div className="row between"><b>#{t.id} · {t.title}</b><span className="muted small"><Dot state={t.state} /> {stateWords[t.state]} · {ago(t.updated_at)}</span></div>
              {t.result && <div className="muted small clamp">{t.result}</div>}
            </div>
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

/** Read-only live terminal of the bot's CLI. Hidden behind a tab on purpose: most people never need it. */
function ShowWork({ id, bot }: { id: string; bot: Json }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let alive = true;
    const pull = () => fetch(`/api/bots/${id}/screen`).then((r) => r.json()).then((r) => alive && setText(r.text ?? '')).catch(() => {});
    pull();
    const t = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [id]);
  return (
    <div className="card">
      <div className="row between"><b>{bot.display}'s terminal</b><span className="muted tiny">live · read-only · {bot.runtime}</span></div>
      <pre className="terminal">{text || `${bot.display} isn't running right now.`}</pre>
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
  const items = [...state.events].reverse().map((e: Json) => ({ e, s: sentence(e, name) })).filter((x) => x.s);
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

// ---------- shell ----------
function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  const [state, setState] = useState<Json>(null);
  const [tick, setTick] = useState(0);
  const [offline, setOffline] = useState(false);
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
  const name = useMemo(() => {
    const m = new Map((state?.bots ?? []).map((b: Json) => [b.id, b.display]));
    return (id: string) => (m.get(id) as string) ?? id;
  }, [state]);

  if (!state) return <div className="boot">{offline ? 'Crewhouse is not running. Start it with ./crewhouse start' : 'Opening Crewhouse…'}</div>;
  const nav: [Route['view'], string, string][] = [
    ['home', 'Home', '⌂'], ['chief', 'Chief', '★'], ['needs', 'Needs you', '◉'], ['crew', 'Crew', '☺'], ['activity', 'Activity', '∿'],
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
          <a key={b.id} className={`nav small ${route.id === b.id ? 'on' : ''}`} href={`#/bot/${b.id}`}><Avatar bot={b} size={22} /> {b.display}</a>
        ))}
        <div className="me">
          <span className="avatar" style={{ width: 32, height: 32, background: '#2E2925', color: '#fff' }}>{(state.person.address ?? 'Y')[0]}</span>
          <div><b>{state.person.address ?? 'You'}</b><div className="tiny muted">owner · this computer</div></div>
        </div>
      </aside>
      <main className={`main ${route.view === 'chief' ? 'chat-view' : ''}`}>
        {offline && <div className="offline">Lost touch with Crewhouse; retrying…</div>}
        {route.view === 'home' && <Home state={state} name={name} tick={tick} refresh={refresh} />}
        {route.view === 'chief' && (
          <div className="chief">
            <div className="head"><div className="row"><Avatar bot={state.bots.find((b: Json) => b.id === 'chief')} size={44} /><div><h1>Chief</h1><div className="muted">Runs the crew and answers to you</div></div></div></div>
            <Thread botId="chief" state={state} tick={tick} />
          </div>
        )}
        {route.view === 'crew' && <Crew state={state} refresh={refresh} />}
        {route.view === 'needs' && <NeedsYou state={state} refresh={refresh} />}
        {route.view === 'activity' && <Activity state={state} name={name} />}
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
