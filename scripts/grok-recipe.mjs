// Grok Bot marketplace import: fetch a public template page, take its published recipe, and write one
// helper's folder. Pure strings plus node:fs — no imports from src/, so a page-format change lands here,
// never in crewd. crewd's thin crew_import hook fetches, plans, validates, commits and seats the result.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

export const short = (s, n) => (s = String(s ?? '').trim(), s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
export const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const slugOf = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot';
export const KEYS = ['does', 'aim', 'gets', 'how', 'great'];
const COLORS = { magenta: '#C8328A', green: '#2E8A62', blue: '#3355C2', purple: '#6D51C4', orange: '#C9542F', teal: '#2F7F8A' };

/** One bounded fetch path for both imports and their published catalogues. */
export async function published(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' } }); }
  catch (e) { throw new Error(`could not reach ${new URL(url).hostname} (${e?.message ?? e}${e?.cause?.message ? `: ${e.cause.message}` : ''})`); }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered status ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 2_000_000) throw new Error('that published page is too large to read');
  return data;
}

/** Read published Next flight JSON, never execute the page or infer a missing list. */
function embedded(page, field, opening) {
  const flight = [...page.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)]
    .map((m) => { try { return JSON.parse(m[1])[1] ?? ''; } catch { return ''; } }).join('');
  const text = flight || page.replace(/\\(["'\\/])/g, '$1');
  const from = text.indexOf(`"${field}":${opening}`);
  if (from < 0) return null;
  const start = from + field.length + 3;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === '{' || c === '[') depth++;
    if ((c === '}' || c === ']') && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export async function listPublished() {
  const rows = embedded((await published('https://x.ai/bot/marketplace'))?.toString('utf8') ?? '', 'templates', '[');
  if (!Array.isArray(rows) || !rows.length) throw new Error('the marketplace has no readable published catalogue');
  const categories = Object.create(null);
  for (const row of rows) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(row.id) || typeof row.name !== 'string' || !Array.isArray(row.categories)) continue;
    for (const category of row.categories.filter((c) => typeof c === 'string'))
      (categories[category] ??= []).push({ slug: row.id, name: clean(row.name, 100), description: clean(row.description, 300) });
  }
  if (!Object.keys(categories).length) throw new Error('the marketplace has no readable published categories');
  return { source: 'https://x.ai/bot/marketplace', categories };
}

export async function listAny() {
  const skills = await import('./claude-skill.mjs');
  const results = await Promise.allSettled([listPublished(), skills.listPublished()]);
  return Object.fromEntries(results.map((r, i) => [i ? 'skills' : 'grok', r.status === 'fulfilled' ? r.value
    : { error: r.reason.message, note: 'Say this source could not be reached or read; still offer import by name. Never invent its list.' }]));
}

/** The marketplace page's recipe: the visible facts plus the embedded skills, routines and integrations. */
function parseGrokPage(page) {
  const facts = [...page.matchAll(/<li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">(.*?)<\/p><\/li>/gs)]
    .map(([, t]) => t.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&').trim()).filter(Boolean);
  const raw = embedded(page, 'template', '{');
  const list = (v) => Array.isArray(v) ? v : [];
  const profile = facts[0] ?? '';
  if (!raw || typeof raw.name !== 'string' || !profile) throw new Error('that marketplace page has no published recipe to import');
  const text = (v) => String(v ?? '');
  return {
    meta: { name: text(raw.name), description: text(raw.description), creator: text(raw.creatorName), handle: text(raw.handle), color: text(raw.color), share: text(raw.addHref) },
    profile, facts: facts.slice(1),
    skills: list(raw.skills).map((s) => ({ name: text(s.name), description: text(s.description), content: text(s.content) })).filter((s) => s.name && s.content),
    routines: list(raw.routines).map((r) => ({ name: text(r.name), summary: text(r.summary) })).filter((r) => r.name),
    integrations: list(raw.integrations).map((g) => ({ id: text(g.id), name: text(g.name), description: text(g.description) })).filter((g) => g.name),
  };
}

/** Validate the slug, fetch its public page, and return its published recipe. Only honest errors. */
export async function fetchRecipe(slug) {
  const key = /^(?:https:\/\/(?:x\.ai\/bot\/marketplace\/bots|grok\.com\/marketplace)\/)?([a-z0-9][a-z0-9-]{0,60})\/?$/.exec(String(slug ?? '').trim().toLowerCase())?.[1];
  if (!key) throw new Error('name a marketplace bot, like "pg", or paste its marketplace address');
  const data = await published(`https://x.ai/bot/marketplace/bots/${key}`);
  if (!data) throw new Error('the marketplace answered status 404; check the name');
  const page = data.toString('utf8');
  return { key, recipe: parseGrokPage(page) };
}

/** Map the recipe onto a helper: soul, five-part job, skill files, ideas, source record. `labels` is the
 *  crew's own job labels (passed in, never copied) so the job file stays readable; `apps` maps app id to
 *  the person's words for it, and anything else is reported as an unmet need, never faked. */
export function planBot(key, recipe, { display, apps }) {
  const find = (re) => recipe.facts.find((t) => re.test(t)) ?? '';
  const job = {
    does: short(recipe.meta.description || recipe.meta.name, 500),
    aim: short(find(/^Job:/i) || recipe.facts[0] || recipe.meta.description, 500),
    gets: short(find(/pref|getting started/i) || 'What you tell it when you start, and what you hand it per job.', 500),
    how: short([find(/working state/i), recipe.skills.length ? `Its playbooks: ${recipe.skills.map((s) => s.name).join(', ')}.` : ''].filter(Boolean).join(' ') || 'Its published playbooks, kept in its skills.', 500),
    great: short(find(/never (send|publish|post)/i) || (recipe.routines.length ? `${recipe.routines.map((r) => r.name).join(', ')} run once you start them; drafts wait on you, nothing sends itself.` : 'Drafts wait on you; nothing sends itself.'), 500),
  };
  const isApp = (g) => Object.keys(apps).find((a) => g.id.toLowerCase() === a || g.name.toLowerCase().includes(a));
  const met = [...new Set(recipe.integrations.map(isApp).filter(Boolean))];
  const unmet = recipe.integrations.filter((g) => !isApp(g));
  const seen = new Set();
  return {
    display,
    role: clean(recipe.meta.description, 80).replace(/[.!?]$/, '') || clean(recipe.meta.name, 80),
    color: COLORS[recipe.meta.color] ?? '#445577', job,
    soul: `# ${display}\n\n${short(recipe.profile, 1900)}`,
    skills: recipe.skills.flatMap((s) => { const sk = slugOf(s.name); if (seen.has(sk)) return []; seen.add(sk);
      return [{ file: `skills/${sk}/SKILL.md`, data: `---\nname: ${sk}\ndescription: ${JSON.stringify(s.description || s.name)}\nsays: ${JSON.stringify(short(s.description || s.name, 120))}\n---\n\n${s.content.slice(0, 4000).trim()}\n` }]; }),
    ideas: [{ needs: [], group: 'goal', promise: recipe.meta.description, title: `Start with ${display}`, line: 'takes its first job', ask: 'Get us started' }],
    link: `https://x.ai/bot/marketplace/bots/${key}`,
    source: `# Source\n\n- marketplace: https://x.ai/bot/marketplace/bots/${key}\n- install: https://x.ai${recipe.meta.share}\n- creator: ${recipe.meta.creator}${recipe.meta.handle ? ` (@${recipe.meta.handle})` : ''}\n- imported: ${new Date().toISOString()}\n- routines, to offer with crew_routine (never started here):\n${recipe.routines.map((r) => `  - ${r.name}: ${r.summary}`).join('\n') || '  - none'}\n- integrations needing an app: ${met.map((a) => apps[a]).join(', ') || 'none'}\n- integrations with no Crewhouse equivalent yet:\n${unmet.map((g) => `  - ${g.name}: ${short(g.description, 120)}`).join('\n') || '  - none'}\n`,
    routines: recipe.routines.map((r) => `${r.name}: ${short(r.summary, 140)}`),
    met: met.map((a) => apps[a]),
    needs: unmet.map((g) => `${g.name}: ${short(g.description, 120)} (no Crewhouse equivalent yet)`),
    note: `Tell the person what ${display} does now${met.length ? `, offer to connect ${met.map((a) => apps[a]).join(' and ')}` : ''}${unmet.length ? ', and say plainly what it cannot reach yet' : ''}; offer its routines with crew_routine, and start nothing.`,
  };
}

/** Write the planned folder; on update the person's own tools and standing answers stay untouched.
 *  `seed` is the crew's own helper base (the recruit path's template): an import is seated on the
 *  same tools and accounts as a recruit, never on values hardcoded here. */
export function writeBot(dir, plan, update, labels, seed) {
  if (!update) {
    mkdirSync(dir, { recursive: true });
    for (const d of ['files', 'work', 'skills']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'work/\nbrowser/\n');
  }
  const current = update && existsSync(join(dir, 'bot.json')) ? JSON.parse(readFileSync(join(dir, 'bot.json'), 'utf8')) : null;
  writeFileSync(join(dir, 'bot.json'), JSON.stringify(current ? { ...current, ideas: plan.ideas }
    : { tools: seed?.tools ?? ['crew', 'files', 'web', 'browser', 'computer', 'documents', 'search-files'], models: seed?.models ?? ['chatgpt'], ideas: plan.ideas }, null, 2) + '\n');
  writeFileSync(join(dir, 'soul.md'), plan.soul + '\n');
  writeFileSync(join(dir, 'AGENTS.md'), `# ${plan.display}\n\n## Your job\n${labels.map((label, i) => `### ${label}\n${plan.job[KEYS[i]]}`).join('\n\n')}\n`);
  for (const s of plan.skills) {
    mkdirSync(join(dir, s.file.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(dir, s.file), s.data);
  }
  if (update) {
    const keep = new Set(plan.skills.map((s) => s.file));
    const learned = new Set();
    let top = [];
    try { top = readdirSync(join(dir, 'skills'), { withFileTypes: true }); } catch { top = []; }
    for (const e of top) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      let md = '';
      try { md = readFileSync(join(dir, 'skills', e.name, 'SKILL.md'), 'utf8'); } catch { md = ''; }
      if (/^learned:\s*yes\s*$/m.test(md)) learned.add(`skills/${e.name}`);
    }
    const owned = (rel) => !learned.has(rel.split('/').slice(0, 2).join('/'));
    const sweep = (abs) => {
      let kids = [];
      try { kids = readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of kids) {
        if (e.name.startsWith('.')) continue;
        const p = join(abs, e.name);
        const rel = relative(dir, p).split(sep).join('/');
        if (!owned(rel)) continue;
        if (e.isDirectory()) sweep(p);
        else if (!keep.has(rel)) rmSync(p);
      }
      try { if (readdirSync(abs).length === 0 && relative(dir, abs).split(sep).join('/').startsWith('skills/')) rmSync(abs, { recursive: true }); } catch { /* keep a dir that will not go quietly */ }
    };
    sweep(join(dir, 'skills'));
  }
  writeFileSync(join(dir, 'SOURCE.md'), plan.source);
  return ['soul.md', 'AGENTS.md', 'SOURCE.md', 'skills'];
}

/** The job in the crew's own shape: every part present, under its caps, like disk.validateJob. */
export function checkJob(job, labels, display) {
  const parts = KEYS.map((k) => job[k]);
  if (parts.some((v) => !v || v.length > 600) || labels.map((label, i) => `### ${label}\n${parts[i]}`).join('\n\n').length > 3000)
    throw new Error(`"${display}" came back unusable; not imported`);
}

/** The folder's own history, like disk.commit for a fresh write: init, add, commit. */
export function commitBot(dir, files, message) {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Crewhouse', '-c', 'user.email=crewhouse@localhost', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  try {
    if (!existsSync(join(dir, '.git'))) git('init', '-q');
    const present = files.filter((f) => existsSync(join(dir, f)));
    if (present.length) git('add', '--', ...present);
    git('commit', '-q', '-m', message.slice(0, 200), '--', ...present);
  } catch { /* a folder without history still works; the next run retries */ }
}

/** Either source: an explicit skill or a Claude-flavoured marker goes straight to the skill repo;
 *  anything else tries the marketplace first and the skill repo when the marketplace has no such name.
 *  The combined error names both misses, so the model stops guessing at names. */
export async function previewAny({ ref, name, apps, want }) {
  const errs = [];
  for (const kind of want === 'skill' ? ['skill'] : ['grok', 'skill']) {
    try {
      const mod = kind === 'skill' ? await import('./claude-skill.mjs') : { previewImport };
      return await mod.previewImport({ ref, name, apps });
    } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); }
  }
  throw new Error(errs.join(' '));
}

/** Fetch and plan without writing, so the caller refuses a cross-template clash before anything changes. */
export async function previewImport({ ref, name, apps }) {
  const { key, recipe } = await fetchRecipe(ref);
  const display = (name || recipe.meta.name).trim().slice(0, 32) || recipe.meta.name.slice(0, 32) || 'Imported';
  const plan = planBot(key, recipe, { display, apps });
  return { key, id: slugOf(display), display, template: `grok-${key}`, plan };
}

/** Write and commit a previewed plan; returns nothing — the caller seats it through the normal path. */
export function writePlanned({ crewDir, id, plan, labels, update, seed }) {
  checkJob(plan.job, labels, plan.display);
  const dir = join(crewDir, 'bots', id);
  commitBot(dir, writeBot(dir, plan, update, labels, seed), update ? 'Updated from its source' : 'Joined the crew');
}
