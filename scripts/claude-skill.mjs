// Claude skill import: fetch a published Agent Skill (SKILL.md plus its same-folder resources) and plan
// one helper around it. Same three exports as grok-recipe.mjs so crewd's thin crew_import hook stays
// generic; page/repo-format changes land here, never in crewd. Only skills whose own LICENSE.txt grants
// reuse (Apache 2.0) are imported — anything else is refused, never copied.
import { short, clean, slugOf, published as get } from './grok-recipe.mjs';
export { writePlanned } from './grok-recipe.mjs';

const OFFICIAL = 'anthropics/skills';
const BRANCHES = ['main', 'master'];
const MAX_FILES = 30, MAX_EACH = 2_000_000, MAX_ALL = 10_000_000;

/** Split `owner/repo:path` (any public repo, same skill layout) or a bare skill name (the official repo). */
function locate(ref) {
  const m = /^(?:([a-z0-9-]+)\/([\w.-]+):)?([\w./-]+?)\/?$/.exec(String(ref ?? '').trim());
  if (!m || m[3].includes('..')) throw new Error('name a skill ("algorithmic-art") or "owner/repo:skills/name"');
  const bare = !m[1];
  const path = (bare ? `skills/${m[3]}` : m[3]).replace(/\/+$/, '');
  return { owner: m[1] ?? 'anthropics', repo: m[2] ?? 'skills', path };
}

export async function listPublished() {
  const source = `https://api.github.com/repos/${OFFICIAL}/contents/skills`;
  const rows = JSON.parse((await get(source))?.toString('utf8') ?? 'null');
  if (!Array.isArray(rows)) throw new Error('the skill repo has no readable published list');
  const skills = rows.filter((r) => r.type === 'dir' && /^[a-z0-9][a-z0-9-]{0,60}$/.test(r.name)).map((r) => ({ skill: r.name }));
  if (!skills.length) throw new Error('the skill repo has no readable published skills');
  return { source, skills, note: 'Published names, not a promise of importability: import checks each skill\'s reuse license.' };
}

/** A skill's own license must allow reuse; the kept LICENSE.txt is the attribution. */
function licensed(text) {
  const t = String(text ?? '');
  if (!/apache license/i.test(t) || !/version 2\.0/i.test(t)) return null;
  if (!/apache\.org\/licenses/i.test(t) && !/appendix/i.test(t)) return null;
  // "additional terms" alone is not a restriction signal: the canonical Apache-2.0 text itself says
  // "without any additional terms or conditions" (section 9), so matching it refuses every genuine
  // grant. Restriction addenda are caught by their own markers (Commons Clause names its clause and
  // withholds the right to "Sell the Software").
  if (/commons clause|creative commons|additional restrictions|all rights reserved|field of use|sell the software/i.test(t)) return null;
  return 'Apache-2.0';
}

/** Validate the ref, fetch SKILL.md, its license and its same-folder referenced resources. Only honest errors. */
export async function fetchRecipe(ref) {
  const { owner, repo, path } = locate(ref);
  let base = '', skill = '', license = '', branch = BRANCHES[0];
  for (const b of BRANCHES) {
    base = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${path}`;
    let got = null;
    try { got = await get(`${base}/SKILL.md`); } catch { continue; }
    if (got) { skill = got.toString('utf8'); branch = b; break; }
  }
  if (!skill) throw new Error(`no skill at "${String(ref).trim()}" (looked on ${BRANCHES.join(' and ')})`);
  if (skill.length > 200_000) throw new Error('that SKILL.md is too large to read');
  let lic = null;
  try { lic = await get(`${base}/LICENSE.txt`); } catch { lic = null; }
  const kind = lic && licensed(lic.toString('utf8'));
  if (!kind) throw new Error(`"${path}" carries no reusable license (LICENSE.txt must grant it); not imported`);
  const name = /^name:\s*(.+)$/m.exec(skill)?.[1].trim() || path.split('/').at(-1);
  const description = /^description:\s*(.+)$/m.exec(skill)?.[1].replace(/^["']|["']$/g, '').trim() || '';
  if (!description) throw new Error(`"${path}" has no skill description; not imported`);
  const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '');
  const links = [...body.matchAll(/\]\((?!https?:\/\/|#|mailto:)([^)\s]+)\)/g)].map((m) => m[1]);
  const ticks = [...body.matchAll(/`((?:\.\/)?[\w./-]+\.\w+)`/g)].map((m) => m[1]);
  const refs = [...new Set(links.concat(ticks))]
    .map((r) => r.replace(/^\.\//, '')).filter((r) => r && !r.includes('..') && !r.startsWith('/') && r !== 'SKILL.md' && r !== 'LICENSE.txt').slice(0, MAX_FILES);
  const files = [];
  let bytes = 0;
  for (const r of refs) {
    let got = null;
    try { got = await get(`${base}/${r}`); } catch { continue; }
    if (!got || got.length > MAX_EACH || (bytes += got.length) > MAX_ALL) continue;
    files.push({ rel: r, data: got });
  }
  const title = name.split(/[-_]+/).map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ');
  return { key: slugOf(name), recipe: { name, title, description, body, license: lic, branch, files, missing: refs.filter((r) => !files.some((f) => f.rel === r)), repo: `${owner}/${repo}`, path } };
}

/** Map the skill onto a helper whose job is the skill's own description. */
export function planBot(key, recipe, { display }) {
  const skill = slugOf(recipe.name);
  const says = short(recipe.description.split(/(?<=[.!?])\s/)[0] ?? recipe.description, 120);
  const job = {
    does: short(recipe.description, 500),
    aim: short(`Do jobs with the ${recipe.name} skill, from the person's request to a finished result.`, 500),
    gets: short('The person\u2019s request and anything they hand over for the job.', 500),
    how: short(`Follow the ${recipe.name} skill in its skills, step by step; keep work in work/, finished things in files/.`, 500),
    great: short('A finished result the person can use straight away, or a plain answer when there is nothing to keep.', 500),
  };
  return {
    display,
    role: clean(recipe.description, 80).replace(/[.!?]$/, '') || clean(recipe.name, 80),
    color: '#445577', job,
    soul: `# ${display}\n\nYou are ${display}. Friendly, careful and brief. Your ${recipe.name} skill carries the steps; follow it, and ask before sending, spending or deleting.`,
    skills: [{ file: `skills/${skill}/SKILL.md`,
      data: `---\nname: ${skill}\ndescription: ${JSON.stringify(recipe.description)}\nsays: ${JSON.stringify(says)}\nlicense: Apache-2.0\n---\n\n${recipe.body.slice(0, 8000).trim()}\n` },
      { file: `skills/${skill}/LICENSE.txt`, data: recipe.license },
      ...recipe.files.map((f) => ({ file: `skills/${skill}/${f.rel}`, data: f.data }))],
    ideas: [{ needs: [], group: 'goal', promise: recipe.description, title: `Try ${display}`, line: `uses its ${recipe.name} skill`, ask: `Use your ${recipe.name} skill for ` }],
    link: `https://github.com/${recipe.repo}/tree/${recipe.branch}/${recipe.path}`,
    source: `# Source\n\n- skill: https://github.com/${recipe.repo}/tree/${recipe.branch}/${recipe.path}\n- license: Apache-2.0 (LICENSE.txt kept with the skill)\n- imported: ${new Date().toISOString()}\n${recipe.missing.length ? `- resources not carried over: ${recipe.missing.join(', ')}\n` : ''}`,
    routines: [], met: [], needs: [],
    note: `Tell the person what ${display} does now; it follows its ${recipe.name} skill. Start nothing.`,
  };
}

/** Fetch and plan without writing, so the caller refuses a cross-template clash before anything changes. */
export async function previewImport({ ref, name }) {
  const { key, recipe } = await fetchRecipe(ref);
  const display = (name || recipe.title || recipe.name).trim().slice(0, 32) || recipe.title || 'Imported';
  const plan = planBot(key, recipe, { display });
  return { key, id: slugOf(display), display, template: `skill-${key}`, plan };
}
