// What a failed turn means for the account it ran on: rest, sign in, or a plan without helpers. The words the kit
// classified by rule before; the engine reports the error text and this says what happens next. Anything unrecognised
// is null: that one task fails, the account is untouched.
export type Failure = { kind: 'rate_limit' | 'overloaded' | 'signed_out' | 'not_included' | 'network'; until: number };
export const REST_MS: Record<Failure['kind'], number> = { rate_limit: 60 * 60_000, overloaded: 5 * 60_000, signed_out: 0, not_included: 0, network: 0 };

/** `until` is 0 when the error didn't say. */
export function classifyText(error: string): Failure | null {
  const m = /try again in ~?(\d+)\s*(min|h|hour)/i.exec(error);
  const until = m ? Date.now() + Number(m[1]) * (/^h/.test(m[2]) ? 3_600_000 : 60_000) : 0;
  if (/your plan doesn't include/i.test(error)) return { kind: 'not_included', until };
  if (/usage limit|rate.?limit|quota|too many requests|\b429\b/i.test(error)) return { kind: 'rate_limit', until };
  if (/overloaded|high demand|\b50[234]\b|unavailable/i.test(error)) return { kind: 'overloaded', until };
  if (/unauthori[sz]ed|\b40[13]\b|sign in again|expired|invalid.*token|authentication/i.test(error)) return { kind: 'signed_out', until };
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN|socket hang up/i.test(error)) return { kind: 'network', until };
  return null;
}
