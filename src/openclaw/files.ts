import { constants, closeSync, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

// Linux dirfds pin each ancestor: a bot swapping a directory for a symlink cannot race a file operation into the host.
function writeAll(fd: number, text: string) {
  const bytes = Buffer.from(text);
  if (bytes.length > 1_000_000) throw new Error('file is too large');
  for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at, at);
}
function within<T>(root: string, path: string, create: boolean, run: (parent: number, leaf: string) => T): T {
  const base = resolve(root), full = resolve(base, path);
  if (full !== base && !full.startsWith(base + sep)) throw new Error('path is outside the bot folder');
  const names = relative(base, full).split(sep).filter((name) => name && name !== '.');
  const leaf = names.pop() ?? '.';
  let dir = openSync(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const name of names) {
      const child = `/proc/self/fd/${dir}/${name}`;
      if (create && !existsSync(child)) mkdirSync(child);
      const next = openSync(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(dir);
      dir = next;
    }
    return run(dir, leaf);
  } finally { closeSync(dir); }
}

export function fileTool(root: string, name: string, input: Record<string, unknown>) {
  const path = String(input.path ?? '.');
  return within(root, path, name === 'crew_write', (parent, leaf) => {
    const target = `/proc/self/fd/${parent}/${leaf}`;
    if (name === 'crew_ls' || name === 'crew_find') {
      const fd = openSync(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { return readdirSync(`/proc/self/fd/${fd}`, { withFileTypes: true })
        .filter((entry) => !entry.isSymbolicLink()).map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).join('\n'); }
      finally { closeSync(fd); }
    }
    if (leaf === '.') throw new Error('choose a file inside the bot folder');
    if (name === 'crew_write') {
      const content = String(input.content ?? '');
      if (Buffer.byteLength(content) > 1_000_000) throw new Error('file is too large');
      const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { writeAll(fd, content); } finally { closeSync(fd); }
      return `Wrote ${path}`;
    }
    const fd = openSync(target, (name === 'crew_edit' ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW);
    try {
      if (fstatSync(fd).size > 1_000_000) throw new Error('file is too large');
      const before = readFileSync(fd, 'utf8');
      if (name === 'crew_read') return before.slice(0, 100_000);
      if (name === 'crew_edit') {
        const old = String(input.oldText ?? '');
        if (!old || before.indexOf(old) !== before.lastIndexOf(old) || !before.includes(old)) throw new Error('edit requires one exact match');
        const after = before.replace(old, String(input.newText ?? ''));
        if (Buffer.byteLength(after) > 1_000_000) throw new Error('file is too large');
        ftruncateSync(fd, 0);
        writeAll(fd, after);
        return `Edited ${path}`;
      }
      if (name === 'crew_grep') {
        const pattern = String(input.pattern ?? '');
        if (!pattern || pattern.length > 200) throw new Error('give a shorter pattern');
        const rx = new RegExp(pattern);
        return before.split('\n').flatMap((line, i) => rx.test(line) ? [`${i + 1}:${line}`] : []).slice(0, 200).join('\n');
      }
      throw new Error('unknown file tool');
    } finally { closeSync(fd); }
  });
}
