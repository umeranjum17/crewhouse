// `crewhouse triage`: repairs what stops Crewhouse starting, even when the app cannot load. Node only, no AI, no network.
// Four rules, in this order of trust:
//   fixes itself   its own folder permissions and files that name a Crewhouse that is no longer running
//   asks first     keeping Crewhouse running after logout; moving a damaged database aside
//   hands over     one line for what it must not do itself (added with the hand-overs)
//   never          deletes data (a database is moved, never removed), prints a key, kills what it cannot prove is Crewhouse's own,
//                  or loosens a setting that belongs to the whole machine (no sudo, nothing wider than the person's own folders)
import { existsSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { databaseProblem } from './health.mjs';
import { keepPrivate } from './private.mjs';

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
  } finally { rl?.close(); }
  say(left ? `${left} thing(s) still need you.` : fixed ? `Done: ${fixed} thing(s) repaired. ${cmd} doctor says whether Crewhouse can run now.` : `Nothing needed repairing. ${cmd} doctor says whether Crewhouse can run.`);
  return left ? 1 : 0;
}
