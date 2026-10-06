// The real daemon (src/config.ts, src/db.ts, src/crew.ts, src/server.ts) on the stub engine, with one lane-only app
// registered so a person can connect a real OAuth + MCP app end to end. Everything else is the product as shipped.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { standIn } from './provider.ts';

const REPO = '/home/umer/.treehouse/crewhouse-0ec48b/5/crewhouse';
const app = await standIn();
const { loadConfig } = await import(join(REPO, 'src/config.ts'));
const { Store } = await import(join(REPO, 'src/db.ts'));
const { Crew, stamp } = await import(join(REPO, 'src/crew.ts'));
const { startServer } = await import(join(REPO, 'src/server.ts'));

stamp('service start');
const cfg = loadConfig();
mkdirSync(join(cfg.crewDir, 'bots'), { recursive: true });
const db = new Store(cfg.stateDir);
db.single();
const url = `http://${cfg.host}:${cfg.port}`;
const crew = new Crew(cfg, db);
// Two of the apps the app already offers, pointed at the lane's stand-in provider: the person sees the real rows and
// the real consent round trip, and the account behind it is the stand-in's, not Notion's or Canva's.
crew.connections.apps.notion = { ...crew.connections.apps.notion, mcpUrl: `${app.base}/mcp`, issuer: app.base } as never;
// Canva stands in for the defect this change exists to catch: it takes the sign-in and then answers nothing.
crew.connections.apps.canva = { ...crew.connections.apps.canva, mcpUrl: `${app.base}/mcp?silent=1`, issuer: app.base } as never;
await crew.connections.ready;
const server = await startServer(cfg, db, crew);
crew.init();
console.log(`crewd listening on ${url} (engine: ${cfg.engine}, stand-in app: ${app.base})`);
const shutdown = async () => { server.close(); try { await crew.stop(); db.close(); await app.close(); process.exit(0); } catch { process.exit(1); } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
