// Owned synthetic Gateway, real published kit + account shim + HTTP server + built UI; never a vendor key.
// node go-plan.ts <repo> <scratch> <ready.json>; TERM closes both runtimes and the server.
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
const f = faked({}, { 'openclaw.setup.activate': (p: { apiKey: string }) => ({ ok: false, status: p.apiKey === 'synthetic-invalid' ? 'auth' : p.apiKey === 'synthetic-network' ? 'network' : 'unavailable' }) });
await f.started;
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
crew.runtime.signIn = f.runtime.signIn.bind(f.runtime);
// Key-entry routes list no models until the kit has an entry for them (the real kit returns none); the stub's placeholder names stay out of the shots.
const stubModels = crew.runtime.models.bind(crew.runtime);
crew.runtime.models = async (account: string) => ['minimax', 'opencode-go'].includes(account) ? [] : stubModels(account);
for (const key of Object.keys(PROVIDERS)) crew.accounts.ready.set(key, false);
crew.init();
const server = await startServer(cfg, db, crew);
const base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(ready, JSON.stringify({ base, person: join(cfg.stateDir, 'person.key') }));
console.log(`fixture ready ${base}: stub crew, published kit with synthetic unavailable activation`);
await new Promise<void>((resolve) => process.once('SIGTERM', resolve));
await new Promise<void>((resolve) => server.close(() => resolve()));
crew.stop(); await f.done(); db.close();
console.log('fixture stopped');
