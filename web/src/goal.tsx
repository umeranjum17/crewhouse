// Your goal: the job-search board. The crew fills Found and Drafted; every other column moves on the person's own tap.
import { useState } from 'react';
import * as A from './adapter.ts';
import { api } from './api.ts';
import type { Ctx } from './main.tsx';

function RoleCard({ r, refresh }: { r: A.GoalRole; refresh: () => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); refresh(); } finally { setBusy(false); } };
  return <div className={`role role-${r.stage}`}>
    <button className="role-head" aria-expanded={open} onClick={() => setOpen(!open)}><b>{r.title}</b><span>{r.co} · {r.place}</span><span className="role-pay">{r.pay}</span></button>
    {open && <div className="role-body">
      <div className="hire-sect">Why it fits</div>{r.fit.map((f, i) => <p key={i} className="role-li">{f}</p>)}
      {!!r.gap && <><div className="hire-sect">What is missing</div><p className="role-li">{r.gap}</p></>}
      <p className="mute small">From <a className="link" href={r.url} target="_blank" rel="noopener noreferrer">{r.source}</a>, checked {r.checked}</p>
      <div className="btns">
        {r.stage === 'found' && <button className="btn go" disabled={busy || r.drafting} onClick={() => run(() => api.draftRole(r.id))}>{r.drafting ? 'Drafting…' : 'Draft my application'}</button>}
        {r.stage === 'drafted' && <a className="btn" href="#/chief">Open the draft</a>}
        {r.next && <button className="btn go" disabled={busy} onClick={() => run(() => api.moveRole(r.id, r.next![0]))}>{r.next[1]}</button>}
        {(r.stage === 'found' || r.stage === 'drafted') && <button className="btn ghost" disabled={busy} onClick={() => run(() => api.moveRole(r.id, 'passed'))}>Not for me</button>}
      </div>
    </div>}
  </div>;
}

export function Goal({ state, refresh }: Ctx) {
  const g = A.goal(state), [col, setCol] = useState('found');
  if (!g) return <div className="page stack rest-screen"><h1>Your goal</h1><p className="st-line">Tell Chief the roles you want, where, and paste your CV. He shows you one card before anything starts.</p><a className="btn go" href="#/chief">Tell Chief</a></div>;
  return <div className="page stack goal-page">
    <h1>Your goal</h1>
    <p className="st-line">{g.title} · {g.places}{g.floor ? ` · from ${g.floor}` : ''}</p>
    <div className="goal-rules"><span>{A.GOAL_RULES.short}</span>
      <details><summary>See all the rules</summary>
        <div className="hire-sect">Only you do these</div>{A.GOAL_RULES.only.map((l) => <p key={l} className="role-li">{l}</p>)}
        <div className="hire-sect">The crew asks you. It never guesses these</div>{A.GOAL_RULES.asks.map((l) => <p key={l} className="role-li">{l}</p>)}
      </details></div>
    <div className="goal-chips" role="tablist">{g.cols.map((c) => <button key={c.key} role="tab" aria-selected={col === c.key} className={col === c.key ? 'on' : ''} onClick={() => setCol(c.key)}>{c.name} {c.roles.length}</button>)}</div>
    <div className="goal-board">{g.cols.map((c) => <section key={c.key} className={col === c.key ? 'on' : ''} aria-label={c.name}>
      <h2>{c.name} <span className="mute">{c.roles.length}</span></h2><p className="mute small">{c.who}</p>
      {c.roles.length ? c.roles.map((r) => <RoleCard key={r.id} r={r} refresh={refresh} />) : <p className="mute small">Nothing here yet.</p>}
    </section>)}</div>
    <div className="hire-sect">On its own</div>{g.own.map((l) => <p key={l} className="role-li">{l}</p>)}
  </div>;
}
