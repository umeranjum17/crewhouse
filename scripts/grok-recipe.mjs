// Grok Bot marketplace import: fetch a public template page, take its published recipe, and write one
// helper's folder. Pure strings plus node:fs — no imports from src/, so a page-format change lands here,
// never in crewd. crewd's thin crew_import hook fetches, plans, validates, commits and seats the result.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const short = (s, n) => (s = String(s ?? '').trim(), s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slugOf = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'bot';
const KEYS = ['does', 'aim', 'gets', 'how', 'great'];
const COLORS = { magenta: '#C8328A', green: '#2E8A62', blue: '#3355C2', purple: '#6D51C4', orange: '#C9542F', teal: '#2F7F8A' };

/** The marketplace page's recipe: the visible facts plus the embedded skills, routines and integrations. */
function parseGrokPage(page) {
  const facts = [...page.matchAll(/<li><p class="text-primary text-sm leading-6 whitespace-pre-wrap">(.*?)<\/p><\/li>/gs)]
    .map(([, t]) => t.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, '/').replace(/&amp;/g, '&').trim()).filter(Boolean);
  const from = page.indexOf('\\"template\\":{');
  let raw = null;
  if (from >= 0) {
    let i = from + 13, depth = 0, instr = false, esc = false;
    for (; i < page.length; i++) {
      const c = page[i];
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') instr = !instr;
      else if (!instr && c === '{') depth++;
      else if (!instr && c === '}') { if (!--depth) break; }
    }
    try { raw = JSON.parse(page.slice(from + 13, i + 1).replace(/\\(["'\\/])/g, '$1')); } catch { raw = null; }
  }
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
export async function fetchGrokRecipe(slug) {
  const key = /^(?:https:\/\/x\.ai\/bot\/marketplace\/bots\/)?([a-z0-9][a-z0-9-]{0,60})\/?$/.exec(String(slug ?? '').trim().toLowerCase())?.[1];
  if (!key) throw new Error('name a marketplace bot, like "pg", or paste its marketplace address');
  let res;
  try {
    res = await fetch(`https://x.ai/bot/marketplace/bots/${key}`, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 Crewhouse' } });
  } catch (e) { throw new Error(`could not reach that marketplace page (${e?.message ?? e}); check the name`); }
  if (!res.ok) throw new Error(`the marketplace answered status ${res.status}; check the name`);
  const page = await res.text();
  if (page.length > 2_000_000) throw new Error('that marketplace page is too large to read');
  return { key, recipe: parseGrokPage(page) };
}

/** Map the recipe onto a helper: soul, five-part job, skill files, ideas, source record. `labels` is the
 *  crew's own job labels (passed in, never copied) so the job file stays readable; `apps` maps app id to
 *  the person's words for it, and anything else is reported as an unmet need, never faked. */
export function planGrokBot(key, recipe, { display, labels, apps }) {
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
    section: `## Your job\n${labels.map((label, i) => `### ${label}\n${job[KEYS[i]]}`).join('\n\n')}\n`,
    skills: recipe.skills.flatMap((s) => { const sk = slugOf(s.name); if (seen.has(sk)) return []; seen.add(sk);
      return [{ file: `skills/${sk}/SKILL.md`, text: `---\nname: ${sk}\ndescription: ${JSON.stringify(s.description || s.name)}\nsays: ${JSON.stringify(short(s.description || s.name, 120))}\n---\n\n${s.content.slice(0, 4000).trim()}\n` }]; }),
    ideas: [{ needs: [], group: 'goal', promise: recipe.meta.description, title: `Start with ${display}`, line: 'takes its first job', ask: 'Get us started' }],
    source: `# Source\n\n- marketplace: https://x.ai/bot/marketplace/bots/${key}\n- install: https://x.ai${recipe.meta.share}\n- creator: ${recipe.meta.creator}${recipe.meta.handle ? ` (@${recipe.meta.handle})` : ''}\n- imported: ${new Date().toISOString()}\n- routines, to offer with crew_routine (never started here):\n${recipe.routines.map((r) => `  - ${r.name}: ${r.summary}`).join('\n') || '  - none'}\n- integrations needing an app: ${met.map((a) => apps[a]).join(', ') || 'none'}\n- integrations with no Crewhouse equivalent yet:\n${unmet.map((g) => `  - ${g.name}: ${short(g.description, 120)}`).join('\n') || '  - none'}\n`,
    routines: recipe.routines.map((r) => `${r.name}: ${short(r.summary, 140)}`),
    met: met.map((a) => apps[a]),
    needs: unmet.map((g) => `${g.name}: ${short(g.description, 120)} (no Crewhouse equivalent yet)`),
  };
}

/** Write the planned folder; on update the person's own tools and standing answers stay untouched. */
export function writeGrokBot(dir, plan, update) {
  if (!update) {
    mkdirSync(dir, { recursive: true });
    for (const d of ['files', 'work', 'skills']) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'work/\nbrowser/\n');
  }
  const current = update && existsSync(join(dir, 'bot.json')) ? JSON.parse(readFileSync(join(dir, 'bot.json'), 'utf8')) : null;
  writeFileSync(join(dir, 'bot.json'), JSON.stringify(current ? { ...current, ideas: plan.ideas }
    : { tools: ['crew', 'files', 'web', 'browser', 'computer', 'documents', 'search-files'], models: ['chatgpt'], ideas: plan.ideas }, null, 2) + '\n');
  writeFileSync(join(dir, 'soul.md'), plan.soul + '\n');
  writeFileSync(join(dir, 'AGENTS.md'), `# ${plan.display}\n\n${plan.section}`);
  for (const s of plan.skills) {
    mkdirSync(join(dir, s.file.slice(0, -'/SKILL.md'.length)), { recursive: true });
    writeFileSync(join(dir, s.file), s.text);
  }
  writeFileSync(join(dir, 'SOURCE.md'), plan.source);
  return ['soul.md', 'AGENTS.md', 'SOURCE.md', 'skills'];
}
