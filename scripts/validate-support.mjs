// Checks what a support desk run left behind against crewd's own record, never the helper's word: the session file
// (every tool call and its result, written by the engine where the bot can't write) and crewd's events.
//   node scripts/validate-support.mjs <task-id> [--forbid <text>]...
// --forbid: a backtest's answer (the owner's comment, the fix's PR); a tool call that reached it marks the run contaminated.
// Prints PASS, FAIL or UNKNOWN per criterion; exits 1 on any FAIL. UNKNOWN means it could not be determined, and says why.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const CITE = /([\w./-]+\.[\w]+):(\d+)@([0-9a-f]{7,40})/g;

/** Every tool call in a session file, with its result's first line and whether it errored. */
export function calls(file) {
  const out = new Map();
  for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const m = JSON.parse(l).message;
    if (m?.role === 'assistant') for (const c of m.content ?? []) if (c.type === 'toolCall') out.set(c.id, { name: c.name, args: c.arguments ?? {} });
    if (m?.role === 'toolResult' && out.has(m.toolCallId)) Object.assign(out.get(m.toolCallId), { error: m.isError, head: (m.content?.[0]?.text ?? '').split('\n')[0] });
  }
  return [...out.values()];
}

export function validate({ db, crewDir }, id, forbid = []) {
  const t = db.get('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw new Error(`no task ${id}`);
  const bot = join(crewDir, 'bots', t.bot), rows = [], row = (verdict, what, detail) => rows.push({ verdict, what, detail });
  const ev = (kind) => db.all('SELECT data FROM events WHERE kind = ? AND json_extract(data, \'$.task\') = ?', kind, id).map((e) => JSON.parse(e.data));
  const delivered = ev('file.delivered').map((e) => e.path);
  const all = t.session && existsSync(t.session) ? calls(t.session) : null;
  row(t.state === 'done' ? 'PASS' : t.state === 'unsure' ? 'UNKNOWN' : 'FAIL', 'ended', t.state);
  if (!all) return row('UNKNOWN', 'record', 'no session file: nothing it did can be checked'), rows;

  // 1. Real input: every issue it wrote about was read, as crewd recorded it (2xx from web_fetch).
  const read = new Set(all.filter((c) => c.name === 'web_fetch' && !c.error && /^2\d\d /.test(c.head ?? ''))
    .map((c) => /\/issues\/(\d+)(?:$|[/?#])/.exec(String(c.args.url))?.[1]).filter(Boolean));
  const viaShell = all.filter((c) => c.name === 'bash' && /\/issues\/\d+/.test(String(c.args.command))).length;
  const about = [...new Set(delivered.map((p) => /^files\/support\/(\d+)\//.exec(p)?.[1]).filter(Boolean))];
  const unread = about.filter((n) => !read.has(n));
  row(!about.length ? 'FAIL' : unread.length ? 'FAIL' : 'PASS', 'issues read',
    `wrote about ${about.map((n) => `#${n}`).join(', ') || 'none'}; read ${[...read].map((n) => `#${n}`).join(', ') || 'none'}` +
    (unread.length ? `; never read ${unread.map((n) => `#${n}`).join(', ')}` : '') + (viaShell ? `; ${viaShell} shell command(s) name an issue (status unseen)` : ''));

  // 2. Citations: each path:line@commit exists at that commit, in one of its clones.
  const clones = existsSync(join(bot, 'work')) ? readdirSync(join(bot, 'work')).map((d) => join(bot, 'work', d)).filter((d) => existsSync(join(d, '.git'))) : [];
  const lines = (sha1, path) => {
    for (const c of clones) try { return execFileSync('git', ['-C', c, 'show', `${sha1}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).split('\n').length; } catch { /* not in this clone */ }
    return 0;
  };
  for (const p of delivered.filter((p) => /(triage|reply)\.md$/.test(p))) {
    const text = existsSync(join(bot, p)) ? readFileSync(join(bot, p), 'utf8') : '';
    const cites = [...text.matchAll(CITE)], bad = cites.filter(([, path, line, c]) => lines(c, path) < Number(line));
    row(!cites.length || bad.length ? 'FAIL' : 'PASS', `citations in ${p}`,
      !cites.length ? 'none: no claim can be checked' : `${cites.length - bad.length} of ${cites.length} found` + (bad.length ? `; not there: ${bad.map((b) => b[0]).join(', ')}` : ''));
  }

  // 3. Each reply was put before the person, and their answer is on the record for these exact words.
  for (const p of delivered.filter((p) => p.endsWith('reply.md'))) {
    const now = existsSync(join(bot, p)) ? sha(readFileSync(join(bot, p), 'utf8').trim()) : null;
    const said = [...ev('draft.approved').map((d) => ({ ...d, a: 'approved' })), ...ev('draft.rejected').map((d) => ({ ...d, a: 'rejected' }))].filter((d) => d.path === p);
    const card = db.get("SELECT 1 FROM asks WHERE kind = 'propose' AND json_extract(detail, '$.task') = ? AND json_extract(detail, '$.draft.path') = ?", id, p);
    if (said.length) row(said.some((d) => d.sha === now) ? 'PASS' : 'FAIL', `answer on ${p}`, said.map((d) => `${d.a}${d.sha === now ? '' : ' (different words)'}`).join(', '));
    else row(card ? 'UNKNOWN' : 'FAIL', `answer on ${p}`, card ? 'on a card, not answered yet' : 'never put before the person');
  }

  // 4. A patch counts only if crewd saw it fail before and pass after, for this exact file.
  const ok = new Set(db.all("SELECT data FROM events WHERE kind = 'verify.result' AND bot = ?", t.bot).map((e) => JSON.parse(e.data)).filter((v) => v.passed).map((v) => v.sha));
  const patches = delivered.filter((p) => /\.(patch|diff)$/.test(p));
  for (const p of patches) row(existsSync(join(bot, p)) && ok.has(sha(readFileSync(join(bot, p), 'utf8'))) ? 'PASS' : 'FAIL', `fix ${p}`, 'failed before, passed after, seen by crewd');
  if (!patches.length) row('PASS', 'fix', 'none offered (nothing claimed)');

  // 5. Blind: nothing it called reached the answer.
  if (forbid.length) {
    const hit = all.filter((c) => forbid.some((f) => JSON.stringify(c.args).includes(f)));
    row(hit.length ? 'FAIL' : 'PASS', 'blind', hit.length ? `contaminated: ${hit.map((c) => `${c.name} ${JSON.stringify(c.args).slice(0, 120)}`).join('; ')}` : `none of ${forbid.length} answer address(es) was reached`);
  } else row('UNKNOWN', 'blind', 'not a backtest: no answer given to check against');

  row(t.tokens ? 'PASS' : 'UNKNOWN', 'tokens', t.tokens ? `${t.tokens} (crewd's count)` : 'none recorded');
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, ...rest] = process.argv.slice(2);
  const forbid = rest.flatMap((a, i) => (rest[i - 1] === '--forbid' ? [a] : []));
  const { loadConfig } = await import('../src/config.ts');
  const { Store } = await import('../src/db.ts');
  const cfg = loadConfig();
  const rows = validate({ db: new Store(cfg.stateDir), crewDir: cfg.crewDir }, Number(id), forbid);
  for (const r of rows) console.log(`${r.verdict.padEnd(7)} ${r.what}: ${r.detail}`);
  process.exitCode = rows.some((r) => r.verdict === 'FAIL') ? 1 : 0;
}
