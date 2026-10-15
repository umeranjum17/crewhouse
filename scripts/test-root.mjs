import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Budget bytes (including NUL), not JS characters or today's PID width. Firstwords is deeper than Chromium;
// the pinned bridge binds bridge.sock directly (no staged suffix), Chromium uses the transient XXXXXX directory.
const pidDigits = process.platform === 'linux' ? readFileSync('/proc/sys/kernel/pid_max', 'utf8').trim().length : 10;
const prefix = 'c-'; // keep the physical root short; helpers also embed HOME in their bounded prompts
const nested = [
  '/org.chromium.Chromium.XXXXXX/SingletonSocket',
  '/crewhouse-firstwords-XXXXXX/state/openclaw/bridge.sock',
];
const spent = Math.max(...nested.map((p) => Buffer.byteLength(`/${prefix}${'9'.repeat(pidDigits)}-XXXXXX/tmp${p}`))) + 1;
const limit = process.platform === 'darwin' ? 104 : 108;

export function testRoot(requested = tmpdir()) {
  // Stay on the caller's physical tree, not a hard-coded shared /tmp fallback. Only the new mkdtemp root is ours:
  // neither a dead PID nor a matching name gives this invocation authority to reap any existing directory.
  let base = realpathSync(requested);
  while (Buffer.byteLength(base) + spent > limit && dirname(base) !== base) base = dirname(base);
  if (Buffer.byteLength(base) + spent > limit) throw new Error(`No room for nested test sockets beneath ${requested}`);
  const parent = lstatSync(base);
  const privateParent = parent.uid === process.getuid?.() && !(parent.mode & 0o022);
  const stickyParent = !!(parent.mode & 0o1000) && (parent.uid === 0 || parent.uid === process.getuid?.());
  if (!parent.isDirectory() || (!privateParent && !stickyParent)) throw new Error(`Refusing unowned or writable test parent ${base}`);
  if (base !== requested) console.error(`TMPDIR ${requested} leaves no room for nested test sockets: testing beneath ${base}`);
  const root = mkdtempSync(join(base, `${prefix}${process.pid}-`));
  const owned = lstatSync(root);
  const cleanup = () => {
    const now = lstatSync(root);
    if (now.dev !== owned.dev || now.ino !== owned.ino || now.uid !== owned.uid || !now.isDirectory()) {
      throw new Error(`Refusing to clean replaced test root ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  };
  return { root, cleanup };
}
