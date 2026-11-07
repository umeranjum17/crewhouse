#!/usr/bin/env bash
# Verify journey `own-server`: a person's own headless server, reached from a second computer by the printed lines only
# (docs/verification/own-server.md). Two stock Ubuntu 24.04 cloud-image VMs (KVM, real sshd) on a private virtual LAN:
# `server` has the installed Crewhouse and no screen; `laptop` is the person's own computer, and does only what the server printed.
#
#   scripts/verify/own-server.sh <out-dir> <crewhouse-linux-x64.tar.gz> printed|released
#     printed  (this checkout's download): `crewhouse start` and `open` print the ssh line with explicit 127.0.0.1 binds and
#              ExitOnForwardFailure=yes, the 17711 line and the line without 1455; `open --link` prints the link behind a warning;
#              the laptop follows each line as printed, clean, with its own program holding 7711, and holding 1455, and reaches the app.
#     released (the build before): `start` and `open` only say "Open http://127.0.0.1:7711/ in your browser." and print no line.
#   UBUNTU_IMG=<noble-server-cloudimg-amd64.img>   default: downloaded once into $OWN_SERVER_SCRATCH
#   QEMU_IMAGE=<docker image with qemu-system-x86 and genisoimage>   default byk-cloud-qemu:1
#
# Writes <out-dir>/own-server-<mode>.txt (every command's words; the private key never appears) and steps.json for done-done;
# exit 0 only when the run met its expectation.
set -uo pipefail
[ $# -eq 3 ] && { [ "$3" = printed ] || [ "$3" = released ]; } || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
OUT=$(mkdir -p "$1" && cd "$1" && pwd -P); TB=$(realpath "$2"); MODE=$3
SCR=${OWN_SERVER_SCRATCH:-$HOME/.cache/fm-scratch/own-server}; mkdir -p "$SCR"
IMG=${UBUNTU_IMG:-$SCR/noble.img}
[ -f "$IMG" ] || curl -fsSL -o "$IMG" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img || { echo "own-server: cannot fetch the Ubuntu 24.04 image" >&2; exit 1; }
[ -w /dev/kvm ] || { echo "own-server: needs /dev/kvm" >&2; exit 1; }
QI=${QEMU_IMAGE:-byk-cloud-qemu:1}; W=$(mktemp -d -p "$SCR" run.XXXXXX); ID=$$
free() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }
SP=$(free); LP=$(free); LAN=$(free)
trap 'docker rm -f own-server-$ID-server own-server-$ID-laptop >/dev/null 2>&1; rm -rf -- "$W"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "$W/key"; PUB=$(cat "$W/key.pub"); U=$(id -u):$(id -g)
for n in 1 2; do
  who=$([ $n = 1 ] && echo server || echo laptop); mkdir -p "$W/$who"
  printf '#cloud-config\nusers:\n  - name: ops\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\n  - name: me\n    shell: /bin/bash\n    ssh_authorized_keys: ["%s"]\nssh_pwauth: false\nmanage_etc_hosts: true\n' "$PUB" "$PUB" > "$W/$who/user-data"
  printf 'instance-id: os-%s-%s\nlocal-hostname: %s\n' "$ID" "$who" "$who" > "$W/$who/meta-data"
  # the virtual LAN is the second network card: a fixed address for each machine, as a home or office network gives
  printf 'version: 2\nethernets:\n  wan:\n    match: {macaddress: "52:54:00:12:34:0%s"}\n    dhcp4: true\n  lan:\n    match: {macaddress: "52:54:00:77:00:0%s"}\n    addresses: [192.168.77.%s/24]\n' $n $n $n > "$W/$who/network-config"
  docker run --rm --user "$U" -v "$W":/w -v "$IMG":/img/base.img:ro "$QI" sh -c "cd /w/$who && genisoimage -quiet -output seed.iso -volid cidata -joliet -rock user-data meta-data network-config && qemu-img create -q -f qcow2 -F qcow2 -b /img/base.img disk.qcow2 12G" || exit 1
done
boot() { # <who> <ssh port> <lan side>
  docker run -d --name "own-server-$ID-$1" --user "$U" --network host --device /dev/kvm -v "$W":/w -v "$IMG":/img/base.img:ro "$QI" \
    qemu-system-x86_64 -enable-kvm -cpu host -m 3072 -smp 2 -nographic -drive file=/w/$1/disk.qcow2,if=virtio -drive file=/w/$1/seed.iso,if=virtio,format=raw \
    -netdev "user,id=wan,hostfwd=tcp:127.0.0.1:$2-:22" -device "virtio-net-pci,netdev=wan,mac=52:54:00:12:34:0$([ $1 = server ] && echo 1 || echo 2)" \
    -netdev "socket,id=lan,$3=127.0.0.1:$LAN" -device "virtio-net-pci,netdev=lan,mac=52:54:00:77:00:0$([ $1 = server ] && echo 1 || echo 2)" >/dev/null
}
echo "own-server: booting two stock Ubuntu 24.04 machines (about a minute)"
boot server "$SP" listen || exit 1; sleep 2; boot laptop "$LP" connect || exit 1
SSHO=(-i "$W/key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)
SV() { local u=$1; shift; ssh "${SSHO[@]}" -p "$SP" "$u@127.0.0.1" "$@"; }   # the server, from outside
LP_() { local u=$1; shift; ssh "${SSHO[@]}" -p "$LP" "$u@127.0.0.1" "$@"; }  # the second machine, from outside
for who in SV LP_; do for _ in $(seq 60); do $who ops true 2>/dev/null && break; sleep 3; done; $who ops true || { echo "own-server: a VM never answered ssh" >&2; exit 1; }; done
for who in SV LP_; do $who ops 'cloud-init status --wait >/dev/null 2>&1; ip -4 -br a | grep -q 192.168.77' || { echo "own-server: the virtual LAN did not come up" >&2; exit 1; }; done
LP_ ops 'ping -c1 -W3 192.168.77.1 >/dev/null' || { echo "own-server: the laptop cannot reach the server" >&2; exit 1; }

T="$OUT/own-server-$MODE.txt"; : > "$T"; fail=0
say() { printf '%s\n' "$*" | tee -a "$T"; }
check() { if eval "$2"; then say "PASS: $1"; else say "FAIL: $1"; fail=1; fi; }
SESS() { LP_ me "ssh -o StrictHostKeyChecking=accept-new me@192.168.77.1 'export PATH=\$HOME/.local/bin:\$PATH; $1'"; }   # the person's own ssh session, from the laptop
{
  echo "== the machines: server $(SV ops 'lsb_release -ds; hostname' | tr '\n' ' '), laptop $(LP_ ops 'lsb_release -ds; hostname' | tr '\n' ' ') (virtual LAN 192.168.77.0/24)"
  scp -q "${SSHO[@]}" -P "$SP" "$TB" "ops@127.0.0.1:/var/tmp/crewhouse.tar.gz" && tar -xzOf "$TB" crewhouse/app/install.sh | SV ops 'cat > /var/tmp/install.sh; chmod 644 /var/tmp/install.sh /var/tmp/crewhouse.tar.gz'
  echo "== on the server, a stock login with no sudo installs and starts Crewhouse; the laptop will ssh in as it"
  SV me 'CREWHOUSE_TARBALL=/var/tmp/crewhouse.tar.gz sh /var/tmp/install.sh | cat' 2>&1 | tail -2
  scp -q "${SSHO[@]}" -P "$LP" "$W/key" "me@127.0.0.1:.ssh/id_ed25519"
} 2>&1 | tee -a "$T"
KEY=
red() { if [ -n "$KEY" ]; then sed "s/$KEY/<KEY>/g"; else cat; fi; }
OUTSTART=$(SESS 'crewhouse start' 2>&1); KEY=$(SV me 'cat ~/.local/state/crewhouse/person.key')
{ echo "== the laptop ssh-es into the server (192.168.77.1) and types crewhouse start"; printf '%s\n' "$OUTSTART" | grep -v -E '^[ ]*[█▀▄ ]+$' | sed 's/\(airing code: \).*/\1<pairing-code>/' | red; } | tee -a "$T"
OPEN=$(SESS 'crewhouse open' 2>&1)
{ echo "== crewhouse open"; printf '%s\n' "$OPEN" | red; } | tee -a "$T"
LINK=$(SESS 'crewhouse open --link' 2>"$W/link.err"); { echo "== crewhouse open --link (warning on stderr, link on stdout)"; red < "$W/link.err"; printf '%s\n' "$LINK" | red; } | tee -a "$T"
if [ "$MODE" = released ]; then
  check "the released build only says to open a browser on a computer that has none" 'printf "%s\n%s" "$OUTSTART" "$OPEN" | grep -q "in your browser" && ! printf "%s" "$OPEN" | grep -q "ssh -N"'
  check "the released build prints no ExitOnForwardFailure line" '! printf "%s\n%s" "$OUTSTART" "$OPEN" | grep -q ExitOnForwardFailure'
else
  check "start printed the ssh line with explicit 127.0.0.1 binds and ExitOnForwardFailure=yes" 'printf "%s" "$OUTSTART" | grep -q "ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:7711:127.0.0.1:7711 -L 127.0.0.1:1455:127.0.0.1:1455 me@192.168.77.1"'
  check "open printed it too, and neither printed the private key" 'printf "%s" "$OPEN" | grep -q ExitOnForwardFailure && ! printf "%s\n%s" "$OUTSTART" "$OPEN" | grep -qF "$KEY"'
  check "open --link: the warning, then the link, marked as coming in over SSH" 'grep -q "Keep this link private" "$W/link.err" && [ "$LINK" = "http://127.0.0.1:7711/#person=$KEY&remote=1" ]'
  PRINTED=$(printf '%s\n' "$OPEN" | grep -E '^   ssh -N' | sed 's/^ *//'); LINE1=$(sed -n 1p <<<"$PRINTED"); LINE2=$(sed -n 2p <<<"$PRINTED"); LINE3=$(sed -n 3p <<<"$PRINTED")
  tunnel() { LP_ me "timeout 25 $1 >/dev/null 2>&1 &"; sleep 4; }     # the printed line as it stands; it ends by itself
  hold() { LP_ me "timeout 22 python3 -m http.server $1 --bind 127.0.0.1 >/dev/null 2>&1 &"; sleep 1; }   # the laptop's own program on a port
  code() { LP_ me "curl -s -m 5 -o /dev/null -w '%{http_code}' $2 http://127.0.0.1:$1/$3"; }
  chief() { LP_ me "curl -s -m 5 -H 'x-crewhouse: 1' -H 'authorization: Bearer $KEY' http://127.0.0.1:$1/api/state | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\"bots:\", \", \".join(b[\"id\"] for b in d[\"bots\"]), \"| version\", d[\"version\"])'"; }
  {
    echo "== A. the laptop follows the first printed line"; tunnel "$LINE1"
    echo "GET / -> $(code 7711 '' '')"; echo "GET /api/state without the key -> $(code 7711 '' api/state)"
    echo "through the link's key: $(chief 7711)"
    sleep 22
    echo "== B. the laptop's own program holds 7711"; hold 7711
    echo "-- the first printed line:"; LP_ me "timeout 10 $LINE1; echo ssh-exit=\$?" 2>&1 | tail -3 | tee "$W/b"
    echo "-- the printed 17711 line:"; tunnel "$LINE2"; echo "through the link's key, port 17711: $(chief 17711)"
    sleep 22
    echo "== C. the laptop's own program holds 1455"; hold 1455
    echo "-- the first printed line:"; LP_ me "timeout 10 $LINE1; echo ssh-exit=\$?" 2>&1 | tail -3 | tee "$W/c"
    echo "-- the printed line without 1455:"; tunnel "$LINE3"; echo "through the link's key, port 7711: $(chief 7711)"
    sleep 22
  } 2>&1 | red | tee -a "$T"
  check "the first line reaches Chief's app on a clean laptop" 'grep -q "^through the link.s key: bots: .*chief" "$T" && grep -q "^GET /api/state without the key -> 403" "$T"'
  check "with 7711 held, the first line stops with ssh's own message, and the 17711 line reaches Chief" 'grep -q "Could not request local forwarding" "$W/b" && ! grep -q "ssh-exit=124" "$W/b" && grep -q "port 17711: bots: .*chief" "$T"'
  check "with 1455 held, the first line stops, and the line without 1455 reaches Chief" 'grep -q "Could not request local forwarding" "$W/c" && ! grep -q "ssh-exit=124" "$W/c" && grep -q "port 7711: bots: .*chief" "$T"'
  n=$(SV me "grep -rlF '$KEY' ~/.local/state/crewhouse/crewd.log ~/.local/share/crewhouse 2>/dev/null | grep -v person.key | wc -l"); say "server files holding the key besides person.key: $n"
  check "no server log or app file holds the key" '[ "$n" = 0 ]'
  check "this record holds no key" '! grep -qF "$KEY" "$T"'
fi
node -e '
const [, out, mode] = process.argv, fs = require("node:fs");
const printed = mode === "printed";
fs.writeFileSync(out + "/steps.json", JSON.stringify({ target: { version: mode }, start: "two stock Ubuntu 24.04 cloud-image VMs on a virtual LAN: a server with Crewhouse installed and no screen, and the person'"'"'s own computer",
  steps: ["Over ssh from the second computer, run crewhouse start and crewhouse open on the server", ...(printed ? ["Run crewhouse open --link on the server", "On the second computer, run the printed ssh line as it stands, then with its own 7711 taken the printed 17711 line, then with its own 1455 taken the printed line without 1455"] : [])],
  result: printed ? "The server prints the ssh line, the 17711 line and the line without 1455; each printed line the second computer follows reaches Chief, and a taken port stops ssh with its own message" : "The released build only says to open a browser on the server, and prints no ssh line" }, null, 1));
' "$OUT" "$MODE"
[ "$fail" = 0 ] && { echo "own-server: $MODE met"; } || { echo "own-server: $MODE NOT met; see $T" >&2; exit 1; }
