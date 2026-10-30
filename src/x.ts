// x-axi: read-only X search for the person's own API key, in place of fetching x.com pages that answer nothing.
// Recent search, a name's lookup and a user's posts only; the key stays inside crewd and never reaches a line below.
import { tool } from './engine.ts';

const base = () => /^http:\/\/127\.0\.0\.1:\d+$/.exec(process.env.CREWHOUSE_X_URL ?? '')?.[0] ?? 'https://api.x.com'; // a loopback stand-in only, for tests and proofs
const LINKS = "Until then I'll keep giving you search links to check yourself.";
const NO_X = `I can't read X yet. Add your own X API key under Apps, then ask again. ${LINKS}`;
const plain = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function get(key: string, path: string, q: Record<string, string>) {
  const res = await fetch(`${base()}/2/${path}?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) throw new Error(`X turned that key down, so I can't read X yet. Check or replace it under Apps. ${LINKS}`);
  if (res.status === 429) throw new Error("X is limiting reads right now. Try again in a few minutes.");
  if (!res.ok) throw new Error(`X said ${res.status}. Try again in a moment.`);
  return res.json() as Promise<any>;
}

/** Up to five posts, newest first: who, when, the words, the link. */
function lines(posts: any[], names: Map<string, string>, who?: string) {
  if (!posts.length) return 'No posts found.';
  return posts.slice(0, 5).map((p) => { const u = who ?? names.get(p.author_id) ?? 'i'; return `@${u} · ${plain(p.created_at, 10)} · “${plain(p.text, 240)}” · https://x.com/${u}/status/${p.id}`; }).join('\n');
}

async function run(token: () => Promise<string | null>, args: string[]) {
  const key = await token();
  if (!key) return NO_X;
  const [cmd, what = ''] = args, i = args.indexOf('--days'), days = Math.min(7, Math.max(1, Number(args[i + 1]) || 7)), start_time = new Date(Date.now() - days * 864e5 + 6e4).toISOString();
  try {
    if (cmd === 'search' && what.trim()) {
      const r = await get(key, 'tweets/search/recent', { query: `${what.trim()} -is:retweet`, max_results: '10', start_time, 'tweet.fields': 'created_at,author_id', expansions: 'author_id', 'user.fields': 'username' });
      return lines(r.data ?? [], new Map<string, string>((r.includes?.users ?? []).map((u: any) => [u.id, u.username])));
    }
    if (cmd === 'posts' && /^@?\w{1,15}$/.test(what)) {
      const name = what.replace('@', ''), id = (await get(key, `users/by/username/${name}`, {})).data?.id;
      if (!id) return `No account called @${name}.`;
      return lines((await get(key, `users/${id}/tweets`, { max_results: '10', start_time, 'tweet.fields': 'created_at', exclude: 'retweets,replies' })).data ?? [], new Map(), name);
    }
  } catch (e: any) { return e?.name === 'TimeoutError' || e?.cause ? "Couldn't reach X. Try again in a moment." : String(e.message); }
  return 'x can: search <words> [--days 1-7], or posts <name> [--days 1-7].';
}

export const xTool = (token: () => Promise<string | null>) =>
  tool('x', "Read X (read-only): search the last days of posts, or one account's recent posts, with the person's own key. Answers are lines of '@name · date · “post” · link'. Quote the sentence and the link. If it says it cannot read X yet, say that line once. Pass the arguments as a list, without the program name.",
    { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'], additionalProperties: false },
    (p) => run(token, (p.args ?? []).map(String)));
