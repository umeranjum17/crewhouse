// Owned fixture for the sign-in sheet's "Claude cannot sign in from here" words: real crewd + account shim + built UI, with
// only the kit's anthropic-cli sign-in faked at its boundary (a failed view carrying the typed cause); no vendor, no login.
// node cli-cause.ts <repo> <scratch> <ready.json>; the variant is read from <scratch>/cause.json ({"signIn": true|false})
// at each sign-in, so one fixture shows both. TERM closes everything.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const f = faked();
await f.started;
writeFileSync(join(scratch, 'cause.json'), '{"signIn":false}');
f.runtime.kit.signIn = (_member: unknown, _o: unknown, on: (v: object) => void) => {
  const { signIn } = JSON.parse(readFileSync(join(scratch, 'cause.json'), 'utf8'));
  setTimeout(() => on({ state: 'failed', via: 'browser', why: 'failed', error: 'Claude Code is not signed in.', cause: { code: 'needs_cli_login', cli: 'claude', home: '/home/you', signIn } }), 50); // the real kit answers after the handle is returned
  return { paste() {}, cancel() {}, done: Promise.resolve() };
};
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db);
crew.runtime.signIn = f.runtime.signIn.bind(f.runtime);
for (const key of Object.keys(PROVIDERS)) crew.accounts.ready.set(key, false);
crew.init();
const server = await startServer(cfg, db, crew);
const base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(ready, JSON.stringify({ base, person: join(cfg.stateDir, 'person.key') }));
console.log(`fixture ready ${base}: Claude sign-in fails with the kit's needs_cli_login cause`);
await new Promise<void>((resolve) => process.once('SIGTERM', resolve));
await new Promise<void>((resolve) => server.close(() => resolve()));
crew.stop(); await f.done(); db.close();
console.log('fixture stopped');
