// The one door for a bot's hands: its shell and its browser. crewd builds a bot's hands here from the `far` its bot.json
// names, and every bash call and browser action goes through them: the bot's own, and crewd's in that browser on the
// person's tap. One port, two adapters:
//  here: crewd's own sandboxed shell and pinned browser on this computer, handed in by crewd and run exactly as before;
//  far:  a stand-in for a far computer. It runs nothing: it writes each call to the pretend computer's calls.jsonl and
//        answers that nothing ran. The real hands program on a far computer is the next slice's, not this file's.
// A far call that cannot be made answers `error: …` in plain words, the house's failure (crewd records the call failed and
// the bot reads why), as a failed local run does; it never throws, and never turns into a run on this computer.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** A bot's hands. `far` is its bot.json's name for a far computer (none: here); `root` holds the pretend far computers. */
export function handsOf(far, root, here) {
  if (far === undefined) return { where: 'here', ...here };
  const ok = typeof far === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(far), where = `far:${ok ? far : '?'}`, call = async (tool, input) => {
    // bot.json sits in the bot's own folder, which the bot can write, so the name never becomes a path unchecked.
    if (!ok) return "error: this bot's far computer has a name Crewhouse can't use, so nothing ran.";
    const computer = join(root, far);
    if (!existsSync(computer)) return `error: the far computer "${far}" could not be reached, so nothing ran.`;
    try { appendFileSync(join(computer, 'calls.jsonl'), `${JSON.stringify({ tool, input })}\n`); } catch (e) { return `error: the far computer "${far}" could not take the call (${e.message}), so nothing ran.`; }
    return `far stand-in "${far}": your ${tool} call was written down; no computer ran it.`;
  };
  return { where, shell: (input) => call('bash', input), browser: (args) => call('browser', args) };
}
