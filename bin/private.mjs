// Sign-ins sit under the state folders, and the kit refuses a folder others can write to, which is what a default Ubuntu login's umask (002)
// makes of every folder a program creates for the first time. A new folder is the person's alone (mode 700, like install.sh); a group-writable
// one of theirs loses the group's write bit. Returns the words to say when it changed one. A folder that is someone else's is left alone:
// the person's own login cannot fix it, and `doctor` and `start` print the plain words for it.
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';

export function keepPrivate(dir) {
  try {
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true, mode: 0o700 }); return ''; }
    const { mode, uid } = statSync(dir);
    if (uid !== process.getuid?.() || !(mode & 0o022)) return '';
    chmodSync(dir, mode & 0o7755);
    return `Only you can write to ${dir} now. It was ${(mode & 0o777).toString(8)}; chmod ${(mode & 0o777).toString(8)} ${dir} puts it back.`;
  } catch { return ''; }
}
