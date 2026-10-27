import { LINK_WORDS } from '@byokit/pair';
import { MISSING, NO_COMPUTER, NO_LINK, NO_RELAY, OLD_LINK, TYPO } from '../../web/src/typed.ts';

const SAID = new Set<string>([...Object.values(LINK_WORDS), NO_COMPUTER, NO_RELAY, NO_LINK, OLD_LINK, TYPO, MISSING]);

/** One plain line for a pairing failure, and the retry is the action — never the machinery's own words.
 *  The link's own sentences already say which mistake it was (the computer said no, the code didn't match, that
 *  address is unreachable), so a message the link owns passes through as it is; only machinery text is replaced. */
export function pairWords(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? '');
  if (/isn't a pairing code/i.test(m)) return "That's not a Crewhouse code. Point the camera at the code on your computer, then try again.";
  if (/run out|expired/i.test(m)) return 'That code has run out. Show a new one on your computer, then try again.';
  if (SAID.has(m)) return m;
  if (/match|refus|wrong|no such|not found|unknown/i.test(m)) return "That code didn't match. Show a fresh one and try again.";
  if (/reach|network|timeout|address|relay|host/i.test(m)) return "Couldn't reach your computer. Check it's awake, then try again.";
  return 'That didn\'t go through. Check the code, then try again.';
}
