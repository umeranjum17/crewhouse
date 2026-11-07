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
#   scripts/verify/setup-fixes.sh <out-dir> fix2 <crewhouse-linux-x64.tar.gz> ready|honest
#     installed and started, then one break at a time (a port another program holds, a corrupt database, the app's files gone,
#     the engine folder gone, no internet) with `crewhouse doctor` asked after each. `honest` (the fix) passes only when every
#     break gives exit 1, a ✗ line and a fix line, no stack trace, and the unbroken machine is ready; `ready` (the released
#     build) passes only when doctor calls the broken machine ready, and crashes on the missing files.
#
#   scripts/verify/setup-fixes.sh <out-dir> fix3 <crewhouse-X.tgz from `npm pack` | an npm spec such as crewhouse@0.1.10> fails|works
#     a stock login with no Node: Node 24 by nvm, `npm install -g`, `crewhouse start`. `works` (the fix) passes when it is running
#     with exit 0, and when a state folder that is someone else's gives plain words (no stack trace, one next line) and the
#     line it names brings Crewhouse up; `fails` (the released build) passes when the start dies with the keystore's raw error.
#
#   scripts/verify/setup-fixes.sh <out-dir> fix4 <crewhouse-linux-x64.tar.gz> missing|repairs|hands
#     installed and started, stopped; then the state folder group-writable, a stale pid file, and a corrupt database. `repairs` (the fix):
#     `crewhouse triage` answers the one question (y) in a real terminal, the damaged file is kept byte for byte, Crewhouse starts again
#     with Chief's folder unchanged, doctor says ready. `missing` (the released build): there is no triage, and moving the database
#     aside by hand makes start fail with "a bot folder already exists".
#     `hands`: one break at a time of what only the person can put right (a port another program holds, the sandbox's admin step, the
#     AI sign-ins folder gone, a full disk), `crewhouse triage` after each, then the thing put right and triage again: one `For you,` line
#     and its `Do this:`, and nothing left once it is done.
#
# Writes <out-dir>/setup-<fix>-<label>.txt (every command's words, stamped) and steps.json for done-done; exit 0 only when the run met its expectation.
set -uo pipefail
[ $# -ge 4 ] || { sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); FIX=$2; if [ -f "$3" ]; then TB=$(realpath "$3"); else TB=$3; fi; EXPECT=$4
{ [ "$FIX" = fix1 ] && { [ "$EXPECT" = dead ] || [ "$EXPECT" = alive ]; }; } || { [ "$FIX" = fix2 ] && { [ "$EXPECT" = ready ] || [ "$EXPECT" = honest ]; }; } || { [ "$FIX" = fix3 ] && { [ "$EXPECT" = fails ] || [ "$EXPECT" = works ]; }; } || { [ "$FIX" = fix4 ] && { [ "$EXPECT" = missing ] || [ "$EXPECT" = repairs ] || [ "$EXPECT" = hands ]; }; } || { echo "setup-fixes: usage: <out> fix1 <tarball> dead|alive [headless] | fix2 <tarball> ready|honest | fix3 <crewhouse-X.tgz | npm spec> fails|works | fix4 <tarball> missing|repairs|hands" >&2; exit 2; }
SCR=${SETUP_FIXES_SCRATCH:-$HOME/.cache/fm-scratch/setup-fixes}; mkdir -p "$SCR"
IMG=${UBUNTU_IMG:-$SCR/noble.img}
[ -f "$IMG" ] || curl -fsSL -o "$IMG" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img || { echo "setup-fixes: cannot fetch the Ubuntu 24.04 image" >&2; exit 1; }
[ -w /dev/kvm ] || { echo "setup-fixes: needs /dev/kvm" >&2; exit 1; }
W=$(mktemp -d -p "$SCR" run.XXXXXX); NAME=setup-fixes-$$; PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
QI=${QEMU_IMAGE:-byk-cloud-qemu:1}
trap 'docker rm -f "$NAME" >/dev/null 2>&1; rm -rf -- "$W"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "$W/key"; PUB=$(cat "$W/key.pub")
mkdir -p "$W/seed"
printf '#cloud-config\nusers:\n  - name: ops\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\n  - name: brk\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\nssh_pwauth: false\nmanage_etc_hosts: true\n' "$PUB" "$PUB" > "$W/seed/user-data"
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

L=$(tr -dc a-z < /dev/urandom | head -c 5); ACC=u$L; LABEL=$(basename "$TB" .tar.gz); [ "$FIX" != fix3 ] || LABEL=$(basename "$TB" .tgz | tr '@/' '--'); MODE=${5:-install}
T="$OUT/setup-$FIX-$LABEL${5:+-$5}-$EXPECT.txt"
{
  echo "== fresh machine: $(vm ops 'lsb_release -ds; uname -r; systemctl --version | head -1' | tr '\n' ' ')"
  vm ops "sudo useradd -m -s /bin/bash $ACC && sudo install -d -m 700 -o $ACC -g $ACC /home/$ACC/.ssh && sudo cp /home/brk/.ssh/authorized_keys /home/$ACC/.ssh/ && sudo chown $ACC:$ACC /home/$ACC/.ssh/authorized_keys"
  [ "$FIX" = fix3 ] || scp "${SCPO[@]}" "$TB" "ops@127.0.0.1:/var/tmp/crewhouse.tar.gz" && [ "$FIX" = fix3 ] || tar -xzOf "$TB" crewhouse/app/install.sh | vm ops 'cat > /var/tmp/install.sh; chmod 644 /var/tmp/install.sh /var/tmp/crewhouse.tar.gz'
  probe() { vm ops "echo \"port 7711 answers \$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 127.0.0.1:7711)\"; echo \"linger: \$(loginctl show-user $ACC -P Linger 2>&1 | head -1)\"; echo \"sessions of $ACC: \$(loginctl list-sessions --no-legend | awk '\$3==\"$ACC\"' | wc -l)\""; }
    if [ "$FIX" = fix4 ]; then
    S='$HOME/.local/state/crewhouse'
    echo "== the install line from $LABEL (its output is not a terminal, so it only installs), then the first start, then stop (login $ACC, no sudo)"
    vm ops "sudo loginctl enable-linger $ACC  # lab only, so Crewhouse outlives the separate logins below"
    term $ACC 600 "CREWHOUSE_TARBALL=/var/tmp/crewhouse.tar.gz sh /var/tmp/install.sh | cat; ~/.local/bin/crewhouse start < /dev/null | cat; ~/.local/bin/crewhouse stop"
    run() { vm $ACC "export PATH=\$HOME/.local/bin:\$PATH; S=$S; $1"; }
    tri() { vm $ACC "export PATH=\$HOME/.local/bin:\$PATH; crewhouse triage > /var/tmp/tri 2>&1; c=\$?; cat /var/tmp/tri; echo triage-exit=\$c"; }
    if [ "$EXPECT" != hands ]; then
    run 'sha256sum ~/Crewhouse/bots/chief/soul.md | cut -d" " -f1 > /var/tmp/soul.sha; rm -f $S/crew.db-wal $S/crew.db-shm; head -c 65536 /dev/urandom > $S/crew.db; sha256sum $S/crew.db | cut -d" " -f1 > /var/tmp/junk.sha; chmod 775 ~/.local/state; echo 99999 > $S/crewd.pid; echo "broken: database is random bytes, ~/.local/state mode $(stat -c %a ~/.local/state), crewd.pid names pid 99999"'
    fi
    if [ "$EXPECT" = hands ]; then
      run 'cat $S/person.key > /var/tmp/key.txt; echo "the key is $(wc -c < /var/tmp/key.txt) bytes, kept for the check that no output prints it"'
      echo "-- hands: a port another program holds"
      run 'python3 -m http.server 7711 --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > /var/tmp/held; sleep 2'; tri
      run 'kill $(cat /var/tmp/held); sleep 1'
      echo "-- hands: the port free again"; tri
      echo "-- hands: the helpers' shell, before its admin step"
      tri
      echo "-- the admin step (run by the admin login here; triage handed over the one line)"
      vm ops 'sudo DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap apparmor-profiles >/dev/null 2>&1; [ -f /etc/apparmor.d/bwrap-userns-restrict ] || sudo install -m 644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict; sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict 2>&1 | tail -1'
      echo "-- hands: after the admin step"; tri
      echo "-- hands: the AI sign-ins folder gone"
      run 'mv $S/openclaw /var/tmp/openclaw.keep; ls -d $S/openclaw 2>&1 | tail -1'; tri
      echo "-- the line triage names: start builds a new one (nothing paid is signed in again here)"
      term $ACC 300 'export PATH=$HOME/.local/bin:$PATH; crewhouse start < /dev/null; echo start-exit=$?'
      run 'crewhouse start < /dev/null >/dev/null 2>&1; true'; echo "-- hands: after start built a new folder"; tri
      run 'crewhouse stop | tail -1'
      echo "-- hands: a full disk (a real 8 MB filesystem where the state would live)"
      vm ops "sudo install -d -o $ACC -g $ACC -m 700 /var/tmp/tiny && sudo mount -t tmpfs -o size=8M tmpfs /var/tmp/tiny && df -h /var/tmp/tiny | tail -1"
      vm $ACC 'export PATH=$HOME/.local/bin:$PATH; CREWHOUSE_STATE_DIR=/var/tmp/tiny crewhouse triage > /var/tmp/tri 2>&1; c=$?; cat /var/tmp/tri; echo triage-exit=$c'
      vm ops 'sudo umount /var/tmp/tiny && sudo rmdir /var/tmp/tiny'
      echo "-- hands: all four put right"
      tri
    elif [ "$EXPECT" = repairs ]; then
      echo "-- triage, answering y in a real terminal"
      term $ACC 120 'export PATH=$HOME/.local/bin:$PATH; crewhouse triage; echo triage-exit=$?' 'y/N=>y'
      echo "-- what is left"
      run 'ls $S | grep -E "^crew\.db|^crewd\.pid"; kept=$(ls $S/crew.db.damaged-* | head -1); echo "kept file identical to the damaged one: $([ "$(sha256sum $kept | cut -d" " -f1)" = "$(cat /var/tmp/junk.sha)" ] && echo yes || echo NO)"; echo "state folder mode now $(stat -c %a ~/.local/state)"'
      echo "-- start again"
      term $ACC 300 'export PATH=$HOME/.local/bin:$PATH; crewhouse start < /dev/null; echo start-exit=$?'
      run 'echo "Chief folder unchanged: $([ "$(sha256sum ~/Crewhouse/bots/chief/soul.md | cut -d" " -f1)" = "$(cat /var/tmp/soul.sha)" ] && echo yes || echo NO)"; echo "port 7711 answers $(curl -s -o /dev/null -w %{http_code} --max-time 5 127.0.0.1:7711)"'
      doc() { vm $ACC 'export PATH=$HOME/.local/bin:$PATH; crewhouse doctor 2>&1 | grep -E "^✗|Crewhouse is ready"'; }; echo "-- doctor"; doc
    else
      echo "-- triage on the released build"
      run 'crewhouse triage 2>&1 | tail -2; echo triage-exit=${PIPESTATUS[0]}'
      echo "-- moving the database aside by hand, the way the research tried"
      run 'mv $S/crew.db $S/crew.db.bad; crewhouse start < /dev/null 2>&1 | grep -v "^ *$" | tail -3; echo start-exit=${PIPESTATUS[0]}'
    fi
  elif [ "$FIX" = fix3 ]; then
    PKG=$TB; [ ! -f "$TB" ] || { scp "${SCPO[@]}" "$TB" ops@127.0.0.1:/var/tmp/crewhouse.tgz; vm ops 'chmod 644 /var/tmp/crewhouse.tgz'; PKG=/var/tmp/crewhouse.tgz; }
    # A stock Ubuntu login has no Node: the person installs Node 24 with nvm, then npm.
    npm_door() { term "$1" 900 "curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash >/dev/null 2>&1; . ~/.nvm/nvm.sh; nvm install 24 >/dev/null 2>&1; node --version; npm install -g $PKG --no-audit --no-fund 2>&1 | tail -2; crewhouse start < /dev/null; echo start-exit=\$?"; }
    echo "-- A default login: Node 24 with nvm, npm install -g $PKG, crewhouse start (login $ACC, no sudo, umask $(vm $ACC umask))"
    npm_door $ACC
    echo "port 7711 answers $(vm ops "curl -s -o /dev/null -w '%{http_code}' --max-time 5 127.0.0.1:7711")"
    if [ "$EXPECT" = works ]; then
      vm $ACC '. ~/.nvm/nvm.sh >/dev/null; crewhouse stop' | tail -1
      B=${ACC}b
      vm ops "sudo useradd -m -s /bin/bash $B && sudo install -d -m 700 -o $B -g $B /home/$B/.ssh && sudo cp /home/brk/.ssh/authorized_keys /home/$B/.ssh/ && sudo chown $B:$B /home/$B/.ssh/authorized_keys && sudo install -d -o $B -g $B -m 755 /home/$B/.local && sudo install -d -o root -g root -m 755 /home/$B/.local/state && sudo install -d -o $B -g $B -m 755 /home/$B/.local/state/crewhouse"
      echo "-- B a state folder that is someone else's (~/.local/state belongs to root; login $B, no sudo)"
      npm_door $B
      echo "-- B again, after the folder is handed back with the line above (run here by the admin: sudo chown $B ~/.local/state && chmod go-w ~/.local/state)"
      vm ops "sudo chown $B /home/$B/.local/state && sudo chmod go-w /home/$B/.local/state"
      term $B 900 '. ~/.nvm/nvm.sh; crewhouse start < /dev/null; echo start-exit=$?'
      echo "port 7711 answers $(vm ops "curl -s -o /dev/null -w '%{http_code}' --max-time 5 127.0.0.1:7711")"
    fi
  elif [ "$FIX" = fix2 ]; then
    S='$HOME/.local/state/crewhouse'; R='$HOME/.local/share/crewhouse/release'
    echo "== the install line from $LABEL (its output is not a terminal, so it only installs), then the first start (login $ACC, no sudo)"
    vm ops "sudo loginctl enable-linger $ACC  # lab only, so Crewhouse outlives the separate logins below; the fix under test is not this"
    term $ACC 600 "CREWHOUSE_TARBALL=/var/tmp/crewhouse.tar.gz sh /var/tmp/install.sh | cat; ~/.local/bin/crewhouse start < /dev/null | cat"
    doc() { echo "-- $1"; vm $ACC 'export PATH=$HOME/.local/bin:$PATH; crewhouse doctor > /var/tmp/doctor.$$ 2>&1; c=$?; { grep -A1 "^✗" /var/tmp/doctor.$$; grep -E "Crewhouse is ready|stop Crewhouse|Error|^ +at " /var/tmp/doctor.$$; } | cut -c1-230; echo "doctor-exit=$c"; rm -f /var/tmp/doctor.$$'; }
    run() { vm $ACC "export PATH=\$HOME/.local/bin:\$PATH; S=$S R=$R; $1"; }
    doc "healthy, Crewhouse running"
    run 'crewhouse stop | tail -1'; doc "healthy, Crewhouse stopped"
    run 'python3 -m http.server 7711 --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > /var/tmp/held; sleep 1'; doc "port 7711 held by another program"; run 'kill $(cat /var/tmp/held); sleep 1'
    run 'cp -a $S/crew.db /var/tmp/crew.db.keep; rm -f $S/crew.db-wal $S/crew.db-shm; head -c 65536 /dev/urandom > $S/crew.db'; doc "database corrupted"; run 'cp -a /var/tmp/crew.db.keep $S/crew.db'
    run 'mv $R/app/node_modules $R/app/node_modules.aside'; doc "app files gone (node_modules)"; run 'mv $R/app/node_modules.aside $R/app/node_modules'
    run 'mv $S/openclaw $S/openclaw.aside'; doc "AI engine folder gone"; run 'mv $S/openclaw.aside $S/openclaw'
    vm ops 'sudo iptables -I OUTPUT -p tcp --dport 443 -j REJECT; sudo iptables -I OUTPUT -p udp --dport 53 -j REJECT'; doc "no internet"
    vm ops 'sudo iptables -D OUTPUT -p tcp --dport 443 -j REJECT; sudo iptables -D OUTPUT -p udp --dport 53 -j REJECT'
    doc "healthy again"
  else
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
  fi
} 2>&1 | tee "$T"
part() { sed -n "/^-- $1/,/^-- \|^setup-fixes/p" "$T"; }
if [ "$FIX" = fix4 ]; then
  if [ "$EXPECT" = missing ]; then grep -q 'Unknown command: triage' "$T" && grep -q 'triage-exit=2' "$T" && grep -q 'a bot folder already exists at' "$T"; ok=$?
  elif [ "$EXPECT" = hands ]; then
    ok=0; hands() { part "hands: $1"; }
    # Each break: its own `For you,` line and the `Do this:` beside it; then, once that thing is put right, the line is gone.
    for c in 'a port another program holds|For you, Port 7711: Another program is already using port 7711' "the helpers' shell, before its admin step|For you, the helpers' shell: " 'the AI sign-ins folder gone|For you, AI sign-in: /home/.*openclaw is gone, and the AI sign-ins that were in it' 'a full disk|For you, disk space: the disk holding /var/tmp/tiny has '; do
      hands "${c%%|*}" | grep -q -- "${c#*|}" && hands "${c%%|*}" | grep -q 'Do this:' || ok=1
    done
    hands 'the port free again' | grep -q 'For you, Port' && ok=1
    hands 'after the admin step' | grep -q -- "For you, the helpers' shell" && ok=1
    hands 'after start built a new folder' | grep -q 'For you, AI sign-in' && ok=1
    hands 'all four put right' | grep -q 'triage-exit=0' && ! hands 'all four put right' | grep -q 'For you,' || ok=1
    ! grep -qF "$(vm $ACC cat /var/tmp/key.txt)" "$T" || ok=1
    ! grep -Eq '^ +at .+[:(]|Node\.js v[0-9]' "$T" || ok=1
  else
    grep -q 'Needs a yes\|Move it aside and start with a new one' "$T" && grep -q 'triage-exit=0' "$T" && grep -q 'kept file identical to the damaged one: yes' "$T" && grep -q 'Chief folder unchanged: yes' "$T" \
      && grep -q 'Fixed: Only you can write to' "$T" && grep -q 'Fixed: removed the leftover record' "$T" && grep -q 'Fixed: moved the damaged database aside' "$T" && grep -q '^port 7711 answers 200' "$T" \
      && [ "$(part doctor | grep -c 'Crewhouse is ready')" = 1 ] && ! grep -q '^✗' "$T"; ok=$?
  fi
elif [ "$FIX" = fix3 ]; then
  if [ "$EXPECT" = fails ]; then part "A default login" | grep -q 'KeystoreError' && part "A default login" | grep -q 'start-exit=1'; ok=$?
  else
    part "A default login" | grep -q 'Crewhouse is running at' && part "A default login" | grep -q 'start-exit=0' && ! grep -q 'KeystoreError\|at file://' "$T" \
      && part "B a state folder" | grep -q 'The AI engine could not be installed: The folder your sign-ins would be kept in is not private to you' && part "B a state folder" | grep -q 'Next: sudo chown' \
      && [ "$(grep -o 'start-exit=[0-9]*' "$T" | tr '\n' ' ')" = 'start-exit=0 start-exit=1 start-exit=0 ' ] && [ "$(grep -c '^port 7711 answers 200' "$T")" = 2 ]; ok=$?
  fi
elif [ "$FIX" = fix2 ]; then
  ok=0
  for c in "healthy, Crewhouse running" "healthy, Crewhouse stopped" "healthy again"; do part "$c" | grep -q 'Crewhouse is ready' && part "$c" | grep -q 'doctor-exit=0' || ok=1; done
  for c in "port 7711" "database corrupted" "app files gone" "AI engine folder gone" "no internet"; do
    if [ "$EXPECT" = honest ]; then part "$c" | grep -q '✗' && part "$c" | grep -q '    fix:' && part "$c" | grep -q 'doctor-exit=1' && ! part "$c" | grep -Eq 'Crewhouse is ready|^ +at |ERR_MODULE'; else
      { [ "$c" = "app files gone" ] && part "$c" | grep -q 'ERR_MODULE_NOT_FOUND'; } || { [ "$c" != "app files gone" ] && part "$c" | grep -q 'Crewhouse is ready'; }; fi || ok=1
  done
elif [ "$EXPECT" = alive ]; then
  [ "$(grep -c '^port 7711 answers 200' "$T")" = 3 ] && grep -q 'linger: yes' "$T" && grep -q 'Crewhouse keeps running after you log out' "$T"; ok=$?
else
  grep -A1 '^== 60 s after' "$T" | tail -1 | grep -q 'answers 000' && grep -q '^linger: no\|not logged in or lingering' "$T"; ok=$?
fi
node -e '
const [, out, label, fix, expect] = process.argv, fs = require("node:fs");
const plans = {
  fix1: { steps: ["Run the one-line install from " + label + " and press Enter at the question about starting Crewhouse at login", "Log out, wait 60 seconds, ask port 7711 from the admin account", "sudo reboot, wait for the machine, ask port 7711 again with nobody logged in"],
    result: expect === "alive" ? "Crewhouse answers 200 after logout and after a reboot" : "Crewhouse is gone 60 seconds after logout (the released build)" },
  fix4: expect === "hands" ? { steps: ["Install " + label + " and start it, then break one thing at a time: a port another program holds, the helpers\u0027 shell without its admin step, the AI sign-ins folder gone, and a full 8 MB filesystem where the state would live", "Run crewhouse triage after each break, then put that one thing right", "Run crewhouse triage again: its line is gone, and on the whole machine nothing is left for the person"],
    result: "each of the four things only the person can do is handed over as one line with its Do this, and each clears when it is done" } : { steps: ["Install " + label + ", start it, stop it, then break three things: a damaged database, ~/.local/state group-writable, a stale pid file", "Run crewhouse triage and answer y to the one question", "Start again: the old database file is kept whole, Chief\u0027s folder is as it was, doctor is ready"],
    result: expect === "repairs" ? "triage fixes its own folder and leftover file, asks before moving the database, keeps it whole, and Crewhouse starts again" : "the released build has no triage, and moving the database by hand makes start fail" },
  fix3: { steps: ["On a stock login with no Node: install Node 24 with nvm, npm install -g crewhouse, crewhouse start", "Make ~/.local/state belong to root and start again as another stock login", "Hand the folder back with the line Crewhouse printed and start again"],
    result: expect === "works" ? "A default Ubuntu login reaches a running Crewhouse with no hand steps; a folder that is someone else\u0027s gives plain words and one next line, and that line works" : "The released build dies with the keystore\u0027s raw KeystoreError and never starts" },
  fix2: { steps: ["Install " + label + " and start it, then run crewhouse doctor on the healthy machine", "Break one thing at a time: a port another program holds, a corrupt database, the app files gone, the engine folder gone, no internet", "Run crewhouse doctor after each break"],
    result: expect === "honest" ? "Doctor exits 1 with a cause and one fix line for each break, never ready, never a stack trace; the healthy machine is ready" : "Doctor calls each broken machine ready, and crashes on the missing app files (the released build)" } };
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: label }, start: "a fresh stock Ubuntu 24.04 cloud image, a default login without sudo, nothing of Crewhouse installed", ...plans[fix] }, null, 1));
' "$OUT" "$LABEL" "$FIX" "$EXPECT"
[ "$ok" = 0 ] && echo "setup-fixes: $FIX $EXPECT met" || { echo "setup-fixes: $FIX $EXPECT NOT met; see $T" >&2; exit 1; }
