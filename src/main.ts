// The daemon: config, store, crew, server, with the kit's supervised engine.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { Store } from './db.ts';
import { Crew, stamp } from './crew.ts';
import { startServer } from './server.ts';

stamp('service start');
const cfg = loadConfig();
mkdirSync(join(cfg.crewDir, 'bots'), { recursive: true });
const db = new Store(cfg.stateDir);
db.single();
const crew = new Crew(cfg, db);
await crew.connections.ready;
const server = await startServer(cfg, db, crew), url = `http://${cfg.host}:${(server.address() as import('node:net').AddressInfo).port}`;
crew.init();
writeFileSync(join(cfg.stateDir, 'endpoint'), url + '\n');
writeFileSync(join(cfg.stateDir, 'crewd.pid'), `${process.pid}\n`); // ./crewhouse update restarts it; uninstall stops it
console.log(`crewd listening on ${url} (engine: ${cfg.engine}, crew: ${cfg.crewDir}, state: ${cfg.stateDir})`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return; stopping = true; server.close();
  try { await crew.stop(); db.close(); process.exit(0); }
  catch (error) { console.error('Shutdown failed:', error); process.exit(1); }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
