// Only browsers spawned here: a private CDP pipe, kernel identities, no process-group signals.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';

type Identity = { pid: number; parent: number; start: string };
function identity(pid: number): Identity | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (!Number.isSafeInteger(pid) || pid <= 0 || !/^\d+$/.test(fields[19] ?? '')) throw new Error(`invalid kernel identity for PID ${pid}`);
    return { pid, parent: Number(fields[1]), start: fields[19] };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
}

export function taskBrowser(bin: string, args: string[], profile: string) {
  if (process.platform !== 'linux') throw new Error('browser ownership requires Linux /proc starttime');
  const chrome = spawn(bin, [...args, '--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let spawnError: Error | undefined;
  chrome.on('error', (error) => { spawnError = error; });
  const owned = new Map<number, Identity>();
  let root: Identity | undefined;
  let trackingError: unknown;
  let said = '';
  chrome.stderr!.on('data', (data) => { said = (said + data).slice(-2000); });
  const remember = () => {
    if (!root) {
      if (!chrome.pid || chrome.pid <= 0) throw new Error('no positive spawned browser PID');
      root = identity(chrome.pid);
      if (!root || root.parent !== process.pid) throw new Error('spawned browser ownership not witnessed');
      owned.set(root.pid, root);
    }
    const processes = readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map((name) => identity(Number(name))).filter((p): p is Identity => !!p);
    // Only extend identities through a currently witnessed owned parent, never cwd, session or group matching.
    const live = new Map(processes.map((p) => [p.pid, p]));
    let added = true;
    while (added) {
      added = false;
      for (const p of processes) {
        const parent = owned.get(p.parent);
        if (!owned.has(p.pid) && parent && live.get(parent.pid)?.start === parent.start) {
          owned.set(p.pid, p); added = true;
        }
      }
    }
  };
  const track = () => { try { remember(); } catch (error) { trackingError ??= error; } };
  track();
  const tracker = setInterval(track, 100);
  tracker.unref();
  const input = chrome.stdio[3] as Duplex, output = chrome.stdio[4] as Duplex;
  let buffer = '', acknowledged = false, protocolError: Error | undefined;
  input.on('error', (error) => { protocolError = error; });
  output.on('error', (error) => { protocolError = error; });
  output.on('data', (data) => {
    buffer += data.toString();
    for (let end; (end = buffer.indexOf('\0')) >= 0;) {
      const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(raw);
        if (message.id === 1) {
          if (message.error) protocolError = new Error(`Browser.close: ${JSON.stringify(message.error)}`);
          else acknowledged = true;
        }
      } catch (error) { protocolError = error as Error; }
    }
  });
  return { chrome, close: async () => {
    const began = Date.now(), cutoff = began + 5000;
    const survivors = () => [...owned.values()].filter((p) => identity(p.pid)?.start === p.start);
    let before: Identity[] = [];
    try {
      if (spawnError) throw spawnError;
      if (trackingError) throw trackingError;
      remember();
      if (!root || identity(root.pid)?.start !== root.start || identity(root.pid)?.parent !== process.pid)
        throw new Error('browser PID/starttime/parent ownership lost before close');
      before = survivors();
      input.write(JSON.stringify({ id: 1, method: 'Browser.close' }) + '\0');
      for (;;) {
        if (protocolError) throw protocolError;
        if (trackingError) throw trackingError;
        const remaining = survivors();
        if (acknowledged && chrome.exitCode === 0 && chrome.signalCode === null && !remaining.length) break;
        if (Date.now() >= cutoff) throw new Error(`browser close cutoff: ack=${acknowledged}, exit=${chrome.exitCode}, signal=${chrome.signalCode}, survivors=${JSON.stringify(remaining)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      console.log(`browser cleanup ${JSON.stringify({ root, before, after: survivors(), acknowledged, exit: chrome.exitCode, signal: chrome.signalCode, began, cutoff, finished: Date.now() })}`);
      rmSync(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    } catch (error) {
      const evidence = join(profile, 'cleanup-failure.json');
      writeFileSync(evidence, JSON.stringify({ root, before, owned: [...owned.values()], survivors: survivors(), acknowledged, exit: chrome.exitCode, signal: chrome.signalCode, began, cutoff, finished: Date.now(), error: String(error), said }, null, 2));
      throw new Error(`browser cleanup failed; retained ${evidence}: ${error}`, { cause: error });
    } finally {
      clearInterval(tracker);
      input.destroy(); output.destroy(); chrome.stderr!.destroy();
      chrome.unref(); // Failed cleanup remains a test failure, not an unbounded wait or a signal.
    }
  } };
}
