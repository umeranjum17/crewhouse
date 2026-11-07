// What a failure means, and the one line that gets past it. bin/crewhouse.mjs and doctor share it; no dependencies, so it runs where Crewhouse can't.
import { dirname } from 'node:path';

const cmd = () => process.env.CREWHOUSE_CMD ?? './crewhouse';
const KNOWN = [
  // A BYOKit check: it refuses a sign-in folder that is not the person's alone. `start` closes their own group-writable ones first; this is a folder that is someone else's.
  [/Automatic host key requires/, () => ['The folder your sign-ins would be kept in is not private to you (it belongs to someone else, or others can write to it), so Crewhouse will not use it', `sudo chown "$(id -un)" "\${XDG_STATE_HOME:-$HOME/.local/state}" && chmod go-w "\${XDG_STATE_HOME:-$HOME/.local/state}" && ${cmd()} start`]],
  [/EADDRINUSE.*:(\d+)/, ([, port]) => [`Another program is already using port ${port}`, `close that program, or pick a free port: CREWHOUSE_PORT=<port> ${cmd()} start`]],
  [/(?:EACCES|EPERM)\b.*'(.+?)'/, ([, path]) => [`Crewhouse is not allowed to write to ${dirname(path)}`, `give that folder back to your account: sudo chown -R "$(id -un)" "${dirname(path)}" && chmod -R u+rwX "${dirname(path)}"`]],
];

/** `text` is an error's message or a log's tail: `raw` is its last error line, `cause` that in plain words, `next` the one line to type (absent when the cause is unknown). */
export function why(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const raw = lines.findLast((l) => /^\w*Error\b/.test(l)) ?? lines.at(-1) ?? 'it stopped without saying why';
  for (const [pattern, words] of KNOWN) {
    const m = raw.match(pattern);
    if (m) { const [cause, next] = words(m); return { cause, raw, next }; }
  }
  return { cause: raw, raw };
}
