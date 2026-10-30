// The cloud connect's kit side: the phone app runs it on the person's own boat.dev key, since a web
// page can't call boat.dev (BYOKit cloud kit D-6). Framework-free, so the phone and test/cloud-connect.test.ts share it.
import { boat, claim, errorKey, machine, MachineError, pairEnrol, revokeClaim, setup, words, type MachineRef, type MachineStore, type Provider, type SetupStep } from '@byokit/cloud';
import { b64url, hostId, unb64url, type DeviceGrant, type KeyPair } from '@byokit/pair';
import { linkUrl } from '@byokit/relay/device';
import { CLOUD, LINUX_DOWNLOAD, type Computer, type ComputerAct } from './adapter.ts';

export const BOAT = { label: 'boat.dev', api: 'https://boat.dev/api/v1' };
const vars = { app: 'Chief', label: BOAT.label };
// Boat's public list price (docs.boat.dev/pricing.md, read 13 Oct): a small computer and the plan's monthly floor.
const PRICES = [{ size: 'small', perHour: 0.018, planFloorPerMonth: 20, asleepPerHour: 0, currency: 'USD' as const, basis: 'list price', source: 'https://docs.boat.dev/pricing.md', checked: '2026-10-13' }];
/** What a new computer costs the person, as the approved mock words it (the kit's estimate() words leave {app} unfilled). */
export const cost = () => `$${PRICES[0].perHour}/hour · about $${(PRICES[0].perHour * 730).toFixed(2)} for 730 hours. boat.dev plans start at $${PRICES[0].planFloorPerMonth} a month with compute credit included; this computer uses that credit. List price checked 13 Oct.`;

/** Crewhouse's headless host (docs/install.md), from the portable Linux download with its pinned Node. Its relay listens
 *  on RELAY_PORT, behind the computer's own public address (`relay`): the link is end to end encrypted and that relay
 *  admits only this computer, so no Crewhouse server sits in the middle and Tailscale is never needed. A lab build names
 *  its own download and extra run settings (`lab`). */
export const RELAY_PORT = 7300;
/** Where the app's own files live on the computer; the kit's folder (.byokit, with this phone's key and the receipt)
 *  is a sibling of it, and the download unpacks into `crewhouse` inside it. */
export const WORK_DIR = '/home/user/crewhouse';
export const recipe = (relay: string, lab: { download?: string; env?: Record<string, string> } = {}, workDir = WORK_DIR) => ({
  name: 'crewhouse', workDir,
  // Chief's own screen runs on a virtual display; boat.dev's computer has none until this one root step adds it. It installs in
  // the background, retried until it takes (apt waits for any install already running): its packages come from a mirror that
  // has taken 53 s for 3 MB, and nothing before Chief answers needs a display.
  installRoot: [['systemd-run', '--quiet', '--no-block', '--collect', '--property=Restart=on-failure', '--property=RestartSec=15', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', 'xvfb']],
  node: { version: '24.21.0', sha256: { 'linux-x64': 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6', 'linux-arm64': '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2' } },
  install: [
    // The download unpacks read-only files (the engine set is locked), so unpacking it over an earlier install
    // fails with "File exists" and the retry can never work. The old tree is made writable and removed first,
    // so a second run installs exactly like the first one did. Only the app's own folder goes: the kit's folder
    // (.byokit, with this phone's key and the receipt) is its sibling and stays.
    ['sh', '-c', `chmod -R u+w ${workDir}/crewhouse 2>/dev/null; rm -rf ${workDir}/crewhouse`],
    // Unpacked as it arrives: no 347 MB file written and read back (10.3 s against 19.8 s), and pipefail keeps curl's own failure.
    ['bash', '-c', 'set -o pipefail; curl -fsSL "$0" | tar -xz', lab.download || LINUX_DOWNLOAD],
    ['env', `CREWHOUSE_RELAY_PUBLIC=${relay}`, 'crewhouse/app/crewhouse', 'setup', '--headless', '--install-only']],
  // Download and validate before replacing the running app. The kit restarts only after the swap succeeds.
  update: [['bash', '-c', 'set -euo pipefail; d=$(mktemp -d .update.XXXXXX); trap \'chmod -R u+w "$d"; rm -rf -- "$d"\' EXIT; curl -fsSL "$0" | tar -xz -C "$d"; test -x "$d/crewhouse/app/crewhouse"; mv crewhouse "$d/previous"; mv "$d/crewhouse" crewhouse || { mv "$d/previous" crewhouse; exit 1; }', lab.download || LINUX_DOWNLOAD]],
  run: { argv: ['node', 'crewhouse/app/scripts/headless.mjs', 'serve'], env: { CREWHOUSE_RELAY_PUBLIC: relay, CREWHOUSE_CLOUD_DIR: `${workDir}/.byokit`, ...lab.env } },
});

/** The person's boat.dev; a lab build passes its fixture's address. */
export const provider = (key: () => Promise<string>, api = BOAT.api): Provider => boat({ baseUrl: api, label: BOAT.label, prices: PRICES, key });

/** The app's own refusal carries its own code, so its words can name what went wrong. */
const refuse = (code: string, message: string) => Object.assign(new Error(message), { code });

/** Chief's words for a kit failure, and for the app's own refusals. */
export const said = (e: unknown) => {
  const code = typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : '';
  return CLOUD.problem[code] ?? words(e instanceof MachineError ? errorKey(e) : 'error.app', vars);
};

/** Paste: boat.dev reads the account and lists its computers; only a key it accepted is kept. */
let credentialWrite = Promise.resolve();
export async function checkKey(p: Provider, store: MachineStore, key: string, signal?: AbortSignal): Promise<MachineRef[]> {
  await p.account();
  const listed = await p.list!();
  const write = credentialWrite.then(async () => {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const kept = await store.load();
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    await store.save({ ref: kept?.ref ?? null, providerKey: key });
  });
  credentialWrite = write.catch(() => undefined);
  await write;
  return listed;
}

/** Where the sign-in stands, as the screen shows it. The key itself is never a state: it goes straight into the store. */
export type SignIn =
  | { at: 'starting' }
  | { at: 'waiting'; url: string; code: string }
  | { at: 'done'; listed: MachineRef[] }
  | { at: 'failed'; why: 'refused' | 'expired' | 'unreachable' | 'provider' | 'timeout' };
/** The person has this long on boat.dev's page before the sign-in is dropped and they are told so. */
export const SIGN_IN_MS = 10 * 60_000;

/** Sign in with a code (the kit's `claim`): the person's email goes to boat.dev as the login hint, the app shows boat.dev's
 *  link and code, and the key boat.dev issues goes into the store and nowhere else. An abort ends it with no state. */
export async function* signIn(email: string, store: MachineStore, o: { api?: string; signal?: AbortSignal; ms?: number } = {}): AsyncGenerator<SignIn> {
  const api = o.api ?? BOAT.api, stop = new AbortController();
  let late = false;
  const timer = setTimeout(() => { late = true; stop.abort(); }, o.ms ?? SIGN_IN_MS), off = () => stop.abort();
  o.signal?.addEventListener('abort', off);
  try {
    for await (const step of claim({ baseUrl: api, email, signal: stop.signal })) {
      if (step.step === 'type-code') yield { at: 'waiting', url: step.url, code: step.code };
      else if (step.step === 'failed') return yield { at: 'failed', why: step.why };
      else if (step.step === 'done') {
        clearTimeout(timer);
        try { return yield { at: 'done', listed: await checkKey(provider(async () => step.key, api), store, step.key, stop.signal) }; }
        catch (e) {
          if (o.signal?.aborted) return;
          await revokeClaim({ baseUrl: api, key: step.key }).catch(() => undefined); // no live key outlives a sign-in that failed
          return yield { at: 'failed', why: e instanceof MachineError && e.code === 'unreachable' ? 'unreachable' : 'provider' };
        }
      }
    }
    if (late) yield { at: 'failed', why: 'timeout' };
  } finally { clearTimeout(timer); o.signal?.removeEventListener('abort', off); }
}
/** Chief's words for a sign-in that did not finish: the kit's for a refused email and an expired code, the app's for the rest. */
export const signInSaid = (why: Extract<SignIn, { at: 'failed' }>['why']) =>
  why === 'refused' ? words('claim.refused', vars) : why === 'expired' ? words('claim.expired', vars) : CLOUD.signin.failed[why];

/** Why an unlink left the key where it was. Never the key, never boat.dev's own text: a word the screen can say. */
export type Unlinked = 'done' | 'unreachable' | 'refused' | 'provider';
/** Unlink: end the stored key at boat.dev (the kit's `revokeClaim`) FIRST, and delete the local copy (`forget`) only once boat.dev
 *  has confirmed. Any other ending keeps the key and the signed-in state, so the person can try again and no live key is ever left
 *  behind a screen that says signed out. With no key held there is nothing to end. */
export async function unlink(store: MachineStore, forget: () => Promise<void>, o: { api?: string; signal?: AbortSignal } = {}): Promise<Unlinked> {
  const key = (await store.load())?.providerKey;
  if (key) {
    const api = o.api ?? BOAT.api;
    try { await revokeClaim({ baseUrl: api, key, signal: o.signal }); }
    catch (e) {
      const code = e instanceof MachineError ? e.code : 'unreachable';
      if (code !== 'unauthorized') return code === 'unreachable' ? 'unreachable' : 'provider';
      // boat.dev answered the revoke 401: the key may already be dead (an earlier unlink ended it but the phone's delete did not
      // finish), and a dead key can't end itself. Only boat.dev itself refusing the key too makes it safe to delete; else it is kept.
      const dead = await provider(async () => key, api).account().then(() => false, (x) => x instanceof MachineError && x.code === 'unauthorized');
      if (!dead) return 'refused';
    }
  }
  await forget();
  return 'done';
}

/** Make a new computer: boat.dev rents it in the person's own account, then it is set up like a picked one. The
 *  press's own key makes a repeated call the same rental, never a second one. */
export const make = (p: Provider, press: string) => p.create!({ name: 'computer', size: PRICES[0].size, keepCopies: true, idempotencyKey: press });

/** One setup at a time per store: a retry must not race the run it retries. */
const running = new WeakSet<MachineStore>();

/** Use this computer: the computer's public relay address, then the kit's setup steps for the one the person picked,
 *  ending with this phone's key on it. The kit's `pairing` receipt comes back as this phone's link grant (`grant`).
 *  `move`: the person confirmed moving Chief here from the phone that set this computer up, which then loses access. */
export async function* connect(p: Provider, store: MachineStore, picked: MachineRef, phone: KeyPair, lab?: Parameters<typeof recipe>[1], move = false): AsyncGenerator<SetupStep & { grant?: DeviceGrant }> {
  if (running.has(store)) throw refuse('setup-running', 'a setup is already running on this phone');
  running.add(store);
  try {
    const pick = (listed: MachineRef[]) => listed.find((r) => r.id === picked.id) ?? (() => { throw new MachineError('no-machine', 'the picked computer is gone'); })();
    const hosted = await p.url!(picked, RELAY_PORT);
    if (!hosted) {
      // No address: the computer is gone from the account, or boat.dev gave it none. The person needs
      // to know which one it is, so the app asks before it says anything.
      const gone = (await p.status(picked)) === 'gone';
      throw refuse(gone ? 'computer-gone' : 'no-address', gone ? 'the picked computer is gone' : 'boat.dev gave the computer no public address');
    }
    const kept = await store.load();
    // The kit adopts one computer per store. The computer this phone already has is set up again (the kit
    // reuses it, so a retry installs on it and carries on); any other one replaces it in the store, so the
    // kit can adopt that one instead. The computers themselves are never touched: they stay in the
    // person's boat.dev account, rented and billed there.
    if (kept?.ref && kept.ref.id !== picked.id) await store.save({ ...kept, ref: null });
    const relay = new URL(hosted).origin, r = recipe(relay, lab);
    // The kit's machine keeps the record it read, so it reads the store through this view: it sees the
    // computer this run released, not the one an earlier run held.
    const s: MachineStore = { load: () => store.load(), save: (record) => store.save(record) };
    for await (const step of setup({ provider: p, store: s, recipe: r, pick, confirmId: picked.id, replaceOwner: move, pair: pairEnrol(machine({ provider: p, store: s }), r, phone.publicKey) })) {
      if (step.step === 'pairing' && step.receipt) await store.save(Object.assign((await store.load())!, { host: step.receipt.host }));
      yield step.step === 'pairing' && step.receipt
        ? { ...step, grant: { v: 1, secretKey: b64url(phone.secretKey), hostName: 'Your cloud computer', host: step.receipt.host, device: step.receipt.device, urls: [linkUrl(relay, hostId(unb64url(step.receipt.host)))] } } : step;
    }
  } finally {
    running.delete(store);
  }
}

/** Phone-side management: the provider key never goes to crewd or a browser. No invented update/schedule state. */
export async function computerCall(p: Provider, store: MachineStore, host: string, act?: ComputerAct, snapshotId?: string, lab?: Parameters<typeof recipe>[1], onRestored?: (relay: string) => Promise<void>): Promise<Computer | null> {
  if (running.has(store)) throw refuse('setup-running', 'Setup or a computer action is already running on this phone.');
  running.add(store);
  try {
    const kept = await store.load();
    if (!kept?.ref || !('host' in kept) || kept.host !== host) throw new Error('Use the phone that set up this computer to manage it.');
    const s: MachineStore = { load: () => store.load(), save: (r) => store.save(r) }, m = machine({ provider: p, store: s });
    const address = async () => {
      const url = await p.url!(m.ref ?? kept.ref!, RELAY_PORT);
      if (!url) throw refuse('no-address', 'boat.dev gave that computer no public address.');
      return new URL(url).origin;
    };
    let warning: string | undefined;
    if (act === 'delete') { await m.remove(kept.ref.id); return null; }
    if (act === 'update') await m.update(recipe(await address(), lab), { undo: false }); // the kit's saved copy before an update (0.6.0) is a separate feature: Undo update stays "not available yet"
    if (act === 'snapshot') {
      const saved = await m.snapshot({ keep: 7 });
      if (saved.pruneError) warning = `Snapshot saved, but older snapshots could not be removed. ${said(saved.pruneError)}`;
    }
    if (act === 'reset') {
      if (!snapshotId) throw new Error('Save a snapshot before resetting the computer.');
      await m.restore(snapshotId); // the exact copy whose time the person confirmed, never a newer replacement
      await onRestored?.(await address()); // keep the replacement's reach even if the following disk read fails
    }
    const [copies, disk, relay] = await Promise.all([m.snapshots(), m.disk(), address()]);
    return { daily: false, snapshot: copies[0] ? Date.parse(copies[0].at) : undefined, snapshotId: copies[0]?.id,
      disk: disk.usedGb / disk.totalGb >= 0.95 ? 'full' : disk.usedGb / disk.totalGb >= 0.8 ? 'filling' : 'normal', relay, warning };
  } finally { running.delete(store); }
}
export const computerGrant = (g: DeviceGrant, relay: string): DeviceGrant => ({ ...g, urls: [linkUrl(relay, hostId(unb64url(g.host)))] });

/** The progress list's five rows: how many the kit's last step finished, and the one a failure stopped at. The secure
 *  connection is the computer's own address, whose relay answers only once Chief runs there, so the kit's `pairing`
 *  receipt finishes the last two (its tailnet `securing` step isn't used). */
const DONE: Partial<Record<SetupStep['step'], number>> = { 'checking-access': 1, inspecting: 2, installing: 3, pairing: 5, ready: 5 };
const AT = { 'checking-access': 0, listing: 1, creating: 1, inspecting: 1, installing: 2, securing: 3, pairing: 3 };
/** A failed step's words: which step stopped, then the kit's cause. The one failure the app itself causes is the
 *  picked computer being gone: the kit lists the account's computers and the app's pick cannot find it, which the kit
 *  words as a plain problem. The app knows what happened, so it says that. */
const whyOf = (s: Extract<SetupStep, { step: 'failed' }>) => s.at === 'listing' && s.cause === 'error.app' ? CLOUD.problem['computer-gone']
  : `${CLOUD.steps.stopped[AT[s.at]]} ${words(s.cause, vars)}`;
export const progress = (steps: SetupStep[], thrown = '') => {
  const last = steps.at(-1);
  const done = Math.max(0, ...steps.map((s) => DONE[s.step] ?? 0));
  // A step fails only after every row before it passed: adopt() installs before the kit says inspecting.
  // A computer another phone set up offers the move to this phone (`move`), which connect() then makes.
  if (last?.step === 'failed') return { done: Math.max(done, AT[last.at]), failed: AT[last.at], why: whyOf(last), retry: last.retryable, move: last.cause === 'error.ownerEnrolled' };
  // A throw, not a kit step: the kit names each step once it finishes, so setup was on the next row (none before the first).
  return { ...(thrown ? { done, failed: last && done < 5 ? done : -1, why: thrown, retry: true } : { done, failed: -1, why: '', retry: false }), move: false };
};
