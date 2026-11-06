// Does bubblewrap, the helpers' sandbox, work for this person here, and if not, the one command that fixes it.
// crewd's shell, `doctor` and `crewhouse setup` all ask this one probe, so they cannot disagree. No dependencies, so it
// runs where Crewhouse can't.
//   node bin/sandbox.mjs setup    probes as the person; when Ubuntu's rule is what is missing, installs it (asks first)
//   node bin/sandbox.mjs install  as root, for the .deb's postinst: installs the rule where Ubuntu restricts it
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOOR } from './pi-door.mjs';

// Ubuntu 23.10 and later refuse a program the namespaces bubblewrap needs unless AppArmor has a rule for it. The rule is
// Ubuntu's own, in its apparmor-profiles package; the sysctl is how the kernel says the refusal is on. CREWHOUSE_APPARMOR_ROOT
// moves all three paths into a test folder.
const at = (p) => (process.env.CREWHOUSE_APPARMOR_ROOT ?? '') + p;
const RESTRICT = at('/proc/sys/kernel/apparmor_restrict_unprivileged_userns');
const SHIPPED = at('/usr/share/apparmor/extra-profiles/bwrap-userns-restrict'), RULE = at('/etc/apparmor.d/bwrap-userns-restrict');
const restricted = () => { try { return readFileSync(RESTRICT, 'utf8').trim() === '1'; } catch { return false; } };

/** The commands that put the rule in place and load it; `apt` also installs Ubuntu's package when its file is missing. */
const steps = (apt) => [
  ...(apt && !existsSync(SHIPPED) ? [['apt-get', 'install', '-y', 'apparmor-profiles']] : []),
  ...(existsSync(RULE) ? [] : [['install', '-m', '644', SHIPPED, RULE]]),
  ['apparmor_parser', '-r', RULE],
];
const line = (apt, sudo) => steps(apt).map((s) => [...(sudo ? ['sudo'] : []), ...s].join(' ')).join(' && ');

function explain(e) {
  if (e.code === 'ENOENT') return { cause: 'bubblewrap is not installed', next: 'sudo apt install bubblewrap (Fedora: sudo dnf install bubblewrap, Arch: sudo pacman -S bubblewrap)' };
  const said = String(e.stderr ?? '').trim().split('\n').pop() || (e.code === 'ETIMEDOUT' ? 'it did not finish in 5 seconds' : 'it stopped without saying why');
  if (/unknown option/i.test(said)) return { cause: `this bubblewrap is too old (it said: ${said})`, next: 'update bubblewrap to 0.8 or later' };
  if (restricted()) {
    return { cause: `Ubuntu's AppArmor stops bubblewrap from starting until its rule is installed (bubblewrap said: ${said})`, next: line(true, true), fixable: true };
  }
  return { cause: `bubblewrap cannot start here (it said: ${said})`, next: 'allow unprivileged user namespaces for your account: your distribution\'s setting for them (Debian: sudo sysctl kernel.unprivileged_userns_clone=1)' };
}

function probe(args) {
  try {
    execFileSync('bwrap', args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 });
    return { ok: true };
  } catch (e) { return { ok: false, ...explain(e) }; }
}

let seen;
/** `{ ok: true }`, or `{ ok: false, cause, next }`: the cause in plain words and the one command. Probed once per process, as the person running it. */
export function sandbox() { return seen ??= probe(['--ro-bind', '/', '/', '--unshare-all', 'true']); }

// The wall around a bot's whole Pi process: stricter than the shell's, and the probe below starts these same flags, so a
// bubblewrap that takes the shell's but not these (Ubuntu 22.04's 0.6.1) counts as no wall. No new namespaces inside. A network of
// its own: every port on its loopback is the bot's alone, so two bots never collide, and the only way out is the model door
// (pi-door.mjs). No clearenv: the kit builds Pi's environment from nothing.
const WALL = ['--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup', '--unshare-net', '--disable-userns', '--assert-userns-disabled', '--die-with-parent', '--new-session'];
const SETTINGS = ['/etc/ssl', '/etc/ca-certificates', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/localtime'];

// The room around that wall: a systemd scope per Pi start, so the kernel holds the bot and everything it starts to one ceiling.
// 1000 MB: a 3,911 MB computer, less the 867 MB a fresh one uses, shared by the 3 jobs crewd runs at once (Config.maxConcurrent),
// rounded down; a bot measured on a heavy page used about 850. Swap is off, or a ceiling is only a slowdown. OOMPolicy=kill ends
// the whole bot at once: `stop` leaves it dying in stages and `continue` leaves half a bot. A scope only ever holds one bot, so
// the kill reaches nobody else, and inside the wall there is no /run and no cgroup folder to lift the limit from.
export const CEILING_MB = 1000;
const ROOM = ['--user', '--scope', '--quiet', '-p', `MemoryMax=${CEILING_MB}M`, '-p', 'MemorySwapMax=0', '-p', 'OOMPolicy=kill'];
/** Where this login's systemd listens: the kit's Pi gets no environment of ours, and a lab's may be masked. */
export const bus = () => ({ XDG_RUNTIME_DIR: `/run/user/${process.getuid?.()}` });
const manager = (...args) => execFileSync('systemctl', ['--user', ...args], { env: { PATH: process.env.PATH, ...bus() }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();

/** Why this computer can't hold a bot to its ceiling, or ''. Reads the limits back from a real room: a machine that can't apply them can still start the scope. */
function roomDown() {
  const fail = (cause, next) => `Bots can't start, because Crewhouse can't give each one its own memory limit: ${cause}. To fix it: ${next}`;
  try {
    const read = execFileSync('systemd-run', [...ROOM, '--collect', 'sh', '-c', 'cd "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)" && cat memory.max memory.swap.max memory.oom.group'], { env: { PATH: process.env.PATH, ...bus() }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return read.trim().split(/\s+/).join() === `${CEILING_MB * 1024 * 1024},0,1` ? '' : fail('this computer starts programs without applying the limit', 'turn on cgroup v2, so your login can set memory limits (the kernel option systemd.unified_cgroup_hierarchy=1)');
  } catch (e) {
    if (e.code === 'ENOENT') return fail('systemd-run is not on this computer', 'run Crewhouse on a Linux with systemd');
    return fail(`your login's systemd did not answer (it said: ${String(e.stderr ?? '').trim().split('\n').pop() || e.message})`, 'sudo loginctl enable-linger "$USER"');
  }
}

/** Why no bot on Pi may start here, as the one line the person reads, or '' when the wall and the room stand. Asked afresh each time: the fix needs no restart. */
export function wallDown() {
  const held = probe([...WALL, '--ro-bind', '/', '/', 'true']);
  return held.ok ? roomDown() : `Bots can't start, because Crewhouse can't hold them inside their folders: ${held.cause}. To fix it: ${held.next}`;
}

/** systemd-run's arguments up to the command. A new `unit` each start: a scope's name stays taken while it ends, and a failed one keeps it. */
export const piRoom = (unit) => [...ROOM, `--unit=${unit}`];

/** Did this room end on its ceiling? systemd keeps that as the failed scope's Result, a moment after the bot's pipes close, and only forgets it when told to. */
export async function roomFull(unit) {
  for (let tries = 0; tries < 20; tries++, await new Promise((r) => setTimeout(r, 50))) {
    let state;
    try { state = manager('show', '-p', 'Result,LoadState,ActiveState', `${unit}.scope`); } catch { return false; }
    if (/^ActiveState=failed$/m.test(state)) { try { manager('reset-failed', `${unit}.scope`); } catch { /* collected already */ } return /^Result=oom-kill$/m.test(state); }
    if (/^(LoadState=not-found|ActiveState=inactive)$/m.test(state)) return false;
  }
  return false;
}

/** What every bot on Pi loads, so they run inside the wall too: the words it reads when the wall stops it (pi-refusal.mjs) and its half of the door (pi-door.mjs). */
export const piBuiltIn = (repo) => [join(repo, 'bin', 'pi-refusal.mjs'), join(repo, 'bin', 'pi-door.mjs')];

/** bubblewrap's arguments up to the command, for one bot: `folder` is the only place on disk it can change. Pi must write in its `home`, so that is a throwaway with `folder` inside, gone with the process like /tmp, and its setup files are read-only on top. The node binary, Pi's code, the bot's `extensions`, the system and the door's `door` socket are read-only; nothing else of the person's is there. */
export const piWall = ({ folder, home, repo, extensions, door }) => [...WALL, '--unsetenv', 'XDG_RUNTIME_DIR',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
  ...SETTINGS.flatMap((path) => ['--ro-bind-try', path, path]), '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', home,
  ...[process.execPath, join(repo, 'runtime', 'byokit', 'node_modules'), ...extensions, ...['SYSTEM.md', 'settings.json', 'models.json'].map((file) => join(home, file))].flatMap((path) => ['--ro-bind', path, path]),
  '--ro-bind', door, DOOR, '--bind', folder, folder, '--remount-ro', '/', '--chdir', folder, '--'];

async function setup() {
  const first = sandbox();
  if (first.ok) return;
  console.log(`The helpers' shell cannot start on this computer: ${first.cause}.`);
  if (!first.fixable || process.getuid?.() === 0) { console.log(`Next: ${first.next}`); return; }
  const have = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { stdio: 'ignore' }).status === 0;
  if (!process.stdin.isTTY || !have('sudo')) { console.log(`Run this once, then ${process.env.CREWHOUSE_CMD ?? './crewhouse'} doctor will confirm it:\n  ${first.next}`); return; }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const yes = await rl.question(`Install that rule now? It asks for your password once, and only touches ${RULE}. [Y/n] `);
  rl.close();
  if (/^n/i.test(yes)) { console.log(`Not installed. To do it later:\n  ${first.next}`); return; }
  for (const s of steps(true)) {
    if (spawnSync('sudo', s, { stdio: 'inherit' }).status !== 0) { console.log(`That did not finish (the cause is above). To try again:\n  ${first.next}`); return; }
  }
  // A new probe, not the cached one.
  const after = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'probe'], { encoding: 'utf8' });
  console.log(after.stdout.trim());
}

/** The .deb's postinst runs this as root: root passes the probe whatever the rule says, so it looks at the kernel's switch instead. */
function install() {
  if (!restricted()) return;
  if (!existsSync(SHIPPED)) { console.error(`Crewhouse: Ubuntu's bubblewrap rule is not on this computer, so helpers run without a shell until you run:\n  ${line(true, true)}`); return; }
  for (const s of steps(false)) execFileSync(s[0], s.slice(1), { stdio: 'inherit' });
  console.log('Crewhouse: installed Ubuntu\'s AppArmor rule for bubblewrap, so the helpers\' shell can start.');
}

// Only as its own command: bundled into dist/*.js (npm) this file is not argv[1], and importing it must never run anything.
if (basename(process.argv[1] ?? '') === 'sandbox.mjs') {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'probe') { const s = sandbox(); console.log(s.ok ? "The helpers' shell works here." : `The helpers' shell still cannot start: ${s.cause}.\nNext: ${s.next}`); }
  else if (cmd === 'setup') await setup();
  else if (cmd === 'install') install();
  else { console.error('usage: sandbox.mjs setup | install | probe'); process.exit(2); }
}
