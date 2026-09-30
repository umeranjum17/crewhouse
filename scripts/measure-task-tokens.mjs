// Historical/scripted usage evidence from tasks.tokens, not real-engine metering proof.
// Migration debt: the published OpenClaw kit emits no usage; BYOKit must supply per-run
// usage and ledger/cap contracts before claiming measured or enforced real-engine limits. Two modes:
//
//   node scripts/measure-task-tokens.mjs [--runs N] [--out report.md]
//     Throwaway crew on the scripted stub model (no account, no network, no quota):
//     recruits Scribe and Reel, runs each helper's representative jobs, waits for
//     each task to settle, and reads tasks.tokens out of crew.db.
//
//   node scripts/measure-task-tokens.mjs --state <state dir> [--out report.md]
//     Read-only: aggregates tasks.tokens by bot from an existing state dir (e.g. a
//     retained recorded usage). Opens crew.db read-only, starts nothing.
//
// Representative jobs are the helpers' own ideas (templates/scribe/bot.json,
// templates/reel/bot.json), so the numbers describe the jobs people actually tap.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Crew } from '../src/crew.ts';

/** One job per row: the helper's own idea asks, so a tap and this line cost the same shape of work. */
export const JOBS = [
  { bot: 'scribe', job: 'draft-email', text: 'Draft an email to the team about Friday demo day' },
  { bot: 'scribe', job: 'short-post', text: 'Write a short post about this link: https://example.test/launch' },
  { bot: 'scribe', job: 'spreadsheet', text: 'Make a spreadsheet for the launch checklist' },
  { bot: 'reel', job: 'demo-video', text: 'Make a 20-second demo video from these screenshots: the home screen, the chat, the desk' },
  { bot: 'reel', job: 'cut-clip', text: 'Cut a clip from this video (link, then from/to): https://example.test/demo.mp4, 0:10 to 0:30' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the condition, never a fixed time: slow disks settle late. */
async function until(what, fn, ms = 60_000) {
  for (const end = Date.now() + ms; !(await fn()); await sleep(100)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
}

/** The stub model bills (prompt + reply chars) / 4 per turn, summed into tasks.tokens by Crew. */
export async function measure({ runs = 1 } = {}) {
  process.env.CREWHOUSE_ENGINE ??= 'stub';
  process.env.CREWHOUSE_HOLD_MS ??= '300';
  process.env.CREWHOUSE_STUCK_MS ??= '5000';
  process.env.CREWHOUSE_SIGNIN_MS ??= '1500';
  const root = mkdtempSync(join(tmpdir(), 'crewhouse-task-tokens-'));
  const cfg = { ...loadConfig(), stateDir: join(root, 'state'), crewDir: join(root, 'crew'), toolsDir: join(root, 'tools'), engine: 'stub' };
  const db = new Store(cfg.stateDir);
  const crew = new Crew(cfg, db);
  crew.init();
  const rows = [];
  try {
    crew.onboard('Owner');
    crew.recruit('scribe', 'Scribe', 'person');
    crew.recruit('reel', 'Reel', 'person');
    for (let run = 1; run <= runs; run++) {
      for (const { bot, job, text } of JOBS) {
        const { task } = await crew.post(bot, run > 1 ? `${text} (run ${run})` : text);
        await until(`task #${task} settled`, () => !['queued', 'working'].includes(db.get('SELECT state FROM tasks WHERE id = ?', task)?.state));
        const t = db.get('SELECT state, tokens FROM tasks WHERE id = ?', task);
        const turns = db.get("SELECT COUNT(*) AS n FROM events WHERE kind = 'run.prompted' AND json_extract(data, '$.task') = ?", task)?.n ?? 0;
        rows.push({ bot, job, run, tokens: t.tokens ?? 0, turns, state: t.state });
      }
    }
    return { rows, meta: { engine: 'stub', runs, head: headOf(resolve(import.meta.dirname, '..')) } };
  } finally {
    crew.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Read-only aggregate of a live or past state dir: per-bot task counts and token stats. Starts nothing. */
export function readState(stateDir) {
  const db = new DatabaseSync(join(resolve(stateDir), 'crew.db'), { readOnly: true });
  try {
    const byBot = db.prepare('SELECT bot, COUNT(*) AS n, COALESCE(SUM(tokens), 0) AS sum, COALESCE(MAX(tokens), 0) AS max FROM tasks GROUP BY bot ORDER BY bot').all();
    for (const b of byBot) {
      const toks = db.prepare('SELECT tokens FROM tasks WHERE bot = ? AND tokens > 0 ORDER BY tokens').all(b.bot).map((r) => r.tokens);
      b.median = toks.length ? toks[Math.floor((toks.length - 1) / 2)] : 0;
      b.withTokens = toks.length;
    }
    const recent = db.prepare('SELECT id, bot, substr(title, 1, 60) AS title, state, COALESCE(tokens, 0) AS tokens FROM tasks ORDER BY id DESC LIMIT 20').all();
    return { byBot, recent };
  } finally {
    db.close();
  }
}

const stats = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return { n: s.length, max: s.at(-1) ?? 0, median: s.length ? s[Math.floor((s.length - 1) / 2)] : 0 };
};

export function report({ rows, meta = {} }) {
  const head = ['| bot | job | run | tokens | turns | state |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.bot} | ${r.job} | ${r.run} | ${r.tokens} | ${r.turns} | ${r.state} |`)];
  const lines = ['', '| bot | tasks | max tokens | median tokens |', '|---|---|---|---|'];
  for (const bot of [...new Set(rows.map((r) => r.bot))]) {
    const s = stats(rows.filter((r) => r.bot === bot).map((r) => r.tokens));
    lines.push(`| ${bot} | ${s.n} | ${s.max} | ${s.median} |`);
  }
  const top = Math.max(0, ...rows.map((r) => r.tokens));
  return {
    summary: Object.fromEntries([...new Set(rows.map((r) => r.bot))].map((b) => [b, stats(rows.filter((r) => r.bot === b).map((r) => r.tokens))])),
    text: [`source: crewhouse ${meta.head || 'unknown'}; engine: ${meta.engine ?? 'a past state dir'}; runs: ${meta.runs ?? 1}`,
      `largest single task observed: ${top} tokens (supplied usage events only; not proof of real-engine metering or caps).`, '', ...head, ...lines, ''].join('\n'),
  };
}

/** The exact source this run came from, never a branch name or a remembered head. */
function headOf(repoDir) {
  try { return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

export function parseArgs(argv) {
  const o = { runs: 1, out: '', state: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--out') o.out = String(argv[++i]);
    else if (a === '--state') o.state = String(argv[++i]);
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('usage: node scripts/measure-task-tokens.mjs [--runs N] [--out report.md] [--state <state dir>]');
    process.exit(0);
  }
  const out = opts.state
    ? (() => { const { byBot, recent } = readState(opts.state); return { text: [`read-only aggregate of ${opts.state}`, '', '| bot | tasks | with tokens | total | max | median |', '|---|---|---|---|---|---|', ...byBot.map((b) => `| ${b.bot} | ${b.n} | ${b.withTokens} | ${b.sum} | ${b.max} | ${b.median} |`), '', '| id | bot | title | state | tokens |', '|---|---|---|---|---|', ...recent.map((t) => `| ${t.id} | ${t.bot} | ${t.title} | ${t.state} | ${t.tokens} |`), ''].join('\n') }; })()
    : report(await measure(opts));
  console.log(out.text);
  if (opts.out) writeFileSync(opts.out, `${out.text}\n`);
}
