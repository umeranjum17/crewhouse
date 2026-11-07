#!/usr/bin/env bash
# Verify journey `setup-fixes`: the setup fixes, each on a fresh stock Ubuntu 24.04 machine (docs/verification/setup-fixes.md).
# Boots Ubuntu's own cloud image in a throwaway qemu VM (KVM, systemd 255) from a copy-on-write overlay, with two accounts:
# `ops` (admin, only to look from outside) and `brk` (the default login without sudo; each run adds a fresh login of its own).
# Real ssh logins with a terminal, a real logout, a real `sudo reboot`.
#
#   scripts/verify/setup-fixes.sh <out-dir> fix1 <crewhouse-linux-x64.tar.gz> dead|alive [headless]
#     the one-line install from that tarball, Enter at "Start Crewhouse by itself...", logout, 60 s, then the port from `ops`;
#     then a reboot and the port again. `alive` (the fix) passes only on 200 both times; `dead` (the released build) passes only
#     when the port answers nothing after the logout, so the failure it fixes is shown on the same machine.
#     `headless` installs without starting, then runs `crewhouse setup --headless` (own relay on loopback) instead of answering the question.
#   UBUNTU_IMG=<noble-server-cloudimg-amd64.img>   default: downloaded once into $SETUP_FIXES_SCRATCH
#   QEMU_IMAGE=<docker image with qemu-system-x86 and genisoimage>   default byk-cloud-qemu:1
#
# Writes <out-dir>/setup-<fix>-<label>.txt (every command's words, stamped) and steps.json for done-done; exit 0 only when the run met its expectation.
set -uo pipefail
[ $# -ge 4 ] || { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); FIX=$2; TB=$(realpath "$3"); EXPECT=$4
[ "$FIX" = fix1 ] && { [ "$EXPECT" = dead ] || [ "$EXPECT" = alive ]; } || { echo "setup-fixes: usage: <out> fix1 <tarball> dead|alive" >&2; exit 2; }
SCR=${SETUP_FIXES_SCRATCH:-$HOME/.cache/fm-scratch/setup-fixes}; mkdir -p "$SCR"
IMG=${UBUNTU_IMG:-$SCR/noble.img}
[ -f "$IMG" ] || curl -fsSL -o "$IMG" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img || { echo "setup-fixes: cannot fetch the Ubuntu 24.04 image" >&2; exit 1; }
[ -w /dev/kvm ] || { echo "setup-fixes: needs /dev/kvm" >&2; exit 1; }
W=$(mktemp -d -p "$SCR" run.XXXXXX); NAME=setup-fixes-$$; PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
QI=${QEMU_IMAGE:-byk-cloud-qemu:1}
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -rf -- "$W"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "$W/key"; PUB=$(cat "$W/key.pub")
mkdir -p "$W/seed"
printf '#cloud-config\nusers:\n  - name: ops\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\n  - name: brk\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\nssh_pwauth: false\n' "$PUB" "$PUB" > "$W/seed/user-data"
printf 'instance-id: sf-%s\nlocal-hostname: plan-vm\n' "$$" > "$W/seed/meta-data"
U=$(id -u):$(id -g)
docker run --rm --user "$U" -v "$W":/w -v "$IMG":/img/base.img:ro "$QI" sh -c 'cd /w && genisoimage -quiet -output seed.iso -volid cidata -joliet -rock seed/user-data seed/meta-data && qemu-img create -q -f qcow2 -F qcow2 -b /img/base.img disk.qcow2 20G' || exit 1
echo "setup-fixes: booting stock Ubuntu 24.04 (about a minute)"
docker run -d --name "$NAME" --user "$U" --device /dev/kvm -v "$W":/w -v "$IMG":/img/base.img:ro -p "127.0.0.1:$PORT:2232" "$QI" \
  qemu-system-x86_64 -enable-kvm -cpu host -m 4096 -smp 2 -nographic -drive file=/w/disk.qcow2,if=virtio -drive file=/w/seed.iso,if=virtio,format=raw \
  -netdev user,id=n,hostfwd=tcp::2232-:22 -device virtio-net-pci,netdev=n >/dev/null || exit 1
SSHO=(-i "$W/key" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)
SCPO=(-i "$W/key" -P "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -q)
vm() { local u=$1; shift; ssh "${SSHO[@]}" "$u@127.0.0.1" "$@"; }
up() { for _ in $(seq 60); do vm ops true 2>/dev/null && return 0; sleep 3; done; return 1; }
up || { echo "setup-fixes: the VM never answered ssh" >&2; exit 1; }
# Run one command over a real ssh terminal, stamp each line, answer prompts, drop pairing QRs and codes. usage: term <user> <seconds> <command> [regex=>answer ...]
cat > "$W/term.py" <<'PY'
import os, pty, re, select, sys, time
user, timeout, cmd = sys.argv[1], float(sys.argv[2]), sys.argv[3]
rules = [(re.compile(a.split('=>')[0]), a.split('=>')[1]) for a in sys.argv[4:]]
argv = ['ssh', '-tt', '-i', os.environ['KEY'], '-p', os.environ['PORT'], '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', f'{user}@127.0.0.1', cmd]
pid, fd = pty.fork()
if pid == 0: os.execvp('ssh', argv)
t0 = time.time(); pend = ''; done = set(); ansi = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
def emit(s):
    s = ansi.sub('', s).rstrip()
    if re.search(r'[█▀▄]{3,}', s): return
    s = re.sub(r'((?:Phone p|P)airing code: ).*', r'\1<pairing-code>', s)
    if '\r' in s: s = s.split('\r')[-1]
    print(f'[{time.time()-t0:6.1f}s] {s[:300]}', flush=True)
while time.time() - t0 < timeout:
    r, _, _ = select.select([fd], [], [], 1)
    if r:
        try: d = os.read(fd, 65536)
        except OSError: break
        if not d: break
        pend += d.decode('utf8', 'replace')
        while '\n' in pend:
            l, pend = pend.split('\n', 1); emit(l)
    for i, (rx, ans) in enumerate(rules):
        if i not in done and rx.search(pend):
            done.add(i); emit(pend); pend = ''
            os.write(fd, (ans.replace('ENTER', '') + '\n').encode())
if pend: emit(pend)
try: os.waitpid(pid, 0)
except OSError: pass
print(f'[{time.time()-t0:6.1f}s] logged out')
PY
term() { KEY="$W/key" PORT="$PORT" python3 "$W/term.py" "$@"; }

L=$(tr -dc a-z < /dev/urandom | head -c 5); ACC=u$L; LABEL=$(basename "$TB" .tar.gz); MODE=${5:-install}
T="$OUT/setup-$FIX-$LABEL${5:+-$5}.txt"
{
  echo "== fresh machine: $(vm ops 'lsb_release -ds; uname -r; systemctl --version | head -1' | tr '\n' ' ')"
  vm ops "sudo useradd -m -s /bin/bash $ACC && sudo install -d -m 700 -o $ACC -g $ACC /home/$ACC/.ssh && sudo cp /home/brk/.ssh/authorized_keys /home/$ACC/.ssh/ && sudo chown $ACC:$ACC /home/$ACC/.ssh/authorized_keys"
  scp "${SCPO[@]}" "$TB" "ops@127.0.0.1:/var/tmp/crewhouse.tar.gz" && tar -xzOf "$TB" crewhouse/app/install.sh | vm ops 'cat > /var/tmp/install.sh; chmod 644 /var/tmp/*'
  probe() { vm ops "echo \"port 7711 answers \$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 127.0.0.1:7711)\"; echo \"linger: \$(loginctl show-user $ACC -P Linger 2>&1 | head -1)\"; echo \"sessions of $ACC: \$(loginctl list-sessions --no-legend | awk '\$3==\"$ACC\"' | wc -l)\""; }
  if [ "$MODE" = headless ]; then
    echo "== the install line from $LABEL (no terminal on its output, so it only installs), then crewhouse setup --headless (login $ACC, a stock Ubuntu login with no sudo)"
    term $ACC 400 "CREWHOUSE_TARBALL=/var/tmp/crewhouse.tar.gz sh /var/tmp/install.sh | cat; CREWHOUSE_RELAY_PUBLIC=http://127.0.0.1:7300 ~/.local/bin/crewhouse setup --headless"
  else
    echo "== the install line from $LABEL, Enter at the question (login $ACC, a stock Ubuntu login with no sudo)"
    term $ACC 400 "CREWHOUSE_TARBALL=/var/tmp/crewhouse.tar.gz sh /var/tmp/install.sh" 'Start Crewhouse by itself=>ENTER'
  fi
  echo "== 5 s after the logout"; sleep 5; probe
  echo "== 60 s after the logout"; sleep 55; probe
  echo "== sudo reboot"; vm ops 'sudo reboot' >/dev/null 2>&1; sleep 25; up
  echo "== after the reboot, nobody of $ACC logged in (up to 120 s for the service)"
  for _ in $(seq 24); do [ "$(vm ops "curl -s -o /dev/null -w '%{http_code}' --max-time 3 127.0.0.1:7711")" = 200 ] && break; sleep 5; done
  probe
} 2>&1 | tee "$T"
if [ "$EXPECT" = alive ]; then
  [ "$(grep -c '^port 7711 answers 200' "$T")" = 3 ] && grep -q 'linger: yes' "$T" && grep -q 'Crewhouse keeps running after you log out' "$T"; ok=$?
else
  grep -A1 '^== 60 s after' "$T" | tail -1 | grep -q 'answers 000' && grep -q '^linger: no\|not logged in or lingering' "$T"; ok=$?
fi
node -e '
const [, out, label, expect] = process.argv;
require("node:fs").writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: label },
  start: "a fresh stock Ubuntu 24.04 cloud image, a default login without sudo, nothing of Crewhouse installed",
  steps: ["Run the one-line install from " + label + " and press Enter at the question about starting Crewhouse at login", "Log out, wait 60 seconds, ask port 7711 from the admin account", "sudo reboot, wait for the machine, ask port 7711 again with nobody logged in"],
  result: expect === "alive" ? "Crewhouse answers 200 after logout and after a reboot" : "Crewhouse is gone 60 seconds after logout (the released build)" }, null, 1));
' "$OUT" "$LABEL" "$EXPECT"
[ "$ok" = 0 ] && echo "setup-fixes: $FIX $EXPECT met" || { echo "setup-fixes: $FIX $EXPECT NOT met; see $T" >&2; exit 1; }
