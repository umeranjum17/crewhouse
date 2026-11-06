#!/bin/bash
# Runs inside a stock Ubuntu 24.04 cloud image (scripts/verify/ubuntu-sandbox.sh boots it): the default `ubuntu` login, the
# image's own kernel and AppArmor, bubblewrap from Ubuntu's archive and nothing else. $1 is `deb` (install Crewhouse's .deb the
# way a person does) or `setup` (no .deb install; run `crewhouse setup` from the unpacked folder). Its transcript goes back to the host over HTTP.
mode=$1
# The transcript is a file that goes back to the host over HTTP: the serial console fails with EIO once its login prompt is up.
exec > /root/transcript.txt 2>&1
(while sleep 20; do curl -fsS -T /root/transcript.txt "http://10.0.2.2:8123/t/transcript.txt" > /dev/null 2>&1; done) &
send() { curl -fsS -T /root/transcript.txt "http://10.0.2.2:8123/t/transcript.txt" > /dev/null 2>&1; }
export DEBIAN_FRONTEND=noninteractive
until apt-get update -qq; do echo "apt-update-retry"; sleep 3; done
apt-get install -y -qq bubblewrap > /dev/null 2>&1
# Everything the person types runs in a fresh login shell of the stock account, as that account.
person() { echo "\$ $1"; su - ubuntu -c "$1" 2>&1; echo "[exit $?]"; }
step() { echo; echo "@@@ $*"; }
# Before the install, the .deb's files are read from an unpacked copy; after it, from where apt put them (deb) or still there (setup).
APP=/srv/crewhouse/opt/crewhouse/app; NODE=/srv/crewhouse/opt/crewhouse/node/bin/node
echo "@@@ START $mode"
. /etc/os-release; echo "os: $PRETTY_NAME   kernel: $(uname -r)   bubblewrap: $(bwrap --version)"
echo "login: $(su - ubuntu -c 'id')"
echo "lsm: $(cat /sys/kernel/security/lsm)"
echo "kernel.apparmor_restrict_unprivileged_userns = $(sysctl -n kernel.apparmor_restrict_unprivileged_userns)"
echo "apparmor-profiles installed: $(dpkg -s apparmor-profiles 2>&1 | head -1)"
echo "rule in /etc/apparmor.d: $(ls /etc/apparmor.d/bwrap-userns-restrict 2>&1)"
mkdir -p /srv/crewhouse /tmp/space; chown ubuntu /tmp/space
curl -fsS http://10.0.2.2:8123/crewhouse.deb -o /root/crewhouse.deb || { echo "no deb"; send; poweroff -f; }
dpkg-deb -x /root/crewhouse.deb /srv/crewhouse

step "1 BEFORE: the probe crewd ran until now (src/engine.ts on main), as the stock login"
person "bwrap --ro-bind / / --unshare-all true"
echo "kernel log:"; dmesg | grep -E 'apparmor="(DENIED|AUDIT)"' | grep bwrap | tail -3 | cut -c1-230
step "2 BEFORE: the same probe through Crewhouse's code, and doctor"
person "$NODE $APP/bin/sandbox.mjs probe"
person "cd $APP && $NODE src/doctor.ts 2>&1 | grep -A1 -E 'sandbox|Optional'"

if [ "$mode" = deb ]; then
  step "3 INSTALL: apt install ./crewhouse.deb (root, as the software centre would)"
  apt-get install -y /root/crewhouse.deb 2>&1 | grep -E "^(Get:[0-9]+ .*(crewhouse|apparmor-profiles)|Unpacking (crewhouse|apparmor-profiles)|Setting up (crewhouse|apparmor-profiles)|Crewhouse:)" | cut -c1-200
else
  # Ubuntu's needrestart would open a dialog after an apt install in a terminal and wait for a key; the lab answers it "automatically".
  mkdir -p /etc/needrestart/conf.d; echo "\$nrconf{restart} = 'a';" > /etc/needrestart/conf.d/lab.conf
  step "3 INSTALL: crewhouse setup, typed by the stock login in a terminal (answers y; the image's sudo needs no password)"
  person "cd $APP && printf 'y\nn\n' | timeout 300 script -qec 'bash crewhouse setup' /dev/null 2>&1 | sed -E 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/\r//g' | grep -v '^$'" | grep -v -E "^(Preparing|Selecting|Unpacking|Reading|Building|Get:|Fetched|\(Reading)" | cut -c1-220
fi

if [ "$mode" = deb ]; then APP=/opt/crewhouse/app; NODE=/opt/crewhouse/node/bin/node; fi
step "4 AFTER: the rule on disk and loaded"
ls -l /etc/apparmor.d/bwrap-userns-restrict; aa-status 2>/dev/null | grep -E "bwrap|unpriv_bwrap" | head -3
step "5 AFTER: the probe, as a fresh login of the stock account"
person "bwrap --ro-bind / / --unshare-all true"
person "$NODE $APP/bin/sandbox.mjs probe"
step "6 AFTER: doctor says what the probe says"
person "cd $APP && $NODE src/doctor.ts 2>&1 | grep -A1 -E 'sandbox|Optional'"
step "7 AFTER: crewd's own sandboxed shell command (src/engine.ts runSandboxed), as the stock login"
person "$NODE --input-type=module -e \"const { runSandboxed, sandboxReady } = await import('$APP/src/engine.ts'); console.log('sandboxReady', sandboxReady()); const r = await runSandboxed('/tmp/space', [], {}, 'id -un; echo hello > mine.txt; cat mine.txt; ls /home | wc -l; touch /usr/x 2>&1 | head -1'); console.log(JSON.stringify(r))\""
echo "@@@ END"
send; poweroff -f
