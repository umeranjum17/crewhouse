// The cloud connect's kit side (mock key-first): the phone app runs it on the person's own boat.dev key, since a web
// page can't call boat.dev (BYOKit cloud kit D-6). Framework-free, so the phone and test/cloud-connect.test.ts share it.
import { boat, errorKey, machine, MachineError, pairEnrol, setup, words, type MachineRef, type MachineStore, type Provider, type SetupStep } from '@byokit/cloud';
import { b64url, hostId, unb64url, type DeviceGrant, type KeyPair } from '@byokit/pair';
import { linkUrl } from '@byokit/relay/device';
import { LINUX_DOWNLOAD } from './adapter.ts';

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
export const recipe = (relay: string, lab: { download?: string; env?: Record<string, string> } = {}) => ({
  name: 'crewhouse', workDir: '/home/user/crewhouse',
  node: { version: '24.21.0', sha256: { 'linux-x64': 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6', 'linux-arm64': '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2' } },
  install: [['curl', '-fsSLo', 'crewhouse.tar.gz', lab.download || LINUX_DOWNLOAD],
    ['tar', '-xzf', 'crewhouse.tar.gz'], ['env', `CREWHOUSE_RELAY_PUBLIC=${relay}`, 'crewhouse/app/crewhouse', 'setup', '--headless', '--install-only']],
  run: { argv: ['node', 'crewhouse/app/scripts/headless.mjs', 'serve'], env: { CREWHOUSE_RELAY_PUBLIC: relay, CREWHOUSE_CLOUD_DIR: '/home/user/crewhouse/.byokit', ...lab.env } },
});

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

/** Use this computer: the computer's public relay address, then the kit's setup steps for the one the person picked,
 *  ending with this phone's key on it. The kit's `pairing` receipt comes back as this phone's link grant (`grant`). */
export async function* connect(p: Provider, store: MachineStore, picked: MachineRef, phone: KeyPair, lab?: Parameters<typeof recipe>[1]): AsyncGenerator<SetupStep & { grant?: DeviceGrant }> {
  const pick = (listed: MachineRef[]) => listed.find((r) => r.id === picked.id) ?? (() => { throw new MachineError('no-machine', 'the picked computer is gone'); })();
  const hosted = await p.url!(picked, RELAY_PORT);
  if (!hosted) throw new MachineError('provider', 'boat.dev gave the computer no public address');
  const relay = new URL(hosted).origin, r = recipe(relay, lab);
  for await (const s of setup({ provider: p, store, recipe: r, pick, confirmId: picked.id, pair: pairEnrol(machine({ provider: p, store }), r, phone.publicKey) })) {
    yield s.step === 'pairing' && s.receipt
      ? { ...s, grant: { v: 1, secretKey: b64url(phone.secretKey), hostName: 'Your cloud computer', host: s.receipt.host, device: s.receipt.device, urls: [linkUrl(relay, hostId(unb64url(s.receipt.host)))] } } : s;
  }
}

/** The progress list's five rows: how many the kit's last step finished, and the one a failure stopped at. The secure
 *  connection is the computer's own address, whose relay answers only once Chief runs there, so the kit's `pairing`
 *  receipt finishes the last two (its tailnet `securing` step isn't used). */
const DONE: Partial<Record<SetupStep['step'], number>> = { 'checking-access': 1, inspecting: 2, installing: 3, pairing: 5, ready: 5 };
const AT = { 'checking-access': 0, listing: 1, inspecting: 1, installing: 2, securing: 3, pairing: 3 };
export const progress = (steps: SetupStep[], thrown = '') => {
  const last = steps.at(-1);
  const done = Math.max(0, ...steps.map((s) => DONE[s.step] ?? 0));
  // A step fails only after every row before it passed: adopt() installs before the kit says inspecting.
  if (last?.step === 'failed') return { done: Math.max(done, AT[last.at]), failed: AT[last.at], why: words(last.cause, vars), retry: last.retryable };
  // A throw, not a kit step: the kit names each step once it finishes, so setup was on the next row (none before the first).
  return thrown ? { done, failed: last && done < 5 ? done : -1, why: thrown, retry: true } : { done, failed: -1, why: '', retry: false };
};
