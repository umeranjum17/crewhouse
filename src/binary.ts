// The binary inspector: a read-only look inside a file a helper was given. It never runs that file, never writes and
// never reaches the network: the check runs in the helper's own sandbox, where the folder is read-only and the network
// is not shared at all.
import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** One fixed program per check, with the file as its only argument: a helper names the check, never a program, a flag
 *  or a path of its own. The check's own words come from the program, not from the model. */
const CHECKS: Record<string, string> = {
  type: 'exec file -b -- "$1"',
  headers: 'exec readelf -h -- "$1"',
  strings: 'strings -a -n 4 -- "$1" | head -c 4000',
  symbols: 'echo "its own:"; nm --defined-only "$1" 2>&1 | head -c 2000; echo "what it uses:"; nm --dynamic "$1" 2>&1 | head -c 2000',
  sections: 'readelf -S -- "$1" 2>&1 | head -c 4000',
};
/** The bytes a check may read, the words it may say back, and the seconds it may take. */
const LIMIT = 32 * 1024 * 1024, CAP = 4000, TIME = 20_000;
/** The sandbox a check runs in: the helper's own folder (read-only) and the system's own programs are in it, and nothing
 *  else is — no network, and nowhere for a write to land. */
const SANDBOX = ['--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
  '--ro-bind-try', '/etc', '/etc', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home'];

/** Look inside one file, the way the helper asked. The file must be in the helper's own folder: a path that leaves it,
 *  or a symlink that points out of it, is refused before anything runs. */
export async function inspectBinary(space: string, path: string, what: string) {
  const script = CHECKS[what];
  if (!script) throw new Error('that check is not one this tool has: type, headers, strings, symbols or sections');
  const base = realpathSync(space), full = resolve(base, path);
  if (full !== base && !full.startsWith(base + '/')) throw new Error('that file is not in your own folder: ask the person to put it there');
  let file: string;
  try { file = realpathSync(full); } catch { throw new Error(`there is no file at ${path} in your own folder`); }
  if (file !== base && !file.startsWith(base + '/')) throw new Error('that file is not in your own folder: ask the person to put it there');
  const size = statSync(file).size;
  if (size > LIMIT) throw new Error(`that file is ${Math.round(size / 1048576)} MB: the inspector reads files up to 32 MB`);
  const out = await new Promise<{ code: number; text: string; slow: boolean }>((done) => void execFile('bwrap',
    [...SANDBOX, '--ro-bind', base, base, '--chdir', base, '--unshare-all', '--die-with-parent', '--', '/usr/bin/sh', '-c', script, 'crewhouse-inspect', file],
    { env: { PATH: '/usr/bin:/bin', HOME: base, LANG: 'C.UTF-8', TMPDIR: '/tmp', NO_COLOR: '1' }, timeout: TIME, maxBuffer: 1 << 20 },
    (err, stdout, stderr) => done({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, text: `${stdout}${stderr}`, slow: !!(err as { killed?: boolean })?.killed })));
  if (out.slow) throw new Error('that check took too long and was stopped');
  const text = out.text.replace(/\s+$/, '').trim();
  if (!text) throw new Error(out.code === 0 ? 'that check found nothing to say about the file' : `that check failed (exit ${out.code})`);
  return text.length > CAP ? `${text.slice(0, CAP)}…` : text;
}
