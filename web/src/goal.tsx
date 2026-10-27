// Your goals: one board per goal, with the goal's own stage names. The crew fills the first stages; every other column moves on the person's own tap.
import { useState } from 'react';
import * as A from './adapter.ts';
import { api } from './api.ts';
import type { Ctx } from './main.tsx';

/** A reminder is the person's: change its time or dismiss it. */
function Reminder({ x, refresh }: { x: A.GoalReminder; refresh: () => void }) {
  const [edit, setEdit] = useState(false), [when, setWhen] = useState(''), [err, setErr] = useState('');
  const act = async (f: () => Promise<unknown>) => { setErr(''); try { await f(); setEdit(false); refresh(); } catch (e: any) { setErr(e.message); } };
  return <div className={`remind ${x.fired ? 'fired' : ''}`}>
    <span className="grow"><b>{x.name}</b><span className="mute small">{x.when}</span></span>
    <button className="chip" onClick={() => setEdit(!edit)} aria-expanded={edit}>Change</button>
    <button className="chip" onClick={() => act(() => api.removeRoutine(x.id))}>Dismiss</button>
    {edit && <form className="remind-form" onSubmit={(e) => { e.preventDefault(); void act(() => api.routine(x.id, { schedule: when })); }}>
      <input className="input" aria-label="New time" placeholder="tomorrow 9:00" value={when} onChange={(e) => setWhen(e.target.value)} />
      <button className="btn go" disabled={!when.trim()}>Set</button></form>}
    {err && <p className="remind-err" role="alert">{err}</p>}
  </div>;
}

/** "Remind me": for one item, or standing alone on the goal when `text` is asked for. */
function Remind({ target, ask, refresh }: { target: { item: number } | { goal: number }; ask?: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [when, setWhen] = useState(''), [err, setErr] = useState('');
  const set = async () => { setErr(''); try { await api.remindGoal(target, { when, ...(text.trim() ? { text } : {}) }); setOpen(false); setText(''); setWhen(''); refresh(); } catch (e: any) { setErr(e.message); } };
  if (!open) return <button className="btn ghost" onClick={() => setOpen(true)}>Remind me</button>;
  return <form className="remind-form" onSubmit={(e) => { e.preventDefault(); void set(); }}>
    {ask && <input className="input" aria-label="What to remind you of" placeholder="Read the brief" value={text} onChange={(e) => setText(e.target.value)} />}
    <input className="input" aria-label="When" placeholder="Friday 1pm" value={when} onChange={(e) => setWhen(e.target.value)} />
    <button className="btn go" disabled={!when.trim() || (!!ask && !text.trim())}>Set reminder</button>
    <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Not now</button>
    {err && <p className="remind-err" role="alert">{err}</p>}</form>;
}

export function RoleCard({ r, refresh }: { r: A.GoalRole; refresh: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); refresh(); } finally { setBusy(false); } };
  return <div className={`role role-${r.stage}`}>
    <button className="role-head" aria-expanded={open} onClick={() => setOpen(!open)}><b>{r.title}</b><span>{r.co} · {r.place}</span><span className="role-pay">{r.pay}</span></button>
    <p className="role-why clamp1">{r.why}</p>
    {!!r.reminders.length && !open && <p className="role-bell mute small">{r.reminders[0].fired ? 'Reminded you' : 'Reminder'} {r.reminders[0].when}</p>}
    {open && <div className="role-body">
      {!!r.signals.length && <><div className="hire-sect">Why it ranks here</div>{r.signals.map((x) => <p key={x.label} className="role-li">{x.label}: “{x.quote}” <a className="link" href={x.url} target="_blank" rel="noopener noreferrer">{x.host}</a></p>)}</>}
      <div className="hire-sect">Why it fits</div>{r.fit.map((f, i) => <p key={i} className="role-li">{f}</p>)}
      {!!r.gap && <><div className="hire-sect">What is missing</div><p className="role-li">{r.gap}</p></>}
      <p className="mute small">From <a className="link" href={r.url} target="_blank" rel="noopener noreferrer">{r.source}</a>, checked {r.checked}</p>
      {r.reminders.map((x) => <Reminder key={x.id} x={x} refresh={refresh} />)}
      <div className="btns">
        {r.draft === 'ask' && <button className="btn go" disabled={busy || r.drafting} onClick={() => run(() => api.draftRole(r.id))}>{r.drafting ? A.GOAL_WRITER.busy : A.GOAL_WRITER.ask}</button>}
        {r.draft === 'open' && <a className="btn" href="#/chief">{A.GOAL_WRITER.open}</a>}
        {r.prepable ? (r.prep ? <a className="btn go" href={`#/goal/${r.id}`}>Open your interview prep</a>
          : <button className="btn go" disabled={busy || r.prepping} onClick={() => run(() => api.prepRole(r.id))}>{r.prepping ? 'Writing your prep…' : 'Prep for this interview'}</button>) : null}
        {r.next && <button className="btn go" disabled={busy} onClick={() => run(() => api.moveRole(r.id, r.next![0]))}>{r.next[1]}</button>}
        {!r.reminders.length && <Remind target={{ item: r.id }} refresh={refresh} />}
        {r.passable && <button className="btn ghost" disabled={busy} onClick={() => run(() => api.moveRole(r.id, 'passed'))}>Not for me</button>}
      </div>
    </div>}
  </div>;
}

/** Interview prep for one role: the brief with every fact linked to its page, the likely questions and why, and what stays the person's. Written to read; nothing is sent. */
function Prep({ state, refresh, id }: Ctx & { id: string }) {
  const g = A.goals(state).find((x: { cols: { roles: A.GoalRole[] }[] }) => x.cols.some((c) => c.roles.some((y) => String(y.id) === id))), r = g?.cols.flatMap((c: { roles: A.GoalRole[] }) => c.roles).find((x: A.GoalRole) => String(x.id) === id), [busy, setBusy] = useState(false);
  if (!g || !r?.prep) return <div className="page stack rest-screen"><h1>Interview prep</h1><p className="st-line">{r?.prepping ? 'The writer is putting it together.' : 'Nothing is prepared for this role yet.'}</p><a className="btn go" href="#/goal">Back to Your goal</a></div>;
  const p = r.prep, practice = async () => { setBusy(true); try { await api.practiceRole(r.id); refresh(); location.hash = `#/h/${g.will}`; } finally { setBusy(false); } };
  return <div className="page stack goal-page prep-page">
    <a className="link" href="#/goal">‹ Your goal</a>
    <h1>{r.co}</h1><p className="st-line">{r.title} · {r.place}</p>
    <p className="mute small">Written for you to read. Nothing is sent, filled in or signed.</p>
    <div className="hire-sect">About {r.co}</div>
    <ul className="prep-list">{p.brief.map((b: A.GoalPrep['brief'][number], i: number) => <li key={i}><span>{b.says}</span><span className="mute small">Source: <a className="link" href={b.url} target="_blank" rel="noopener noreferrer" title={b.quote}>{b.host}</a></span></li>)}</ul>
    <div className="hire-sect">Questions you may be asked</div>
    <ol className="prep-list">{p.questions.map((q: A.GoalPrep['questions'][number], i: number) => <li key={i}><b>{q.ask}</b><span className="mute small">Why they ask: {q.why}</span></li>)}</ol>
    {!!p.yours.length && <div className="yours"><b>Only you can answer these</b>{p.yours.map((q: string, i: number) => <div key={i} className="yours-q"><span>{q}</span><i aria-hidden /></div>)}<span className="mute small">The crew leaves these empty and never writes an answer for them.</span></div>}
    <div className="btns"><button className="btn go" disabled={busy} onClick={() => void practice()}>Practice with the interviewer</button></div>
    <p className="mute small">The writer asks one question at a time in its own chat. Answer by typing or with the mic, and it says what landed and what to tighten.</p>
  </div>;
}

export function Goal(ctx: Ctx & { id?: string }) {
  const { state, refresh } = ctx, all = A.goals(state), [pick, setPick] = useState(0), [sel, setSel] = useState('');
  const g = all[pick] ?? all[0];
  if (ctx.id) return <Prep {...ctx} id={ctx.id} />;
  if (!g) return <div className="page stack rest-screen"><h1>Your goal</h1><p className="st-line">Tell Chief what you are looking for and where. He shows you one card before anything starts.</p><a className="btn go" href="#/chief">Tell Chief</a></div>;
  const col = g.cols.some((c: { key: string }) => c.key === sel) ? sel : g.cols[0].key;
  return <div className="page stack goal-page">
    <h1>Your goal</h1>
    {all.length > 1 && <div className="goal-tabs" role="tablist" aria-label="Your goals">{all.map((x: { id: number; title: string }, i: number) => <button key={x.id} role="tab" aria-selected={g.id === x.id} className={g.id === x.id ? 'on' : ''} onClick={() => { setPick(i); setSel(''); }}>{x.title}</button>)}</div>}
    <p className="st-line">{g.title} · {g.places}{g.floor ? ` · from ${g.floor}` : ''}</p>
    <div className="goal-rules"><span>{A.GOAL_RULE}</span>
      <details><summary>See all the rules</summary>
        <div className="hire-sect">The crew will not</div>{g.wont.map((l: string) => <p key={l} className="role-li">{l}</p>)}
        {!!g.asks.length && <><div className="hire-sect">The crew asks you. It never guesses these</div>{g.asks.map((l: string) => <p key={l} className="role-li">{l}</p>)}</>}
      </details></div>
    <div className="goal-chips" role="tablist">{g.cols.map((c: { key: string; name: string; roles: unknown[] }) => <button key={c.key} role="tab" aria-selected={col === c.key} className={col === c.key ? 'on' : ''} onClick={(e) => { setSel(c.key); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest' }); }}>{c.name} {c.roles.length}</button>)}</div>
    <div className="goal-board">{g.cols.map((c: { key: string; name: string; who: string; roles: A.GoalRole[] }) => <section key={c.key} className={col === c.key ? 'on' : ''} aria-label={c.name}>
      <h2>{c.name} <span className="mute">{c.roles.length}</span></h2><p className="mute small">{c.who}</p>
      {c.roles.length ? c.roles.map((r) => <RoleCard key={r.id} r={r} refresh={refresh} />) : <p className="mute small">Nothing here yet.</p>}
    </section>)}</div>
    <div className="hire-sect">Reminders</div>
    {g.standalone.map((x: A.GoalReminder) => <Reminder key={x.id} x={x} refresh={refresh} />)}
    <div className="btns"><Remind target={{ goal: g.id }} ask refresh={refresh} /></div>
    <div className="hire-sect">On its own</div><p className="role-li">Every morning at 8:00 the crew looks for what fits and adds it to {g.cols[0].name}, quietly. It never pages you.</p>
  </div>;
}
