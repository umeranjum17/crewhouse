import './isolate.ts'; // first: before anything loads the engine
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { Store } from './db.ts';
import { Crew } from './crew.ts';
import { startServer } from './server.ts';

const cfg = loadConfig();
if ((cfg.stateDir + '/').startsWith(cfg.repoDir + '/') || (cfg.crewDir + '/').startsWith(cfg.repoDir + '/')) {
  console.error('crewd: data must live outside the repo; set CREWHOUSE_STATE_DIR / CREWHOUSE_CREW_DIR elsewhere');
  process.exit(1);
}
mkdirSync(join(cfg.crewDir, 'bots'), { recursive: true });
const db = new Store(cfg.stateDir);
const url = `http://${cfg.host}:${cfg.port}`;
const crew = new Crew(cfg, db);
const server = await startServer(cfg, db, crew);
crew.init();
writeFileSync(join(cfg.stateDir, 'endpoint'), url + '\n');
writeFileSync(join(cfg.stateDir, 'crewd.pid'), `${process.pid}\n`); // ./crewhouse update restarts it; uninstall stops it
console.log(`crewd listening on ${url} (engine: ${cfg.engine}, crew: ${cfg.crewDir}, state: ${cfg.stateDir})`);

const shutdown = () => { crew.stop(); server.close(); db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
