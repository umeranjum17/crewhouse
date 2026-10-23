# Install and run Crewhouse

The [README](../README.md#quick-start) has the quick start: the computer download first, the terminal path for developers after it. This page has everything after it: what `setup` asks, where Crewhouse keeps things, every command, the phone app, the installed web app and the desktop bar.

Crewhouse is self-hosted only. There is no hosted service and no account with us. Your personal assistant runs on your computer. You use it from a browser or the phone app.

## Download

GitHub's `/releases/latest` links don't apply yet: every release so far is a prerelease, which GitHub skips there.

- **Computer (Ubuntu or Debian, 64-bit):** [crewhouse_0.1.1_amd64.deb](https://github.com/umeranjum17/crewhouse/releases/download/linux-v0.1.1/crewhouse_0.1.1_amd64.deb) (about 200 MB). Open it and press **Install** in your software centre, then open **Crewhouse** from your app menu. It carries its own Node, the AI engine and the helpers' sandbox and screens, installs under `/opt/crewhouse`, and starts the crew by itself when you log in. A helper fetches its own tools (its web browser is the big one, about 170 MB) the first time it needs them. From a checkout, `npm run build:web && node scripts/package.mjs` builds the same `.deb` and a portable **`crewhouse-<version>-linux-x64.tar.gz`** (any 64-bit Linux: extract it and run `crewhouse/node/bin/node crewhouse/launch.mjs`). Both carry the AI engine already installed, so neither spends minutes on a "Getting your crew ready" screen the first time. Pushing a `linux-v<version>` tag publishes both downloads (`.github/workflows/release-linux.yml`); a `cloud-v<version>` tag publishes the tarball alone under a stable name for headless hosts (`.github/workflows/release-cloud-linux.yml`).
- **Phone app (Android, preview):** v1.0.0-preview.20261022.23. Debug-signed preview; updates the previous preview in place. Pair it under Settings, Phones on the computer (see [TRY-IT.md](../TRY-IT.md#3-the-phone-app)).
  - [CREWHOUSE-APK-1.0.0-preview.20261022.23-arm64-v8a.apk](https://github.com/umeranjum17/crewhouse/releases/download/v1.0.0-preview.20261022.23/CREWHOUSE-APK-1.0.0-preview.20261022.23-arm64-v8a.apk) (arm64-v8a, 58008780 bytes, SHA-256 `2ab551e9705dde39018110d03746b698c1c0893f0c7348efe2d9789ba52967ce`)
  - [CREWHOUSE-APK-1.0.0-preview.20261022.23-armeabi-v7a.apk](https://github.com/umeranjum17/crewhouse/releases/download/v1.0.0-preview.20261022.23/CREWHOUSE-APK-1.0.0-preview.20261022.23-armeabi-v7a.apk) (armeabi-v7a, 46719214 bytes, SHA-256 `0daf9c294562f471f5cd27a73adde46f1f5ae963d6c8395e80d00536b885ab3a`)
  - [CREWHOUSE-APK-1.0.0-preview.20261022.23-x86_64.apk](https://github.com/umeranjum17/crewhouse/releases/download/v1.0.0-preview.20261022.23/CREWHOUSE-APK-1.0.0-preview.20261022.23-x86_64.apk) (x86_64, 60796773 bytes, SHA-256 `98bad5dc43f1d7c04deae5174896a40052f06f7a4f8eeb13ea1f083499619dec`)

The link above names the current preview; for anything newer, check the [releases page](https://github.com/umeranjum17/crewhouse/releases).

## From source

You need **Linux** and **[Node.js](https://nodejs.org) 22.22.3 or later**. Nothing else: the AI engine ships inside Crewhouse, and you sign in from the app.

```bash
git clone https://github.com/umeranjum17/crewhouse && cd crewhouse
./crewhouse setup     # installs dependencies and the engine, builds the web app, checks the machine
./crewhouse start     # starts Crewhouse and opens it in your browser
```

A helper fetches its own tools the first time it needs them, so `setup` installs nothing beyond the engine. `./crewhouse start` opens your browser at the app itself, so no second terminal is needed; later, **`./crewhouse open`** reopens it (or use the installed app menu). The launcher hands your browser a private capability from your install, so a helper cannot approve its own work over local HTTP. The public address alone is read-only; paired phones and a paired installed web app use their authenticated encrypted link (an iPad or phone installs the web app from its own https address: [The installed web app](#the-installed-web-app)). Chief greets you and offers three things to take off your plate. Tap one, then **Sign in with…** under his reply, and the crew starts work.

When run in a terminal, `setup` asks one thing:

- Whether Crewhouse should start by itself when you log in (a systemd user service). You can change this later with `./crewhouse autostart on|off`.

`./crewhouse doctor` shows what's installed and what's missing; `./crewhouse tools` has the details for each tool. The helpers' sandboxed shell needs [bubblewrap](https://github.com/containers/bubblewrap), and their own screens need Xvfb and Chromium. Crewhouse is built and tested on Linux. On macOS, helpers get no shell or screens, and autostart isn't available.

Everything Crewhouse writes lives in `~/.local/state/crewhouse/` (the database, the engine and saved sign-ins), `~/Crewhouse/` (helpers and what they know about each person) and `~/.local/share/crewhouse/tools/` (the tool kit). `./crewhouse uninstall` removes all of it, but keeps your crew folder unless you add `--all`.

## Headless Linux host

A cloud computer in **your own account** can run Chief without a desktop or browser. Sign the computer and phone into your Tailscale network first. Download and extract the portable Linux tarball from the [releases page](https://github.com/umeranjum17/crewhouse/releases), then run:

```bash
cd crewhouse/app
./crewhouse setup --headless
```

The download includes its pinned Node, AI engine, web app and private relay; no git clone is needed. Setup starts `crewhouse-headless.service` and prints a private, single-use first-phone code and terminal QR, valid for two minutes. In the phone app choose **Pair with a computer**, then paste the code or scan the QR. This first phone becomes the owner without waiting for a confirmation on the computer. Its encrypted grant can manage the accounts and settings normally reserved for the computer. Other phones still require the owner's confirmation. Revoking the first phone does not reopen first-owner setup.

The service keeps running without the setup terminal. Root installs use a system unit; other installs use a user unit (enable lingering if it must survive logout). Run under the account intended to own the install. The API stays on loopback with its private capability; by default the phone link and relay listen only on loopback/Tailscale, never the public interface. The relay enrols only this host, with public signup disabled. Both devices must be on the same tailnet; there is no relay hosted by us.

For an installer that owns its systemd unit, use `./crewhouse setup --headless --install-only`, run the bundled Node on `scripts/headless.mjs serve` in `crewhouse/app`, then run `./crewhouse headless pair` from the host terminal. Keep pairing output out of installer logs. `./crewhouse headless health` exits zero only when the authenticated API, phone route and private relay are ready. If an unused code expires, `headless pair` prints a new one; once a phone has joined, it refuses. Stop or disable `crewhouse-headless.service` with the matching system or user `systemctl` before removing this headless install.

For an operator-managed container behind a published tailnet port, set `CREWHOUSE_RELAY_PUBLIC=http://<tailnet-ip>:<published-relay-port>` consistently on setup and the service. This relay-only mode skips all Tailscale discovery and peer checks and keeps the API private. The relay binds all **container** interfaces; publish only that port on the tailnet interface, never on the public internet. The published address must be a tailnet, private-LAN or loopback IPv4 origin. An operator can publish on a private LAN for phones on the same Wi-Fi; that does not prove remote tailnet reach. Port publication and the tailnet identity belong to the operator, not Crewhouse.

Sign-in uses BYOKit's existing account wizard on the host; an AI key never moves to the phone. Browser-only account redirects still return to the host, so choose a supported device-code/key route on a machine without a browser.

## Commands

| Command | What it does |
|---|---|
| `./crewhouse setup --headless [--install-only]` | Prepares a headless host and, unless install-only, starts its service and prints the first-phone code |
| `./crewhouse headless serve\|pair\|health` | Runs the headless host, prints a fresh unused first-phone code, or checks readiness |
| `./crewhouse update` | Pulls, installs and restarts Crewhouse. Running work carries on. It refuses if the folder has local changes. |
| `./crewhouse doctor` | Shows what's installed and what's missing |
| `./crewhouse open` | Reopens Crewhouse in your browser |
| `./crewhouse tools [install [ids...]]` | Lists or installs the helpers' tool kit |
| `./crewhouse autostart on\|off` | Turns starting at login on or off |
| `./crewhouse phones code \| pending \| approve '<two words>'` | Pairs a phone or the installed web app from the terminal; `code` also prints a relay code to use away from home |
| `./crewhouse phones web [off]` | Serves the installed web app at this computer's Tailscale https address and prints it |
| `./crewhouse uninstall [--all] [--yes]` | Removes what Crewhouse installed |

## How sign-ins are stored

Engine sign-ins use BYOKit's sealing: the stopped engine keeps `auth-store.sealed`, and the next start restores the same login. Verified legacy copies and migration archives leave no plaintext credential copy. Crewhouse opts into the kit's dual wrapping: when available, the non-interactive OS keyring and an owner-only host key both wrap the saved sign-in, so later locked starts still work without prompting. A new install without keyring access uses the host key. An older keyring-only store needs one unlocked start to upgrade; until then the app asks you to unlock your password storage and try again. There is no plaintext fallback and no `CREWHOUSE_AUTH_KEY_FILE` requirement.

On Linux the kit's host key lives at `$XDG_STATE_HOME/byokit-<SHA-256 of crewhouse-engine>/host-key/` (the state root defaults to `~/.local/state`), beside the default `crewhouse/` state directory. Exclude that key directory from sealed-store backups; keep it separately for restores. Crewhouse does not copy or export it. Stop all writers before any kit-managed rotation; never edit key files yourself. Losing the original key or OS keyring makes the sealed store unrecoverable; an older build cannot open it. If `auth-store.sealed` cannot be read, the engine fails closed: it stays stopped, the file is left untouched, and the app shows the kit's recovery words.

App connections use the pinned BYOKit connection kit and its documented sealed-store adapter, with the same dual wrapping under the separate `crewhouse-connect` service. The person's `app-signins/` folder holds ciphertext, including the setup key and refreshed grants. Keep this service's host key separate from ciphertext backups too. Old app sign-ins and setup keys are not imported; reconnect apps after upgrading.

Credentials remain plaintext while the engine or migration doctor runs. Orderly shutdown waits for sealing; a crash is recovered on the next prepare once the old engine has stopped. Use encrypted storage and exclude live engine state from backups. This does not protect against another process running as the same OS user.

## Upgrading a shared install

Existing shared installs must first update through the one-person migration release (P1, `bc37c20`) before installing this build; otherwise startup refuses without changing their live data. That release upgrades to the person who set them up (person 1). Before changing live data, the P1 release saves the full database as `crew-before-one-person.db` in its state folder. Other people's jobs, messages and phones leave the live install; their files and sign-ins stay untouched on disk. Your sign-ins, connections, memory, phones and settings keep working. Watch baselines for removed routines are kept with a `.before-one-person` suffix so a new routine starts fresh. Downgrading to a build before this migration is unsupported: an older build could reuse a former person's id and files.

## The phone app

The phone app (Android) is in preview. Debug-signed APKs are on the [releases page](https://github.com/umeranjum17/crewhouse/releases). Pair it under Settings, Phones on the computer ([TRY-IT.md](../TRY-IT.md#3-the-phone-app)), or ask Chief to add your phone. Every paired phone uses your crew; you can also add one that only watches. Quiet hours hold notifications across a restart and send one when they end. To reach the computer away from home, use Tailscale or [run your own relay](../relay/README.md). There's no built-in one.

The app pairs with the computer by QR code or a typed code, over the home Wi-Fi, over Tailscale, or through a relay you run yourself. Its notifications only ever say "Crewhouse has news". The words themselves come over the encrypted link.

Keep the phone app up to date alongside the computer. An older preview shows “Get the latest Crewhouse app to keep chatting.” Open Chief’s chat and tap the sentence to download the current preview.

## The installed web app

An iPad or phone can install Crewhouse's web app and use your crew from its Home Screen. The app pairs only on an https page (the browser seals its key with crypto that plain http doesn't offer), so it is served at this computer's own [Tailscale](https://tailscale.com/download) name, with a real certificate:

1. Install Tailscale on this computer and on the iPad or phone, signed in to the same tailnet, with HTTPS certificates turned on for it (Tailscale's admin console, DNS).
2. On the computer, run `./crewhouse phones web`. It prints the address, `https://<computer>.<tailnet>.ts.net:7713` (the phone link's port plus one).
3. On the iPad, open that address in Safari, tap Share, then **Add to Home Screen** (keep **Open as Web App** on).
4. Open Crewhouse from the Home Screen and tap **Pair — yes, let's go**. Paste the code from `./crewhouse phones code`.
5. Check that the app shows the same two words as `./crewhouse phones pending`, then run `./crewhouse phones approve '<two words>'`.

In the app instead: Settings, Phones, "Crewhouse in a phone's browser", **Turn on with the connector app** does step 2 and from then on the QR on the Add a phone card is a link to that address: scanning it with the phone's camera opens the app and pairs it. Running your own server instead? Paste its https address there ("I run my own server"); it must forward to the phone link's port (7712) with websockets.

The 12-letter code works from this page: the app dials the link at its own https address first. A relay code works from it only when your relay is served over https. `./crewhouse phones web off` stops serving the address.

The installed web app (Add to Home Screen on iOS 16.4+, or install on Android) can get the same content-free news as a web push through your own relay. Turn it on under Settings, Phones, "Notifications on this device". A paired installed app has the same switch on its own Settings, under the computer's name. It needs a relay.

## Phone notifications

Phone notifications currently use raw Expo registration, delivery and a local quiet-hours outbox: migration debt pending published BYOKit notification contracts. Content-free news, phone grant authorization and quiet-hour preferences remain Crewhouse policy. Android status uses the published `@byokit/statusbar` 0.1.1 kit; the direct iOS Live Activity integration still needs a kit. The Android preview's push notifications need the builder's own push credential.

## Desktop bar (Omarchy or Waybar)

The computer owner's bar can show `2 working · 1 needs you`, using the same status as the phone. It shows only your own work, with counts in both the pill and tooltip. It clears when the crew is quiet or unreachable. Start Crewhouse normally; the bar only reads its status.

Replace `/absolute/path/crewhouse` with your source checkout and `/absolute/path/node` with your Node executable (`command -v node`, Node 22.22.3 or later). The bar runs [packaging/bar-pill.mjs](../packaging/bar-pill.mjs) once every 10 seconds. For a different Crewhouse port, prefix both the polling and click commands with `CREWHOUSE_PORT=1234`.

For Omarchy's Quickshell bar, add this command module to an existing `bar.layout` section in `~/.config/omarchy/shell.json`:

```json
{
  "id": "crewhouse", "type": "command",
  "exec": "/absolute/path/node /absolute/path/crewhouse/packaging/bar-pill.mjs",
  "interval": 10,
  "onClick": "/absolute/path/crewhouse/crewhouse open"
}
```

For Waybar, add `custom/crewhouse` to `modules-right` (or another module list) and add this configuration:

```json
"custom/crewhouse": {
  "exec": "/absolute/path/node /absolute/path/crewhouse/packaging/bar-pill.mjs",
  "return-type": "json", "interval": 10,
  "on-click": "/absolute/path/crewhouse/crewhouse open"
}
```

This view is for your computer session. Clicking opens Crewhouse, where you can respond on each card.
