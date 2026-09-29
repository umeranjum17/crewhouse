// What the retained subscription route costs before its first REAL model words, and whether Chief's normal first-turn
// prompt changes it. Raw: the pinned Gateway, one `agent` RPC per run, and the first non-empty assistant text event.
// No routing, no crew prompt assembly by crewd, no tools, no local acknowledgement — the floor under all of them.
//
//   node scripts/measure-firstwords.mjs --state <state dir> --crew <crew dir> [--runs 10] [--variants tiny,chief]
//                                       [--body "Plan dinners for the week."] [--wait 120000] [--out report.md]
//
// Each run gets its own session key under a fresh --tag, so a repeat run is a fresh first turn, not a warm session.
// The variants are interleaved (tiny, chief, tiny, chief…) rather than measured in two blocks, so a slow stretch of
// the route lands on both and the per-run table shows it.
//
// The state's crewd MUST be stopped: this starts its own pinned Gateway on that state dir (the engine admits one at a
// time), so a live crewd would be taken over. It refuses rather than doing that. `--provider <baseUrl> <apiKey>`
// points the engine at the scripted model — for the harness's own test only, never a signed-in home.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenClawRuntime } from '../src/openclaw/runtime.ts';
import { loadConfig } from '../src/config.ts';
import { addressLine, listSkills, readNotes, systemPrompt } from '../src/bots.ts';

const TARGET_MS = 3000;

/** Every run of one variant: what was sent, and the epoch offsets the route actually paid. */
const stats = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const at = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0;
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return { n: sorted.length, min: sorted[0] ?? 0, median: mid, p90: at(0.9), max: sorted.at(-1) ?? 0 };
};

export function parseArgs(argv) {
  const o = { runs: 10, variants: ['tiny', 'chief'], body: 'Plan dinners for the week.', out: '', state: '', crew: '', address: '', provider: null, tag: Date.now().toString(36), wait: 120_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--variants') o.variants = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--body') o.body = String(argv[++i]);
    else if (a === '--out') o.out = String(argv[++i]);
    else if (a === '--tag') o.tag = String(argv[++i]);
    else if (a === '--wait') o.wait = Number(argv[++i]);
    else if (a === '--address') o.address = String(argv[++i]);
    else if (a === '--state') o.state = resolve(expand(String(argv[++i])));
    else if (a === '--crew') o.crew = resolve(expand(String(argv[++i])));
    else if (a === '--provider') { const baseUrl = String(argv[++i]); o.provider = { baseUrl, apiKey: String(argv[++i]) }; }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}
const expand = (p) => p.replace(/^~(?=\/|$)/, process.env.HOME ?? '~');

/** The two things a first turn can differ by: what it carries, and what it asks for. The crew line stands in the
 *  folder id for the display name (crewd reads that from SQLite); everything else is the file it really reads. */
export function variants(argv, cfg, body, address = '') {
  const about = readNotes(cfg, { member: 1, bot: null }).trim();
  const notes = readNotes(cfg, { member: 1, bot: 'chief' }).trim();
  const ids = existsSync(join(cfg.crewDir, 'bots')) ? readdirSync(join(cfg.crewDir, 'bots')) : [];
  const crew = ids.filter((id) => id !== 'chief').map((id) => `${id} (id ${id})`).join('; ') || 'nobody yet';
  const skills = listSkills(cfg, 'chief');
  const system = systemPrompt(cfg, 'chief', true)
    + (skills.length ? `\n## Skills you follow\n${skills.map((s) => `- ${s.name}: ${s.description || 'how you do this kind of job'}`).join('\n')}\n` : '');
  // Chief's first turn as crewd composes it (src/crew.ts prompt(), Chief branch; a fresh thread carries no history).
  const message = `[Crewhouse] ${addressLine(address || null)}`
    + `${about ? `\nWhat the whole crew knows about the person:\n${about}` : ''}`
    + `${notes ? `\nYour notes (what you have learned about how they like your work):\n${notes}` : ''}\n\n`
    + `[Crewhouse] Crew: ${crew}.\nThe person says: ${body}`;
  const all = {
    tiny: { system: 'You are a test harness.', message: 'Reply with the single word: ready.', thinking: undefined },
    chief: { system, message, thinking: 'low' },
    'chief-plain': { system, message, thinking: undefined },
  };
  return argv.map((name) => {
    const v = all[name];
    if (!v) throw new Error(`no variant ${name} (try tiny, chief, chief-plain)`);
    return { name, ...v, systemChars: v.system.length, messageChars: v.message.length };
  });
}
/** What actually differs between the variants, so a difference is never read as context size alone. */
const difference = (vs) => vs.map((v) => `${v.name}: ${v.systemChars} char system, thinking ${v.thinking ?? 'off/default'}`).join(' · ');
const tokens = (chars) => Math.round(chars / 4);

/** A crewd that is already up owns this state's Gateway. Starting ours would take it over, so this refuses. */
function crewdAlive(stateDir) {
  const f = join(stateDir, 'crewd.pid');
  if (!existsSync(f)) return 0;
  const pid = Number(readFileSync(f, 'utf8').trim());
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmd.includes('main.ts') ? pid : 0;
  } catch { return 0; }
}

/** One raw turn: send, wait, and time the first assistant text the engine streams back. Events are timestamped as
 *  they arrive (the words often land after the `agent` call returns), and read out once the run has ended. */
export async function oneRun(kit, agentId, variant, tag, waitMs = 120_000) {
  const seen = [];
  const off = kit.onEvent('agent', (payload) => { if (payload?.runId) seen.push({ at: Date.now(), ...payload }); });
  try {
    const started = Date.now();
    const run = await kit.call('agent', {
      agentId, sessionKey: `agent:m1:crewhouse:firstwords:${tag}`.replace(/[^a-zA-Z0-9:._-]/g, '-'), message: variant.message,
      extraSystemPrompt: variant.system, idempotencyKey: randomUUID(),
      ...(variant.thinking ? { thinking: variant.thinking } : {}),
    }, { timeoutMs: 60_000 });
    if (!run?.runId) throw new Error('the engine returned no run');
    const done = await kit.call('agent.wait', { runId: run.runId, timeoutMs: waitMs }, { timeoutMs: waitMs + 10_000 }).catch((e) => ({ status: 'timeout', error: String(e?.message ?? e) }));
    const mine = seen.filter((s) => s.runId === run.runId);
    const words = mine.find((s) => s.stream === 'assistant' && typeof s.data?.text === 'string' && s.data.text.length > 0);
    const tool = mine.find((s) => s.stream === 'tool' && typeof s.data?.name === 'string');
    return {
      firstWordsMs: words ? words.at - started : null,
      firstToolMs: tool ? tool.at - started : null,
      totalMs: Date.now() - started,
      status: String(done?.status ?? ''),
      error: done?.error ? String(done.error).slice(0, 160) : '',
      reply: String(done?.terminalReply?.text ?? '').slice(0, 120),
    };
  } finally { off(); }
}

export async function measure(opts) {
  const cfg = { ...loadConfig(), stateDir: opts.state, crewDir: opts.crew, repoDir: resolve(import.meta.dirname, '..') };
  const pid = crewdAlive(opts.state);
  if (pid) throw new Error(`crewd (pid ${pid}) is running on ${opts.state}; stop it first — this starts its own Gateway on that state`);
  // A signed-in home has started once, so it exists and its engine config is there; the stub harness's throwaway one may not.
  if (!opts.provider && (!existsSync(opts.state) || !existsSync(join(opts.state, 'openclaw', 'openclaw.json'))))
    throw new Error(`no engine state at ${opts.state}; give the state dir of a Crewhouse that has started once`);
  const vs = variants(opts.variants, cfg, opts.body, opts.address);
  const runtime = new OpenClawRuntime(opts.state, opts.crew);
  const kit = runtime.kit;
  const rows = [];
  try {
    await runtime.start({ tools: () => [], gate: async () => ({ allow: false, reason: 'no tools in a measured turn' }), call: async () => '' });
    if (opts.provider) await runtime.configureModelProvider(opts.provider.baseUrl, opts.provider.apiKey);
    await kit.ensureMember('m1');
    const providers = await kit.providers('m1').catch(() => []);
    if (!opts.provider && !providers.includes('openai')) throw new Error(`no ChatGPT sign-in on this state (signed in: ${providers.join(', ') || 'nobody'}); nothing was measured`);
    const cfgNow = await kit.call('config.get', {}, { timeoutMs: 20_000 }).catch(() => undefined);
    const model = String(cfgNow?.config?.agents?.defaults?.model?.primary ?? "the account's own default");
    // Interleaved, not blocked: provider-side drift then shows up in both variants instead of on whichever ran last.
    for (let i = 0; i < opts.runs; i++) for (const v of vs) rows.push({ variant: v.name, run: i + 1, ...(await oneRun(kit, 'm1', v, `${opts.tag}:${v.name}:${i + 1}`, opts.wait)) });
    return { variants: vs, rows, meta: { state: opts.state, crew: opts.crew, model, body: opts.body, runs: opts.runs, providers, head: headOf(cfg.repoDir) } };
  } finally { await runtime.stop(); }
}

export function report({ variants: vs, rows, meta = {} }) {
  const names = vs.map((v) => v.name);
  const head = ['', '| what | value |', '|---|---|',
    `| source | crewhouse ${meta.head || 'unknown'} |`,
    `| state | ${meta.state ?? '?'} |`,
    `| crew | ${meta.crew ?? '?'} |`,
    `| model route | ${meta.model ?? '?'} |`,
    `| signed in | ${(meta.providers ?? []).join(', ') || 'nobody'} |`,
    `| what the variants differ by | ${difference(vs)} |`,
    '| run order | interleaved, so route drift lands on every variant |',
    `| prompt under test | ${meta.body ?? '?'} |`];
  const lines = ['| variant | prompt (chars ≈ tokens) | system | runs | min | median | p90 | max | no words |', '|---|---|---|---|---|---|---|---|---|'];
  const summary = {};  for (const v of vs) {
    const mine = rows.filter((r) => r.variant === v.name);
    const words = mine.map((r) => r.firstWordsMs).filter((n) => typeof n === 'number');
    const s = stats(words);
    summary[v.name] = s;
    lines.push(`| ${v.name} | ${v.messageChars} ≈ ${tokens(v.messageChars)} tok | ${v.systemChars} ≈ ${tokens(v.systemChars)} tok | ${s.n} | ${s.min} | ${s.median} | ${s.p90} | ${s.max} | ${mine.length - words.length} |`);
  }
  const perRun = ['', '| variant | run | first real words (ms) | first tool (ms) | whole run (ms) | status | reply |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.variant} | ${r.run} | ${r.firstWordsMs ?? 'none'} | ${r.firstToolMs ?? '—'} | ${r.totalMs} | ${r.status}${r.error ? `: ${r.error}` : ''} | ${r.reply.replace(/\|/g, '/')} |`)];
  const floor = Math.min(...names.map((n) => summary[n].median || Infinity));
  const verdict = [`Raw first-real-word floor (best variant median): ${Number.isFinite(floor) ? `${floor} ms` : 'not measured'}; target ${TARGET_MS} ms.`,
    Number.isFinite(floor) && floor <= TARGET_MS ? 'The route floor meets the target.' : 'The route floor alone exceeds the target: the target is not reachable on this route by first-turn context or streaming changes.'];
  return { summary, text: [...verdict, ...head, '', ...lines, ...perRun, ''].join('\n') };
}

/** The exact source this run came from, never a branch name or a remembered head. */
function headOf(repoDir) {
  try { return execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.state || !opts.crew) {
    console.log('usage: node scripts/measure-firstwords.mjs --state <dir> --crew <dir> [--runs 10] [--variants tiny,chief\,chief-plain] [--address "Sam"] [--body "..."] [--wait 120000] [--tag t] [--out report.md]');
    process.exit(opts.help ? 0 : 2);
  }
  const out = report(await measure(opts));
  console.log(out.text);
  if (opts.out) writeFileSync(opts.out, `${out.text}\n`);
}
