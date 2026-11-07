// `crewhouse triage`: repairs what stops Crewhouse starting, even when the app cannot load. Node only, no AI, no network.
// Four rules, in this order of trust:
//   fixes itself   its own folder permissions and files that name a Crewhouse that is no longer running
//   asks first     keeping Crewhouse running after logout; moving a damaged database aside
//   hands over     one line for what it must not do itself: a port another program holds, an administrator's step, signing in to AI again, a full disk
//   never          deletes data (a database is moved, never removed), prints a key, kills what it cannot prove is Crewhouse's own,
//                  or loosens a setting that belongs to the whole machine (no sudo, nothing wider than the person's own folders)
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { databaseProblem, engineFolderProblem, portProblem } from './health.mjs';
import { keepPrivate } from './private.mjs';
import { sandbox } from './sandbox.mjs';

/** Whether `pid` is this install's own crewd: its folder and its command, both. Anything else is never touched. */
const ours = (cfg, pid) => {
  try { return realpathSync(`/proc/${pid}/cwd`) === realpathSync(cfg.repoDir) && /src\/main\.ts|dist\/crewd\.js/.test(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ')); } catch { return false; }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Returns the exit code: 0 when nothing is left for the person, 1 when something is (declined, or nobody to ask). */
export async function triage(cfg, { yes = false, cmd = 'crewhouse', input = process.stdin, say = console.log } = {}) {
  const { stateDir } = cfg;
  let fixed = 0, left = 0;
  const rl = !yes && input.isTTY ? createInterface({ input, output: process.stdout }) : null;
  /** What only the person can do: said once, in one line, and counted as still theirs. Nothing is run for them. */
  const handOver = (what, cause, next) => { say(`For you, ${what}: ${cause}.\n  ${next}`); left++; };
  const ask = async (question, why) => {
    if (yes) return true;
    if (!rl) { say(`Needs a yes: ${question}\n  ${why}\n  Run ${cmd} triage in a terminal to answer, or add --yes.`); left++; return false; }
    const ok = /^y/i.test((await rl.question(`${question}\n  ${why}\n  [y/N] `)).trim());
    if (!ok) { say('Left as it is.'); left++; }
    return ok;
  };
  try {
    // Fixes itself: its folders are the person's alone.
    for (const dir of [process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), stateDir]) { const said = keepPrivate(dir); if (said) { say(`Fixed: ${said}`); fixed++; } }
    // Fixes itself: a pid file left by a Crewhouse that is gone names nothing of ours; the file goes, no process is touched.
    const pidFile = join(stateDir, 'crewd.pid'), pid = Number(existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : 0);
    const running = pid > 0 && alive(pid) && ours(cfg, pid);
    if (pid > 0 && !running) { rmSync(pidFile, { force: true }); rmSync(join(stateDir, 'endpoint'), { force: true }); say('Fixed: removed the leftover record of a Crewhouse that is no longer running.'); fixed++; }

    // Asks first: a damaged database is moved aside, kept whole next to where it was, never removed.
    if (databaseProblem(stateDir)) {
      const db = join(stateDir, 'crew.db');
      if (running) { say(`The database is damaged, and Crewhouse is running.\n  Stop it first (${cmd} stop), then run ${cmd} triage again.`); left++; }
      else if (await ask('The database (crew.db) is damaged. Move it aside and start with a new one?',
        `The damaged file is kept next to it, nothing is deleted. Chats and tasks in it will not show in the new one; your crew's folders and notes stay.`)) {
        const kept = `${db}.damaged-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
        for (const suffix of ['', '-wal', '-shm']) if (existsSync(db + suffix)) renameSync(db + suffix, kept + suffix);
        say(`Fixed: moved the damaged database aside. It is kept at ${kept}. Start Crewhouse again with ${cmd} start.`); fixed++;
      }
    }

    // Asks first: a login service stops with the last logout unless the account lingers.
    const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'crewhouse.service'), user = process.env.USER || '';
    if (existsSync(unit) && user && spawnSync('loginctl', ['show-user', user, '-P', 'Linger'], { encoding: 'utf8' }).stdout?.trim() === 'no'
      && await ask('Crewhouse starts when you log in but stops when you log out. Keep it running after logout?', 'This turns on linger for your own account (loginctl enable-linger); no administrator is needed.')) {
      if (spawnSync('loginctl', ['enable-linger', user]).status === 0) { say('Fixed: Crewhouse keeps running after you log out, and after a restart.'); fixed++; }
      else { say(`This computer did not allow it. Ask an administrator to run: sudo loginctl enable-linger ${user}`); left++; }
    }

    // Hands over: a port that another program holds is that program's to give up; Crewhouse signals nothing it did not start.
    const held = running ? null : await portProblem(cfg);
    if (held) handOver(held.what, held.cause, `Do this: ${held.next}`);
    // Hands over: an administrator's step (the helpers' sandbox needs a package, and on Ubuntu a rule, installed with sudo).
    const wall = sandbox();
    if (!wall.ok) handOver("the helpers' shell", wall.cause, `Do this: ${wall.next}`);
    // Hands over: the AI sign-ins live in the engine's own folder; one that is gone has taken them, and only the person can sign in again.
    const lost = engineFolderProblem(cfg);
    if (lost) handOver('AI sign-in', lost.cause, `Do this: ${lost.next}`);
    // Hands over: a full disk, which only the person can free; nothing of Crewhouse's is removed to make room.
    let mb = null; try { const free = statfsSync(existsSync(stateDir) ? stateDir : join(stateDir, '..')); mb = Math.floor(free.bavail * free.bsize / 1048576); } catch { /* no folder there yet: nothing to measure, and start makes it */ }
    const need = Number(process.env.CREWHOUSE_MIN_FREE_MB || 500);
    if (mb !== null && mb < need) handOver('disk space', `the disk holding ${stateDir} has ${mb} MB free and Crewhouse needs ${need} MB`, `Do this: free some space (nothing of Crewhouse's is removed for you), then run ${cmd} start`);
  } finally { rl?.close(); }
  say(left ? `${left} thing(s) are still for you.` : fixed ? `Done: ${fixed} thing(s) repaired. ${cmd} doctor says whether Crewhouse can run now.` : `Nothing needed repairing. ${cmd} doctor says whether Crewhouse can run.`);
  return left ? 1 : 0;
}
