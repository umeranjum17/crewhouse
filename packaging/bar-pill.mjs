// One snapshot per invocation; the desktop bar polls every 10 seconds. No member selector:
// loopback's default viewer is the owner. Even the tooltip carries only public counts.
import { OWNER, status } from '../web/src/adapter.ts';

let pill = { text: '', tooltip: '', class: 'quiet' };
try {
  const port = process.env.CREWHOUSE_PORT || '7711';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid port');
  const response = await fetch(`http://127.0.0.1:${port}/api/state`, {
    signal: AbortSignal.timeout(1500), redirect: 'error',
  });
  if (!response.ok) throw new Error('unavailable');
  const state = await response.json();
  if (state.person?.id !== OWNER) throw new Error('owner only');
  const crew = status(state, false);
  if (crew) pill = { text: crew.publicText, tooltip: crew.publicText, class: crew.needsYou ? 'ask' : 'working' };
} catch { /* Clear the last counts when the crew is quiet or unreachable. */ }
console.log(JSON.stringify(pill));
