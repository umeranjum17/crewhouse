// Does bubblewrap, the helpers' sandbox, work for this person here, and if not, the one command that fixes it.
// crewd's shell, `doctor` and `crewhouse setup` all ask this one probe, so they cannot disagree. No dependencies, so it
// runs where Crewhouse can't.
//   node bin/sandbox.mjs setup    probes as the person; when Ubuntu's rule is what is missing, installs it (asks first)
//   node bin/sandbox.mjs install  as root, for the .deb's postinst: installs the rule where Ubuntu restricts it
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (restricted()) {
    return { cause: `Ubuntu's AppArmor stops bubblewrap from starting until its rule is installed (bubblewrap said: ${said})`, next: line(true, true), fixable: true };
  }
  return { cause: `bubblewrap cannot start here (it said: ${said})`, next: 'allow unprivileged user namespaces for your account: your distribution\'s setting for them (Debian: sudo sysctl kernel.unprivileged_userns_clone=1)' };
}

let seen;
/** `{ ok: true }`, or `{ ok: false, cause, next }`: the cause in plain words and the one command. Probed once per process, as the person running it. */
export function sandbox() {
  if (seen) return seen;
  try {
    execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', 'true'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 });
    return (seen = { ok: true });
  } catch (e) { return (seen = { ok: false, ...explain(e) }); }
}

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
