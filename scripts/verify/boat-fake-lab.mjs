// The cloud connect on the kit's fake boat.dev, with the repo's own headless host behind it: the fake's
// machine takes this phone's key, the host enrols it and writes the receipt, and the fake reads it back.
// The install can be made to fail with a flag file, so the phone's own "Try again" is what reaches "ready".
// No real boat.dev, no money, no model: the phone's own flow, the kit's own steps (docs/verification/where-cloud.md).
//
//   LAB_PORT=7411 node scripts/verify/boat-fake-lab.mjs          # the lab runs until it is stopped (LAB_EMPTY=1: no computer)
//   touch <lab dir>/install-fails                               # the install fails; remove the file and it passes
//
// The code sign-in (the front door): LAB_KEY=boat-claimed-key makes the fake accept the key its claim issues, LAB_EMAIL names the
// one boat.dev email it accepts (default umer@example.com), and LAB_CLAIM_WAIT=1 keeps the sign-in waiting, one poll a second,
// until `touch <lab dir>/claim-approve` (the person typed the code) or `touch <lab dir>/claim-expire` (the code lapsed).
//
// The phone's build was given the lab's port (EXPO_PUBLIC_CREWHOUSE_BOAT_API=http://127.0.0.1:<port>/api/v1),
// so the fake's own port is reached through a proxy on it.
import { spawn } from 'node:child_process';
import { createServer as netServer, connect as netConnect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeSandboxServer } from '@byokit/cloud/testing';
import { boat } from '@byokit/cloud';

const KEY = process.env.LAB_KEY || 'lab-key-abcdefgh';   // the fake's own key, long enough for the phone's card
const PORT = Number(process.env.LAB_PORT || 7411);
const dir = process.env.LAB_DIR || join(process.cwd(), '.lab', 'boat-fake');
const flag = join(dir, 'install-fails');
const remote = '/home/user/crewhouse/.byokit', cloud = join(dir, '.byokit');
mkdirSync(cloud, { recursive: true });

const server = await startFakeSandboxServer({ key: KEY, claimInterval: process.env.LAB_CLAIM_WAIT === '1' ? 1 : 0, ...(process.env.LAB_EMAIL ? { claimEmail: process.env.LAB_EMAIL } : {}) });
const provider = boat({ baseUrl: server.url, label: 'boat.dev', prices: [], key: async () => KEY });
// LAB_EMPTY=1 is a new account with no computer, so the phone's Make a new computer is the way in.
const seeded = process.env.LAB_EMPTY === '1' ? { id: 'none' } : await provider.create({ name: 'computer', size: 'small', keepCopies: true, idempotencyKey: 'seed' });
server.machine.script('systemd-run', { code: 0, stdout: '', stderr: '', timedOut: false }); // the recipe's display install
const fakePort = Number(new URL(server.url).port);
netServer((c) => { const u = netConnect(fakePort, '127.0.0.1'); c.pipe(u); u.pipe(c); }).listen(PORT, '127.0.0.1');

// The repo's own headless host: it enrols the phone key the fake delivers and writes the receipt back.
const free = () => new Promise((r) => { const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const env = { ...process.env, CREWHOUSE_ENGINE: 'stub', CREWHOUSE_CLOUD_DIR: cloud, CREWHOUSE_STATE_DIR: join(dir, 'state'),
  CREWHOUSE_CREW_DIR: join(dir, 'crew'), CREWHOUSE_TOOLS_DIR: join(dir, 'tools'), CREWHOUSE_PORT: String(await free()),
  CREWHOUSE_LINK_PORT: String(await free()), CREWHOUSE_RELAY_PORT: String(await free()),
  // The house's own data dirs stay out of the lab (the engine dir would be the owner's).
  XDG_DATA_HOME: join(dir, 'xdg', 'data'), XDG_STATE_HOME: join(dir, 'xdg', 'state') };
env.CREWHOUSE_RELAY_PUBLIC = `http://127.0.0.2:${env.CREWHOUSE_RELAY_PORT}`;
const host = spawn(process.execPath, ['scripts/headless.mjs'], { cwd: process.cwd(), env });
let log = '';
host.stdout.on('data', (b) => log += b); host.stderr.on('data', (b) => log += b);

// The bridge: the fake's inbox to the host's inbox, and the host's receipt back to the fake's outbox.
let failing = null, pushed = 0, expired = false, ended = false;
const owners = new Set();
const bridge = setInterval(() => {
  const wantFail = existsSync(flag);
  if (wantFail !== failing) {
    failing = wantFail;
    server.machine.script('bash', wantFail ? { code: 1, stdout: '', stderr: 'no route', timedOut: false } : { code: 0, stdout: '', stderr: '', timedOut: false });
    console.log('the install fails:', wantFail);
  }
  if (process.env.LAB_CLAIM_WAIT === '1' && !existsSync(join(dir, 'claim-approve'))) { // keep exactly one answer queued ahead of the phone's polls
    const polls = server.requests.filter((r) => r.method === 'POST' && r.path === '/api/boat/oauth2/token').length;
    if (!expired && existsSync(join(dir, 'claim-expire'))) { expired = true; server.scriptClaimPoll(['expired_token']); } else if (!expired && pushed <= polls) { pushed++; server.scriptClaimPoll(['pending']); }
  }
  if (server.revoked.has(KEY) !== ended) { ended = !ended; console.log('the lab key is ended at boat.dev:', ended); } // a yes or no, never the key
  const delivered = server.machine.files.get(`${remote}/inbox/phone.bin`);
  if (delivered && !existsSync(join(cloud, 'inbox/phone.bin'))) { mkdirSync(join(cloud, 'inbox'), { recursive: true }); writeFileSync(join(cloud, 'inbox/phone.bin'), delivered.bytes); }
  // Move Chief to this phone: the new owner's key, handed over once.
  const owner = server.machine.files.get(`${remote}/inbox/owner.bin`);
  if (owner && !owners.has(owner.bytes.toString())) { owners.add(owner.bytes.toString()); mkdirSync(join(cloud, 'inbox'), { recursive: true }); writeFileSync(join(cloud, 'inbox/owner.bin'), owner.bytes); }
  if (existsSync(join(cloud, 'outbox/receipt.json'))) server.machine.writeFile(`${remote}/outbox/receipt.json`, readFileSync(join(cloud, 'outbox/receipt.json')), 0o600);
  if (log.includes('headless host ready')) { console.log('the host is ready'); log = ''; }
}, 50);

console.log(`the fake boat.dev is on 127.0.0.1:${PORT}, computer ${seeded.id}, key ${KEY.length} letters, lab ${dir}`);
// The code sign-in's own addresses (metadata, token, the page's link) name the fake's own port, so a phone needs that one reversed too.
console.log(`adb reverse tcp:${fakePort} tcp:${fakePort}   # for the code sign-in`);
console.log(`touch ${flag} to make the install fail; remove it and the phone's Try again reaches ready.`);
process.on('SIGTERM', () => { clearInterval(bridge); host.kill('SIGTERM'); server.close().then(() => process.exit(0)); });
