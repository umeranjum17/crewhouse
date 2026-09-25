# Try it

A first walk through Crewhouse on your own computer, about 30 minutes. It needs your own ChatGPT account (Plus or Pro, or another account under **Settings, AI accounts**).

## 1. Install and start

You need Node 22.19 or later, and bubblewrap for the bots' shell (`./crewhouse doctor` tells you what is missing). No CLIs and no terminal sign-ins: the engine ships inside Crewhouse.

```bash
git clone https://github.com/umeranjum17/crewhouse ~/crewhouse && cd ~/crewhouse
./crewhouse setup    # answer Y to install the browser (its own Chromium, about 170 MB) and MarkItDown
./crewhouse start    # leave it running in this terminal
```

Open **http://127.0.0.1:7711**.

Everything lives in `~/.local/state/crewhouse/` (the database, the engine's own folder and everyone's sign-ins), `~/Crewhouse/` (the bots) and `~/.local/share/crewhouse/tools/` (the tool kit). Your own `pi`, if you have one, is never touched. `./crewhouse uninstall --all` removes all of it.

## 2. What to test first

1. **Chief and ChatGPT.** He greets you and offers three ideas; tap one (**Call me something else** changes how he addresses you). He asks you to **Sign in with ChatGPT** right under his line: ChatGPT's page opens, pick your account, tap **Continue** (the page says *Codex*: that's the part of ChatGPT the crew uses), and the app moves on by itself, and your request starts. **Having trouble?** switches to a code.
2. **Reel and a video.** Tell Chief: *Please recruit Reel and have it make a 6 second title card that says Crewhouse.* Reel works in its own folder without asking you anything. After a few minutes the video plays in Reel's chat and appears on its **Files** tab.
3. **An approval, at phone width.** Tell Reel: *Save a copy of the video in my Documents folder.* That is your own folder, so Reel asks first, in one sentence. Make the browser window narrow (or use the browser's device mode) to see the phone layout, then answer.
4. **Scout and its browser.** Tell Chief: *Please recruit Scout and have it use its browser to open news.ycombinator.com and tell me the top 3 story titles.* The answer takes about a minute.
5. **Watch, Take over, Give back.** Give Scout a slower job, e.g. *Open wikipedia.org in your browser and read the featured article of the day slowly, section by section, then summarise it in three lines.* Open Scout's **Screen** tab:
   - **Watch** shows its own desktop live.
   - **Take over** pauses Scout. Click into the page, then type; it lands in Scout's browser, not on your screen.
   - Write what you did in the box and press **Give back**. Scout carries on from where it was.
6. **A routine.** Tell Chief: *Every weekday at 9am, have Scout check the top 3 Hacker News stories and send me the titles.* Open **Routines**:
   - Press **Run now** on the new routine. It shows *Done · run by you* when Scout finishes.
   - Press **Run now** on **Morning digest**. Chief posts what finished, what needs you and what is coming up, in your thread.
7. **Household.** Under **Settings, People**, add someone. Pick them under **Who is using this screen?** and they get their own Chief thread, which asks how to address them, and their own **Sign in with ChatGPT**. Until they sign in, their requests wait for them, with the sign-in right there; yours is never lent.
8. **An app.** Ask Scribe to find something in your Notion: Scribe asks for it with a **Connect Notion** card in the chat. Tap it, allow Crewhouse on Notion's page, and Scribe carries on; reading runs at once, adding a page asks first. (Or connect ahead of time under **Settings, Your apps**.) For Google Calendar, Gmail and Drive, first switch Google on for the house under **Settings, Google for the house** ([docs/google-setup.md](docs/google-setup.md)).
9. **Restart mid-task.** While Reel is working (or waiting on you), press Ctrl-C in the crewd terminal, then run `./crewhouse start` again. Reel's **What I did** tab shows *Picked up where it left off*, and a waiting approval can still be answered.

Then run `./crewhouse doctor` in a second terminal.

## 3. The phone app

crewd now carries the phone link. On start it prints `phone link (Noise-encrypted) on port 7712: 127.0.0.1, <your Tailscale address>`.

Install the APK from the draft release [Phone app preview (debug-signed APK)](https://github.com/umeranjum17/crewhouse/releases/tag/untagged-1276d44f733d753e4f66):

```bash
gh release download untagged-1276d44f733d753e4f66 -R umeranjum17/crewhouse -p '*.apk'
sha256sum crewhouse-phone-debug.apk   # 480f6810a021ca6d4c80d9890ea9e2bf32e84dd2e54690510df869dffd02f8dd
adb install -r crewhouse-phone-debug.apk   # phone on USB with USB debugging on
```

Or open the release page on the phone while signed in to GitHub, download the APK and allow installing from the browser.

To pair:

1. The phone needs to reach this computer. Either turn on Tailscale on the phone, or tick **Phones on this Wi-Fi can reach the crew** under **Settings, Phones**.
2. Open **http://127.0.0.1:7711**, then **Settings, Phones, Add a phone**.
3. In the app, press **Scan the code** and scan it within 2 minutes. The phone shows two words, and the computer asks whether it may join: press **Yes, the words match** only if the words are the same. A phone paired before this version keeps working without pairing again.
4. In the app, tell Reel: *Save a copy of the video in my Documents folder.* When the question shows on the app's Home, tap **Yes, go ahead**.

## Known issues

- **Phone app:** it can't watch a helper's screen, set up routines or connect apps yet, and files open on the computer. Adding people and AI sign-ins stay on the computer by design.
- **Bots recruited before the engine change** keep their old instructions (they mention a `crew` command). Recruit them again to pick up the new ones.
- **Chief's wording:** he sometimes rewords a task awkwardly, e.g. *Use its browser to open…*.
- **Household:**
  - Everyone sees the whole crew. Tasks, questions, the Chief thread and AI accounts are per person.
  - With two or more people, the sidebar shows your name as *Owner* until you rename yourself under **Settings, People**.
  - Signing someone in from a phone uses the code (Having trouble?); ChatGPT asks each account to allow device codes once, under its Settings, Security. Catching ChatGPT's page on the phone itself is the next step.
- **Setup:** it prints an npm warning that esbuild's install script was blocked. The web build still works.
