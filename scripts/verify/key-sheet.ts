// Owned fixture for the key sign-in sheet (OpenRouter, MiniMax): real crewd + account shim + built UI, with the kit on its own
// fake Gateway, so the key goes through the kit's real addKey and the model list through its real `models`; no vendor, no model run.
// node key-sheet.ts <repo> <scratch> <ready.json>; TERM closes everything.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, scratch, ready] = process.argv.slice(2);
for (const dir of ['state', 'crew', 'tools']) mkdirSync(join(scratch, dir), { recursive: true });
process.env.CREWHOUSE_STATE_DIR = join(scratch, 'state');
process.env.CREWHOUSE_CREW_DIR = join(scratch, 'crew');
process.env.CREWHOUSE_TOOLS_DIR = join(scratch, 'tools');
process.env.CREWHOUSE_ENGINE = 'stub';
process.env.CREWHOUSE_PORT = '0'; process.env.CREWHOUSE_LINK_PORT = '0';
const load = (path: string) => import(pathToFileURL(join(repo, path)).href);
const { faked } = await load('test/kit-fake.ts');
const { Crew } = await load('src/crew.ts'), { Store } = await load('src/db.ts');
const { loadConfig } = await load('src/config.ts'), { startServer } = await load('src/server.ts');
const { PROVIDERS } = await load('src/accounts.ts');
const rows = [['minimax/minimax-m3.1-flash:free', 'MiniMax M3.1 Flash (free)'], ['deepseek/deepseek-v4-flash', 'DeepSeek V4 Flash'], ['google/gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite'],
  ...Array.from({ length: 9 }, (_, i) => [`vendor-${i + 1}/model-${i + 1}`, `Vendor ${i + 1} Model ${i + 1}`])].map(([id, name]) => ({ id, name, api: 'openai-completions' }));
const f = faked({}, { 'byokit.catalog': () => ({ ok: true, models: rows }), 'models.list': () => ({ models: [{ provider: 'minimax', id: 'minimax/MiniMax-M3', name: 'MiniMax M3', available: false, tags: ['default'] }, { provider: 'minimax', id: 'minimax/MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', available: false }] }), });
await f.started;
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
for (const m of ['signIn', 'models', 'signedIn', 'signOut'] as const) crew.runtime[m] = f.runtime[m].bind(f.runtime);
for (const key of Object.keys(PROVIDERS)) crew.accounts.ready.delete(key);
crew.init();
const server = await startServer(cfg, db, crew);
const base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(ready, JSON.stringify({ base, person: join(cfg.stateDir, 'person.key') }));
console.log(`fixture ready ${base}: the kit's key add and live model list on its fake Gateway`);
await new Promise<void>((resolve) => process.once('SIGTERM', resolve));
await new Promise<void>((resolve) => server.close(() => resolve()));
crew.stop(); await f.done(); db.close();
console.log('fixture stopped');
