// The cloud connect's kit side (mock key-first): the phone app runs it on the person's own boat.dev key, since a web
// page can't call boat.dev (BYOKit cloud kit D-6). Framework-free, so the phone and test/cloud-connect.test.ts share it.
import { boat, errorKey, machine, MachineError, pairEnrol, setup, words, type MachineRef, type MachineStore, type Provider, type SetupStep } from '@byokit/cloud';

export const BOAT = { label: 'boat.dev', api: 'https://boat.dev/api/v1' };
const vars = { app: 'Chief', label: BOAT.label };
// Boat's public list price (docs.boat.dev/pricing.md, read 13 Oct): a small computer and the plan's monthly floor.
const PRICES = [{ size: 'small', perHour: 0.018, planFloorPerMonth: 20, asleepPerHour: 0, currency: 'USD' as const, basis: 'list price', source: 'https://docs.boat.dev/pricing.md', checked: '2026-10-13' }];
/** What a new computer costs the person, as the approved mock words it (the kit's estimate() words leave {app} unfilled). */
export const cost = () => `$${PRICES[0].perHour}/hour · about $${(PRICES[0].perHour * 730).toFixed(2)} for 730 hours. boat.dev plans start at $${PRICES[0].planFloorPerMonth} a month with compute credit included; this computer uses that credit. List price checked 13 Oct.`;

/** Crewhouse's headless host (docs/install.md), from the portable Linux download with its pinned Node. */
export const RECIPE = {
  name: 'crewhouse', workDir: '/home/user/crewhouse',
  node: { version: '24.21.0', sha256: { 'linux-x64': 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6', 'linux-arm64': '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2' } },
  install: [['curl', '-fsSLo', 'crewhouse.tar.gz', 'https://github.com/umeranjum17/crewhouse/releases/latest/download/crewhouse-linux-x64.tar.gz'],
    ['tar', '-xzf', 'crewhouse.tar.gz'], ['crewhouse/app/crewhouse', 'setup', '--headless', '--install-only']],
  run: { argv: ['node', 'crewhouse/app/scripts/headless.mjs', 'serve'], env: {} },
};

/** The person's boat.dev; a lab build passes its fixture's address. */
export const provider = (key: () => Promise<string>, api = BOAT.api): Provider => boat({ baseUrl: api, label: BOAT.label, prices: PRICES, key });

/** Chief's words for a kit failure. */
export const said = (e: unknown) => words(e instanceof MachineError ? errorKey(e) : 'error.app', vars);

/** Paste: boat.dev reads the account and lists its computers; only a key it accepted is kept. */
export async function checkKey(p: Provider, store: MachineStore, key: string): Promise<MachineRef[]> {
  await p.account();
  const listed = await p.list!();
  const kept = await store.load();
  await store.save({ ref: kept?.ref ?? null, providerKey: key });
  return listed;
}

/** Use this computer: the kit's setup steps for the one the person picked, ending with this phone's key on it. */
export function connect(p: Provider, store: MachineStore, id: string, phoneKey: Uint8Array): AsyncGenerator<SetupStep> {
  const pick = (listed: MachineRef[]) => listed.find((r) => r.id === id) ?? (() => { throw new MachineError('no-machine', 'the picked computer is gone'); })();
  return setup({ provider: p, store, recipe: RECIPE, pick, confirmId: id, pair: pairEnrol(machine({ provider: p, store }), RECIPE, phoneKey) });
}

/** The progress list's five rows: how many the kit's last step finished, and the one a failure stopped at. The kit
 *  has no step of its own for the secure address (scout gap K-PUBLIC), so its `pairing` finishes the last two. */
const DONE: Partial<Record<SetupStep['step'], number>> = { 'checking-access': 1, inspecting: 2, installing: 3, pairing: 5, ready: 5 };
const AT = { 'checking-access': 0, listing: 1, inspecting: 1, installing: 2, pairing: 3 };
export const progress = (steps: SetupStep[]) => {
  const last = steps.at(-1);
  const done = Math.max(0, ...steps.map((s) => DONE[s.step] ?? 0));
  // A step fails only after every row before it passed: adopt() installs before the kit says inspecting.
  return last?.step === 'failed' ? { done: Math.max(done, AT[last.at]), failed: AT[last.at], why: words(last.cause, vars), retry: last.retryable } : { done, failed: -1, why: '', retry: false };
};
