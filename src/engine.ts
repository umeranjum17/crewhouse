// crewd's own helpers the agent runtime calls into: the bubblewrap shell (crewd's security boundary), keyless page
// reads, and pinned AXI runs. No engine protocol here — the tool type is Crewhouse's own.
import { execFile, execFileSync } from 'node:child_process';
import { BRIDGE } from './net.ts';
import { Type } from 'typebox';

// Shared by crew execution and engine registration, including tools available before a run exists.
export const PARAMETERS = {
  shell: Type.Object({ command: Type.String() }), browser: Type.Object({ args: Type.Array(Type.String()) }), calendar: Type.Object({ args: Type.Array(Type.String()) }), mail: Type.Object({ args: Type.Array(Type.String()) }),
  crew_app: Type.Object({ tool: Type.String(), input: Type.Optional(Type.Object({}, { additionalProperties: true })) }), crew_web_fetch: Type.Object({ url: Type.String() }), crew_web_search: Type.Object({ query: Type.String() }),
  crew_read: Type.Object({ path: Type.String() }), crew_write: Type.Object({ path: Type.String(), content: Type.String() }), crew_edit: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
  crew_ls: Type.Object({ path: Type.Optional(Type.String()) }), crew_grep: Type.Object({ path: Type.String(), pattern: Type.String() }), crew_find: Type.Object({ path: Type.Optional(Type.String()) }), crew_inspect: Type.Object({ path: Type.String(), what: Type.String({ enum: ['type', 'headers', 'strings', 'symbols', 'sections'] }) }),
  crew_connect: Type.Object({ app: Type.String() }), crew_signin: Type.Object({ site: Type.String() }), crew_unlock: Type.Object({ files: Type.Union([Type.Array(Type.String()), Type.String()]) }), crew_outcome: Type.Object({ worked: Type.Boolean(), seen: Type.String() }), crew_report: Type.Object({ text: Type.String() }),
  crew_deliver: Type.Object({ path: Type.String(), note: Type.Optional(Type.String()) }),
  crew_workbook: Type.Object({ name: Type.String(), sheets: Type.Array(Type.Object({ name: Type.String(), columns: Type.Array(Type.Object({ header: Type.String(), width: Type.Optional(Type.Number()), options: Type.Optional(Type.Array(Type.String())) })), rows: Type.Array(Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]))) })), charts: Type.Optional(Type.Array(Type.Object({ type: Type.String({ enum: ['bar', 'line', 'pie'] }), title: Type.Optional(Type.String()), sheet: Type.Optional(Type.String()), categories: Type.String(), series: Type.Array(Type.Object({ name: Type.Optional(Type.String()), values: Type.String() })), at: Type.Optional(Type.String()) }))) }),
  crew_document: Type.Object({ name: Type.String(), blocks: Type.Array(Type.Object({}, { additionalProperties: true }), { minItems: 1 }) }), crew_copy: Type.Object({ from: Type.String(), to: Type.String() }),
  crew_video: Type.Object({ url: Type.String() }),
  crew_slides: Type.Object({ name: Type.String(), slides: Type.Array(Type.Object({ title: Type.String(), bullets: Type.Optional(Type.Array(Type.String())) }), { minItems: 1 }), style: Type.Optional(Type.String()) }),
  crew_rule: Type.Object({ text: Type.String({ maxLength: 1000 }) }),
  crew_remember: Type.Object({ text: Type.String(), replaces: Type.Optional(Type.String()), everyone: Type.Optional(Type.Boolean()) }),
  crew_draft: Type.Object({ path: Type.String(), channel: Type.String({ enum: ['email', 'message', 'post'] }), to: Type.String(), subject: Type.Optional(Type.String()), why: Type.Optional(Type.String()), link: Type.Optional(Type.String()) }),
  crew_verify: Type.Object({ repo: Type.String(), base: Type.String(), patch: Type.String(), tests: Type.Array(Type.String()), command: Type.String() }),
  crew_learn: Type.Object({ name: Type.String(), description: Type.String(), says: Type.String(), steps: Type.String() }),
  crew_routine: Type.Object({ bot: Type.Optional(Type.String()), when: Type.Optional(Type.String()), on: Type.Optional(Type.String()), task: Type.String(), name: Type.Optional(Type.String()), quiet: Type.Optional(Type.Boolean()), watch: Type.Optional(Type.String()), once: Type.Optional(Type.Boolean()) }),
  crew_profile: Type.Object({ text: Type.String({ maxLength: 4000 }) }), crew_add_phone: Type.Object({}),
  crew_roster: Type.Object({}),
  crew_import: Type.Object({ list: Type.Optional(Type.Boolean()), category: Type.Optional(Type.String()), slug: Type.Optional(Type.String()), skill: Type.Optional(Type.String()), name: Type.Optional(Type.String()), source: Type.Optional(Type.String()) }),
  crew_routines: Type.Object({}),
  crew_status: Type.Object({}), crew_use: Type.Object({ bot: Type.String(), account: Type.String(), model: Type.Optional(Type.String()) }), crew_suggest: Type.Object({ bot: Type.String(), text: Type.String() }),
  crew_create: Type.Object({ bot: Type.Optional(Type.String()), name: Type.Optional(Type.String()), role: Type.String(), job: Type.Object(Object.fromEntries(['does', 'aim', 'gets', 'how', 'great'].map((k) => [k, Type.String({ minLength: 1, maxLength: 600 })])), { additionalProperties: false }), personality: Type.Optional(Type.String()), first: Type.Optional(Type.String()), will_do: Type.Optional(Type.Array(Type.String())), wont_do: Type.Optional(Type.Array(Type.String())), first_step: Type.Optional(Type.String()), first_job: Type.Optional(Type.String()), apps: Type.Optional(Type.Array(Type.String())) }),
  crew_goal: Type.Object({ title: Type.String(), places: Type.String(), floor: Type.Optional(Type.String()), focus: Type.Optional(Type.String()), cv: Type.Optional(Type.String()), brief: Type.Optional(Type.String()), stages: Type.Optional(Type.Array(Type.String())) }),
  crew_role: Type.Object({ goal: Type.Optional(Type.Number()), company: Type.String(), title: Type.String(), place: Type.String(), url: Type.String(), pay: Type.Optional(Type.String()), fit: Type.Array(Type.Object({ says: Type.String(), cv: Type.String() })), missing: Type.String() }),
  crew_application: Type.Object({ role: Type.Number(), cv: Type.Array(Type.String()), answers: Type.Array(Type.Object({ ask: Type.String(), answer: Type.String() })), yours: Type.Optional(Type.Array(Type.String())) }),
  crew_form: Type.Object({ role: Type.Number(), stop: Type.Optional(Type.String()) }),
  crew_prep: Type.Object({ role: Type.Number(), brief: Type.Array(Type.Object({ says: Type.String(), part: Type.Optional(Type.String({ enum: ['company', 'role', 'loop'] })), url: Type.String(), quote: Type.String() })), questions: Type.Array(Type.Object({ ask: Type.String(), why: Type.String() })) }),
  crew_call_me: Type.Object({ how: Type.String() }), crew_case: Type.Object({ thread: Type.String(), facts: Type.String({ maxLength: 600 }) }), crew_recruit: Type.Object({ template: Type.String(), name: Type.Optional(Type.String()) }),
}, HELPER_ROUTINE = Type.Omit(PARAMETERS.crew_routine, ['bot', 'once']), CHIEF_ROUTINE = Type.Object({ ...PARAMETERS.crew_routine.properties, ...Type.Required(Type.Pick(PARAMETERS.crew_routine, ['bot'])).properties });

/** One tool a run may call: the spec the model sees, and crewd's own executor behind it. */
export interface CrewTool { name: string; description: string; parameters: object; run: (input: any, signal?: AbortSignal) => Promise<unknown> }

export const tool = (name: string, description: string, parameters: object, run: CrewTool['run']): CrewTool => ({ name, description, parameters, run });

export const said = async (t: CrewTool, input: any, signal?: AbortSignal) => {
  const value = await t.run(input, signal);
  return typeof value === 'string' ? value : JSON.stringify(value ?? { ok: true });
};

// ---- the shell: bubblewrap, where the bot's space is the only writable part of the disk ----
let sandboxOk: boolean | undefined;
/** Whether bubblewrap works here (it is missing on macOS, and some distros forbid the namespaces it needs). */
export function sandboxReady() {
  sandboxOk ??= (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', 'true'], { stdio: 'ignore', timeout: 5000 }); return true; } catch { return false; } })();
  return sandboxOk;
}

export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell command, sandboxed: /usr and /etc read-only, /home empty but for the space. No command ever asks. Network on,
 *  unless `net` is the socket of the bot's allowlisting proxy (src/net.ts): then its only way out is that proxy.
 *  ponytail: assumes a merged /usr (all current distros); without `net` a sandboxed shell can send data out anywhere. */
export const sandboxed = (space: string, readOnly: string[], env: Record<string, string>, command: string, net?: string) => {
  return [
    'exec bwrap --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib --symlink usr/lib64 /lib64',
    '--ro-bind /etc /etc --ro-bind-try /run/systemd/resolve /run/systemd/resolve --proc /proc --dev /dev --tmpfs /tmp --tmpfs /home',
    ...readOnly.map((d) => `--ro-bind-try ${q(d)} ${q(d)}`), `--bind ${q(space)} ${q(space)}`,
    ...(net ? [`--ro-bind ${q(process.execPath)} /run/crewhouse/node --bind ${q(net)} /run/crewhouse/net.sock`] : []),
    '--clearenv', ...Object.entries({ ...env, HOME: space, LANG: 'C.UTF-8', TERM: 'dumb', PATH: `${env.PATH ? env.PATH + ':' : ''}/usr/local/bin:/usr/bin`,
      ...(net ? { ...Object.fromEntries(['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'npm_config_proxy', 'npm_config_https_proxy'].map((k) => [k, 'http://127.0.0.1:3128'])), NODE_USE_ENV_PROXY: '1' } : {}) }).map(([k, v]) => `--setenv ${k} ${q(v)}`),
    `--chdir ${q(space)} --unshare-all ${net ? '' : '--share-net '}--die-with-parent -- bash -c`,
    q(net ? `/run/crewhouse/node -e ${q(BRIDGE)} /run/crewhouse/net.sock >/dev/null 2>&1 & for _ in $(seq 100); do [ -e /tmp/.crewhouse-net ] && break; sleep 0.05; done; ${command}` : command)].join(' ');
};
/** One command in the sandbox, run by crewd itself: its exit code and the tail of its output are crewd's to read. */
export const runSandboxed = (space: string, readOnly: string[], env: Record<string, string>, command: string, net?: string, timeout = 1_200_000, stdin = '') =>
  new Promise<{ code: number; tail: string }>((resolve) => void execFile('bash', ['-c', sandboxed(space, readOnly, env, command, net)],
    { cwd: space, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout, maxBuffer: 64 << 20 },
    (err: any, out, errOut) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, tail: `${out}${errOut}`.slice(-1000) })).stdin?.on('error', () => {}).end(stdin));

/** The shell as one crewd-owned tool: a timeout and an output tail, like the engine's own bash was. A command that
 *  failed comes back as a failure (the house's `error: …`), with the cause first, so the model reads a real reason
 *  instead of a wall of output. `note` is the kit's own words about the program that failed, when it has any. */
export const bashTool = (space: string, readOnly: string[], env: Record<string, string>, net?: string, note?: (program: string) => string) =>
  tool('bash', 'Run a shell command in your own space (a sandbox: your folder is the only writable part of the disk). ' +
    'Long output is cut to the last lines.', PARAMETERS.shell,
    async (p) => {
      const r = await runSandboxed(space, readOnly, env, String(p.command ?? ''), net);
      if (r.code === 0) return r.tail;
      const program = String(p.command ?? '').trim().split(/\s+/)[0] ?? '', cause = r.tail.trim().split('\n').filter(Boolean).at(-1) ?? '', said = note?.(program);
      return `error: ${program} failed (exit ${r.code})${cause ? `: ${cause}` : ''}\n${r.tail}${said ? `\n${said}` : ''}`;
    });

// ---- the web, without a key ----
const plain = (html: string) => html.replace(/<(script|style|noscript)[^]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** A page's status and readable text, as a bot's web_fetch and a routine's watch both read it. With `may`, every address
 *  on the way (each redirect too) must pass it, or the read is refused. */
export async function readPage(url: string, signal?: AbortSignal, may?: (u: URL) => boolean) {
  let u = new URL(url), res: Response;
  for (let hops = 0; ; hops++) {
    if (may && !may(u)) throw new Error(`${u.hostname} is not on this helper's list of places it may reach`);
    res = await fetch(u, { signal: signal ?? AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' }, redirect: may ? 'manual' : 'follow' });
    const to = res.headers.get('location');
    if (!may || res.status < 300 || res.status >= 400 || !to || hops >= 5) break;
    u = new URL(to, u);
  }
  const body = await res.text(), about = /<meta (?:name|property)="(?:og:)?description" content="([^"]*)"/i.exec(body)?.[1] ?? ''; // a page drawn by script (Ashby) keeps its words there
  return { status: res.status, text: (/html/.test(res.headers.get('content-type') ?? '') ? plain(`${about} ${body}`) : body).slice(0, 20_000) };
}

/** crewd's own checked web tools: every hop stays on the helper's list (a fenced helper's only way to the web). */
export const webTools = (may?: (u: URL) => boolean) => [
  tool('web_fetch', 'Fetch a web page and return its text.', PARAMETERS.crew_web_fetch,
    async (p, signal) => { const page = await readPage(String(p.url), signal, may); return `${page.status} ${p.url}\n${page.text}`; }),
  // ponytail: DuckDuckGo's plain HTML results page, no key; swap for a search API if it starts refusing.
  tool('web_search', 'Search the web; returns titles, links and snippets.', PARAMETERS.crew_web_search,
    async (p, signal) => {
      if (may && !may(new URL('https://html.duckduckgo.com/'))) throw new Error("searching the web is not on this helper's list of places it may reach");
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(p.query))}`, { signal: signal ?? AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' } }), html = await res.text(), hits = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([^]*?)<\/a>[^]*?class="result__snippet"[^>]*>([^]*?)<\/a>/g)].slice(0, 8)
        .map(([, href, title, snip]) => { const u = /uddg=([^&]+)/.exec(href)?.[1]; return `${plain(title)} — ${u ? decodeURIComponent(u) : href}\n  ${plain(snip)}`; });
      return hits.join('\n') || 'No results.';
    }),
];

/** Run a pinned AXI by its absolute path on crewd's own node, with only the environment crewd gives it: never the
 *  owner's HOME, XDG folders or PATH, so it reads and writes nothing of theirs. */
export function runAxi(script: string, args: string[], cwd: string, env: Record<string, string>, signal?: AbortSignal, cap = 30_000) {
  return new Promise<string>((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd, env, timeout: 120_000, maxBuffer: 8 << 20, signal }, (err, out, errOut) =>
      resolve(`${out}${errOut}${err && !out ? `\n(exit: ${err.message})` : ''}`.slice(0, cap)));
  });
}
