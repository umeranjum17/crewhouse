// Owned fixture for the card that offers a login found on this computer: real crewd, the built UI and the installed Claude Code
// run as it is. Found comes from the CLI's own status command and each reply from the CLI itself, under the person's HOME
// ($FOUND_HOME); only the engine between crewd and the CLI is the stub. No login file is read here.
// node found-login.ts <repo> <scratch> <ready.json>. TERM closes everything.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, scratch, ready] = process.argv.slice(2);
for (const dir of ['state', 'crew', 'tools', 'cwd']) mkdirSync(join(scratch, dir), { recursive: true });
process.env.CREWHOUSE_STATE_DIR = join(scratch, 'state');
process.env.CREWHOUSE_CREW_DIR = join(scratch, 'crew');
process.env.CREWHOUSE_TOOLS_DIR = join(scratch, 'tools');
process.env.CREWHOUSE_ENGINE = 'stub';
process.env.CREWHOUSE_PORT = '0'; process.env.CREWHOUSE_LINK_PORT = '0';
const load = (path: string) => import(pathToFileURL(join(repo, path)).href);
const { Crew } = await load('src/crew.ts'), { Store } = await load('src/db.ts');
const { loadConfig } = await load('src/config.ts'), { startServer } = await load('src/server.ts');
const cli = (args: string[]) => new Promise<string>((yes, no) => execFile('claude', args, { cwd: join(scratch, 'cwd'), timeout: 120_000,
  env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: process.env.FOUND_HOME } }, (e, out) => e ? no(e) : yes(out.trim())));
const cfg = loadConfig(), db = new Store(cfg.stateDir), crew = new Crew(cfg, db), rt = crew.runtime as any;
rt.signedIn = async (account: string) => account === 'claude' && JSON.parse(await cli(['auth', 'status', '--json'])).loggedIn === true;
rt.found = async (account: string) => account === 'claude';
rt.run = async (spec: { message: string }, on: (e: object) => void) => {
  on({ type: 'started' });
  const text = await cli(['-p', spec.message]);
  on({ type: 'text', text });
  return { ok: true, text };
};
crew.init();
const server = await startServer(cfg, db, crew);
const base = `http://127.0.0.1:${server.address().port}`;
writeFileSync(ready, JSON.stringify({ base }));
console.log(`fixture ready ${base}`);
await new Promise<void>((resolve) => process.once('SIGTERM', resolve));
await new Promise<void>((resolve) => server.close(() => resolve()));
crew.stop(); db.close();
console.log('fixture stopped');
