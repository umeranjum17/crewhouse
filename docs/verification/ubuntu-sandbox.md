# The helpers' sandbox on a stock Ubuntu

Ubuntu 23.10 and later refuse a normal login the namespaces bubblewrap (the helpers' shell) needs, until AppArmor has a
rule for `/usr/bin/bwrap` (`kernel.apparmor_restrict_unprivileged_userns = 1`). The rule is Ubuntu's own, in its
`apparmor-profiles` package: `/usr/share/apparmor/extra-profiles/bwrap-userns-restrict`, off until it is copied to
`/etc/apparmor.d/` and loaded.

One probe answers everywhere: `bin/sandbox.mjs` `sandbox()` is what crewd's `sandboxReady()` and `./crewhouse doctor` call,
as the person running them. When it fails it says why and names the one command. The same file installs the rule:

- the `.deb` (`scripts/package.mjs`) recommends `apparmor-profiles`, and its postinst runs `sandbox.mjs install` as root
  (copy, `apparmor_parser -r`; it never fails the install, and does nothing where the kernel switch is off);
- `crewhouse setup` (which `crewhouse start` runs first) runs `sandbox.mjs setup`: it asks `[Y/n]`, then runs the same
  steps with `sudo`; with no terminal it prints the command and installs nothing.

## Driving it

Needs `/dev/kvm`, Docker with a qemu image (`QEMU_IMAGE`), and a `.deb` from `node scripts/package.mjs <dist>`.

```bash
bash scripts/verify/ubuntu-sandbox.sh <out> <dist>/crewhouse_<version>_amd64.deb      # both modes, about 10 minutes
```

Each mode boots Ubuntu's own 24.04 cloud image (never modified; a copy-on-write overlay) and runs
`scripts/verify/ubuntu-sandbox-guest.sh` as root, which drives everything the person does as the stock `ubuntu` login.
`<out>/ubuntu-sandbox-deb.txt` and `ubuntu-sandbox-setup.txt` hold the console: kernel and AppArmor state, the old probe
command and its error, our probe and doctor before, the install, the rule loaded, the probe and doctor after, and crewd's
own sandboxed shell command. Exit 0 means each said what it should.

`test/sandbox.test.ts` covers the same journey without a VM: a fake `bwrap` that fails like the real one until the rule file
exists, `CREWHOUSE_APPARMOR_ROOT` moving the kernel switch and rule paths into a temp folder.

## What to check

- Before: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, and the kernel log shows `DENIED ... capname="net_admin"` for profile `unprivileged_userns`. doctor says `· no sandbox here` with the cause and one `fix:` line, the same text the probe prints.
- After: the probe passes, doctor says `✓ Bots' shell runs in a sandbox`, and crewd's shell runs a command as the person.
- A machine where the rule is not the cause says bubblewrap's own words, never an AppArmor claim.
