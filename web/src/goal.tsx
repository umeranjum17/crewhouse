// Your goal: the job-search board. The crew fills Found and Drafted; every other column moves on the person's own tap.
import { useState } from 'react';
import * as A from './adapter.ts';
import { api } from './api.ts';
import type { Ctx } from './main.tsx';

export function RoleCard({ r, refresh }: { r: A.GoalRole; refresh: () => void }) {
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
        {r.stage === 'interview' && (r.prep ? <a className="btn go" href={`#/goal/${r.id}`}>Open your interview prep</a>
          : <button className="btn go" disabled={busy || r.prepping} onClick={() => run(() => api.prepRole(r.id))}>{r.prepping ? 'Writing your prep…' : 'Prep for this interview'}</button>)}
        {r.next && <button className="btn go" disabled={busy} onClick={() => run(() => api.moveRole(r.id, r.next![0]))}>{r.next[1]}</button>}
        {(r.stage === 'found' || r.stage === 'drafted') && <button className="btn ghost" disabled={busy} onClick={() => run(() => api.moveRole(r.id, 'passed'))}>Not for me</button>}
      </div>
    </div>}
  </div>;
}

/** Interview prep for one role: the brief with every fact linked to its page, the likely questions and why, and what stays the person's. Written to read; nothing is sent. */
function Prep({ state, refresh, id }: Ctx & { id: string }) {
  const g = A.goal(state), r = g?.cols.flatMap((c) => c.roles).find((x) => String(x.id) === id), [busy, setBusy] = useState(false);
  if (!g || !r?.prep) return <div className="page stack rest-screen"><h1>Interview prep</h1><p className="st-line">{r?.prepping ? 'The writer is putting it together.' : 'Nothing is prepared for this role yet.'}</p><a className="btn go" href="#/goal">Back to Your goal</a></div>;
  const p = r.prep, practice = async () => { setBusy(true); try { await api.practiceRole(r.id); refresh(); location.hash = `#/h/${g.will}`; } finally { setBusy(false); } };
  return <div className="page stack goal-page prep-page">
    <a className="link" href="#/goal">‹ Your goal</a>
    <h1>{r.co}</h1><p className="st-line">{r.title} · {r.place}</p>
    <p className="mute small">Written for you to read. Nothing is sent, filled in or signed.</p>
    <div className="hire-sect">About {r.co}</div>
    <ul className="prep-list">{p.brief.map((b, i) => <li key={i}><span>{b.says}</span><span className="mute small">Source: <a className="link" href={b.url} target="_blank" rel="noopener noreferrer" title={b.quote}>{b.host}</a></span></li>)}</ul>
    <div className="hire-sect">Questions you may be asked</div>
    <ol className="prep-list">{p.questions.map((q, i) => <li key={i}><b>{q.ask}</b><span className="mute small">Why they ask: {q.why}</span></li>)}</ol>
    {!!p.yours.length && <div className="yours"><b>Only you can answer these</b>{p.yours.map((q, i) => <div key={i} className="yours-q"><span>{q}</span><i aria-hidden /></div>)}<span className="mute small">The crew leaves these empty and never writes an answer for them.</span></div>}
    <div className="btns"><button className="btn go" disabled={busy} onClick={() => void practice()}>Practice with the interviewer</button></div>
    <p className="mute small">The writer asks one question at a time in its own chat. Answer by typing or with the mic, and it says what landed and what to tighten.</p>
  </div>;
}

export function Goal(ctx: Ctx & { id?: string }) {
  const { state, refresh } = ctx, g = A.goal(state), [col, setCol] = useState('found');
  if (ctx.id) return <Prep {...ctx} id={ctx.id} />;
  if (!g) return <div className="page stack rest-screen"><h1>Your goal</h1><p className="st-line">Tell Chief the roles you want, where, and paste your CV. He shows you one card before anything starts.</p><a className="btn go" href="#/chief">Tell Chief</a></div>;
  return <div className="page stack goal-page">
    <h1>Your goal</h1>
    <p className="st-line">{g.title} · {g.places}{g.floor ? ` · from ${g.floor}` : ''}</p>
    <div className="goal-rules"><span>{A.GOAL_RULES.short}</span>
      <details><summary>See all the rules</summary>
        <div className="hire-sect">Only you do these</div>{A.GOAL_RULES.only.map((l) => <p key={l} className="role-li">{l}</p>)}
        <div className="hire-sect">The crew asks you. It never guesses these</div>{A.GOAL_RULES.asks.map((l) => <p key={l} className="role-li">{l}</p>)}
      </details></div>
    <div className="goal-chips" role="tablist">{g.cols.map((c) => <button key={c.key} role="tab" aria-selected={col === c.key} className={col === c.key ? 'on' : ''} onClick={(e) => { setCol(c.key); e.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest' }); }}>{c.name} {c.roles.length}</button>)}</div>
    <div className="goal-board">{g.cols.map((c) => <section key={c.key} className={col === c.key ? 'on' : ''} aria-label={c.name}>
      <h2>{c.name} <span className="mute">{c.roles.length}</span></h2><p className="mute small">{c.who}</p>
      {c.roles.length ? c.roles.map((r) => <RoleCard key={r.id} r={r} refresh={refresh} />) : <p className="mute small">Nothing here yet.</p>}
    </section>)}</div>
    <div className="hire-sect">On its own</div>{g.own.map((l) => <p key={l} className="role-li">{l}</p>)}
  </div>;
}
