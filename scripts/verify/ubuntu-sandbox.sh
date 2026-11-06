#!/usr/bin/env bash
# Verify journey `ubuntu-sandbox`: a stock Ubuntu 24.04 login gets a working helper sandbox through Crewhouse's own install.
# Boots Ubuntu's own cloud image in a throwaway VM (KVM) twice, from a copy-on-write overlay, so the image is never changed:
#   deb    apt installs the .deb (its postinst installs Ubuntu's AppArmor rule for bubblewrap)
#   setup  no .deb install; the unpacked folder's `crewhouse setup`, typed by the stock login, installs it after a yes
# Each run prints, as the stock `ubuntu` login, the probe and doctor BEFORE and AFTER, and crewd's own sandboxed shell command.
#
#   scripts/verify/ubuntu-sandbox.sh <out-dir> <crewhouse_*_amd64.deb> [deb|setup ...]
#   UBUNTU_IMG=<noble-server-cloudimg-amd64.img>   default: downloaded once into $UBUNTU_SCRATCH (~/.cache/fm-scratch/ubuntu-sandbox)
#   QEMU_IMAGE=<docker image with qemu-system-x86 and cloud-image-utils>   used when the host has no qemu (default ch-ob-deb-qemu:1)
#
# Exit 0 and <out-dir>/ubuntu-sandbox-<mode>.txt (the VM console, from @@@ START to @@@ END) when, in each mode, the probe fails
# before with the kernel's AppArmor refusal and passes after, doctor repeats it, and crewd's shell runs.
set -uo pipefail
[ $# -ge 2 ] || { echo "usage: ubuntu-sandbox.sh <out-dir> <crewhouse.deb> [deb|setup ...]" >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); DEB=$(realpath "$2"); shift 2; MODES=("$@"); [ ${#MODES[@]} -gt 0 ] || MODES=(deb setup)
HERE=$(cd "$(dirname "$0")" && pwd -P)
SCR=${UBUNTU_SCRATCH:-$HOME/.cache/fm-scratch/ubuntu-sandbox}; mkdir -p "$SCR"
IMG=${UBUNTU_IMG:-$SCR/noble.img}
[ -f "$IMG" ] || curl -fsSL -o "$IMG" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img || { echo "ubuntu-sandbox: cannot fetch the Ubuntu 24.04 image" >&2; exit 1; }
[ -w /dev/kvm ] || { echo "ubuntu-sandbox: needs /dev/kvm" >&2; exit 1; }
FAILED=0
for mode in "${MODES[@]}"; do
  W=$(mktemp -d -p "$SCR" run.XXXXXX); mkdir -p "$W/serve" "$W/got"
  cp "$HERE/ubuntu-sandbox-guest.sh" "$W/serve/run.sh"; cp "$HERE/ubuntu-sandbox-serve.py" "$W/serve.py"; ln "$DEB" "$W/serve/crewhouse.deb" 2>/dev/null || cp "$DEB" "$W/serve/crewhouse.deb"
  printf '#cloud-config\nruncmd:\n  - [ bash, -c, "curl -fsS http://10.0.2.2:8123/run.sh -o /root/run.sh && bash /root/run.sh %s" ]\n' "$mode" > "$W/user-data"
  printf 'instance-id: ubuntu-sandbox-%s-%s\nlocal-hostname: lab\n' "$mode" "$$" > "$W/meta-data"
  QEMU='cd /w && qemu-img create -q -f qcow2 -F qcow2 -b /img/base.img disk.qcow2 12G && cloud-localds seed.iso user-data meta-data && (cd serve && python3 /w/serve.py >/dev/null 2>&1 &) && timeout 900 qemu-system-x86_64 -enable-kvm -m 3072 -smp 2 -nographic -no-reboot -drive file=disk.qcow2,if=virtio -drive file=seed.iso,if=virtio,format=raw -netdev user,id=n -device virtio-net-pci,netdev=n -serial file:/w/console.log -monitor none -display none'
  echo "ubuntu-sandbox: booting stock Ubuntu 24.04 for '$mode' (about 4 minutes)"
  docker run --rm --device /dev/kvm -v "$W":/w -v "$IMG":/img/base.img:ro "${QEMU_IMAGE:-ch-ob-deb-qemu:1}" bash -c "$QEMU" > "$W/qemu.out" 2>&1
  tr -d '\r' < "$W/got/transcript.txt" 2>/dev/null | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g' | sed -n '/@@@ START/,/@@@ END/p' | sed 's/^.*@@@ START/@@@ START/' > "$OUT/ubuntu-sandbox-$mode.txt"
  T="$OUT/ubuntu-sandbox-$mode.txt"
  if [ -s "$T" ]; then rm -rf -- "$W"; else echo "ubuntu-sandbox: the VM said nothing; its folder is kept: $W" >&2; tail -5 "$W/qemu.out" >&2; fi
  ok() { grep -qE -- "$1" "$T" || { echo "ubuntu-sandbox: FAIL ($mode): missing /$1/" >&2; FAILED=1; }; }
  ok '@@@ END'
  ok 'kernel.apparmor_restrict_unprivileged_userns = 1'
  ok 'loopback: Failed RTM_NEWADDR: Operation not permitted'            # BEFORE: the real probe command fails as the kernel says
  ok "still cannot start: Ubuntu's AppArmor stops bubblewrap"            # BEFORE: our probe names the cause
  ok 'no sandbox here: bots work without a shell'                        # BEFORE: doctor
  ok "works here"                                                        # AFTER: our probe
  ok "Bots' shell runs in a sandbox \(bubblewrap\)"                      # AFTER: doctor
  ok '"code":0,"tail":"ubuntu\\nhello\\n'                                # AFTER: crewd's own shell command ran
done
# The step record done-done wants beside the captures.
node -e '
const [, out, deb, ...modes] = process.argv, version = (deb.match(/crewhouse_(.+)_amd64/) ?? [])[1] ?? "unknown";
require("node:fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version },
  start: "a stock Ubuntu 24.04 cloud image, the default ubuntu login, bubblewrap from the archive, nothing of Crewhouse installed",
  steps: ["As the ubuntu login, run the sandbox probe command Crewhouse used until now: it fails with the kernel refusing the namespace", "Run the new probe and ./crewhouse doctor from the unpacked package: both name the AppArmor cause and the one command",
    ...modes.map((m) => m === "deb" ? "apt install the .deb: Ubuntu\u0027s apparmor-profiles comes with it and its rule is installed and loaded" : "Run crewhouse setup in a terminal, answer yes: Ubuntu\u0027s rule is installed with sudo"),
    "As the ubuntu login again: the probe passes, doctor says the sandbox works, and crewd\u0027s own sandboxed shell command runs"],
  result: "The helpers\u0027 sandbox works on a stock Ubuntu 24.04 login after Crewhouse\u0027s own install, and doctor says what the probe says" }, null, 1));
' "$OUT" "$DEB" "${MODES[@]}"
exit $FAILED
