# Try it

A first walk through your Crewhouse personal assistant on your own computer, about 30 minutes. It needs your own AI account — a ChatGPT Plus or Pro subscription, or any other account the crew offers under **Settings, AI accounts** (each row says whether it uses a plan you already pay for or is charged per use).

## 1. Install and start

Download **`crewhouse_<version>_amd64.deb`** from the [releases page](https://github.com/umeranjum17/crewhouse/releases) (about 200 MB), double-click it, and press **Install** in your software centre — it brings the helpers' sandbox and screens with it. Then open **Crewhouse** from your app menu; Chief greets you on his own. Nothing to type and no terminal anywhere.

Crewhouse keeps everything in one folder under your system program directory, plus your own crew folder `~/Crewhouse/`. Your own `pi`, if you have one, is never touched. From a checkout, `./crewhouse uninstall --all` removes all of it; on the installed one, your software centre removes it.

## 2. What to test first

1. **Chief and your AI account.** He greets you and offers three ideas; tap one (**Call me something else** changes how he addresses you). He asks you to **Sign in with…** right under his line, naming your account: that account's own page opens, you say yes, and the app moves on by itself, and your request starts. **Having trouble?** switches to a code. Other accounts (Grok, GitHub Copilot, OpenRouter, MiniMax, Claude) are under **Settings, AI accounts**.
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
7. **Your settings.** Under **Settings, You**, edit your name, how Chief addresses you, your quiet hours and how much of your AI the crew may use. One install is for you and your crew.
8. **An app.** Ask Scribe to find something in your Notion: Scribe asks for it with a **Connect Notion** card in the chat. Tap it, allow Crewhouse on Notion's page, and Scribe carries on; reading runs at once, adding a page asks first. (Or connect ahead of time under **Settings, Your apps**.) For Google Calendar, Gmail and Drive, first switch Google on under **Settings, Google setup** ([docs/google-setup.md](docs/google-setup.md)).
9. **Restart mid-task.** Restart your computer while Reel is working (or waiting on you). Crewhouse starts by itself when you log in, Reel's **What I did** tab shows *Picked up where it left off*, and a waiting approval can still be answered.

From a checkout, run `./crewhouse doctor` in a second terminal instead.

## 3. The phone app

Install [Crewhouse phone preview .16](https://github.com/umeranjum17/crewhouse/releases/download/v1.0.0-preview.20261001.16/CREWHOUSE-APK-1.0.0-preview.20261001.16.apk), version **1.0.0-preview.20261001.16**, on your Android phone. Open the download and allow installing from your browser when Android asks. It updates the previous preview in place.

To pair:

1. The phone needs to reach this computer. For the same Wi-Fi, turn on **Phones on this Wi-Fi can reach the crew** under **Settings → Phones**. To reach it from away, turn on Tailscale on both devices.
2. On the computer, open **Crewhouse → Settings → Phones → Add a phone**.
3. On the phone, press **Type a code** and paste the whole code shown on the computer, then press **Pair**. You can also press **Scan the code** and scan it. The code lasts two minutes.
4. Check that the two words on the phone match the ones on the computer, then press **Yes, the words match** on the computer.
5. Finish the phone's notification choice and open your crew. Home greets you by name. Tap **Chief**, write a message and press **Send** to see his reply in the same thread.

A phone on an older preview can open Chief's chat and use **Get the latest Crewhouse app** to download this build.

## Known limits

AI sign-ins and connecting apps stay on the computer. Android notifications need the builder's push credential; without it, news appears when you open Crewhouse. The iPhone build is not available yet.
