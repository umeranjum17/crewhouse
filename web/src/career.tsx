// Your path to the US (#/goal/path): four stages, each a tap away from its detail, and under each tap the sources.
// Information only. Nothing here asks the person anything or sends anything; the plan is the same for everyone (web/src/career.ts).
import { useState } from 'react';
import { PATH_NOTE, path, type PathItem } from './career.ts';

function Item({ it }: { it: PathItem }) {
  return <details className="path-item">
    <summary><b>{it.title}</b><span className="mute">{it.line}</span></summary>
    {it.claims.map((c, i) => <div key={i} className="path-claim">
      <p>{c.says}</p>
      <p className="mute small path-quote">{c.row ? c.quote : `“${c.quote}”`}</p>
      <p className="mute small">{c.by}: <a className="link inline" href={c.url} target="_blank" rel="noopener noreferrer">{c.page}</a>, {c.when}</p>
    </div>)}
    {it.note && <p className="path-note">{it.note}</p>}
  </details>;
}

export function Career() {
  const plan = path(), [open, setOpen] = useState('');
  return <div className="page stack goal-page path-page">
    <a className="link" href="#/goal">‹ Your goal</a>
    <h1>Your path to the US</h1>
    <p className="st-line">From a job like yours, to a gateway employer, to a US role. This is information, not legal advice.</p>
    <ol className="path-stages">{plan.map((s, n) => <li key={s.key} className={open === s.key ? 'on' : ''}>
      <button className="path-head" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? '' : s.key)}>
        <i aria-hidden>{n + 1}</i><span><b>{s.name}</b><span className="mute">{s.line}</span></span>
      </button>
      {open === s.key && <div className="path-body">
        {s.items.map((it) => <Item key={it.title} it={it} />)}
        {s.note && <p className="path-note">{s.note}</p>}
      </div>}
    </li>)}</ol>
    <div className="goal-rules">{PATH_NOTE.map((l) => <p key={l} className="role-li">{l}</p>)}</div>
  </div>;
}
