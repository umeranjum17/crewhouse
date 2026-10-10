# Switching Google on for your crew

**Most people do nothing here.** Crewhouse uses the crew's own Google app, already switched on for your computer, so you can let a helper use your Google Calendar, Gmail or Drive with a tap on the Connect card in a chat. Open **Settings → Google setup**: if it says "Google is on for your crew", you are done — skip this page.

This page is for the other case: your computer has no crew Google app yet (a self-hosted machine, no Google file at `~/.config/byokit/google-oauth-client.json` or `$CREWHOUSE_GOOGLE_CLIENT`). Then Google cards say the app needs Google switched on for your crew first, and you make your own private app once, below. About twenty minutes, free.

Notion, Canva, sharing from the phone and ChatGPT need none of this.

## What you are making

A private Google "app" called Crewhouse for your personal assistant.
Google allows that without its review for personal use by fewer than 100 people: you click through one "unverified app" warning, once ([Google: when verification is not needed](https://support.google.com/cloud/answer/13464323)).

## Steps

1. Open the [Google Cloud console](https://console.cloud.google.com/) with your own Google account, and create a project named **Crewhouse (personal)**. No billing account is needed.
2. **APIs & Services → Library**: enable the **Google Calendar API**, the **Gmail API** and the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google now calls it *Google Auth Platform*):
   - User type **External**. App name **Crewhouse**, your email as the support and developer contact.
   - **Data access / Scopes**: add `.../auth/calendar.events`, `.../auth/gmail.readonly` and `.../auth/drive.file`. For Gmail sending, also add `.../auth/gmail.send`, `openid` and `email`.
   - **Audience**: press **Publish app** so the status reads **In production**.
     Leave it in *Testing* and every connection stops working after 7 days ([Google: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)).
     Publishing does not start a review; it only lifts the 7-day limit and the test-user list.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Desktop app**, name **Crewhouse home computer**.
   - Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) and the **Client secret**.
5. In Crewhouse on the home computer: **Settings → Google setup**, paste both, and press **Switch it on**.

Sign-in, grants, refresh and remote app tools use the pinned BYOKit connection kit. Saved sign-ins and the setup key use its documented sealed-store adapter. Existing connections must be reconnected after this change; no old sign-ins or setup keys are imported.

That's all. The Client ID and secret stay on the home computer, in Crewhouse's own folder; nobody's Google password or token ever passes through them.

## What you see when you connect

| Service | Taps | Why |
|---|---|---|
| Google Drive | 3: Connect → your account → Continue | Crewhouse only asks for the files it makes or you pick (`drive.file`), which Google counts as non-sensitive: no warning. |
| Google Calendar | 5: Connect → account → **Advanced** → **Go to Crewhouse (unsafe)** → Continue | Calendar is a *sensitive* scope, so Google shows its "This app isn't verified" screen. The Connect card warns you first, in one line. |
| Gmail (read only) | 5, the same way | Gmail is a *restricted* scope. The warning stays: removing it needs a paid yearly security assessment, which a personal app doesn't need. |
| Gmail sending (separate) | 5, the same way | Its own Connect, so reading Gmail never grants sending. Sending is a sensitive scope, so the warning is the same as Calendar's. Each email still waits for your yes on your phone. |

The warning is Google's, and "unsafe" is Google's word for an app it has not reviewed.
If you tap **Back to safety**, nothing is connected and Crewhouse says so kindly, with Try again.

## Costs

Nothing. The Cloud project, the APIs and the OAuth client are free for personal use, and no billing account is attached.
On the crew's own Google app (the usual case) there is nothing at all to pay for or set up.

Optional, later: Google's free *sensitive-scope verification* (a privacy policy, a homepage on a domain you own, a short demo video, a few weeks of review) removes the warning for Calendar, making it 3 taps.
Gmail's warning can only go with the paid assessment (CASA), so it stays at 5.

## How Crewhouse checks each step

These checks apply only when you paste your own key. On the crew's own app, Settings just says Google is on.

Settings → Google setup distinguishes **Checked** (a completed sign-in proved it) from **You said done** (check it on Google's own pages).

- **Pasting the key**: Crewhouse checks the boxes' shapes and saves the key sealed on this computer. It does not ask Google to verify the key before saving. A completed Connect proves Google accepted the key and knows the project. Sign-in failures use the kit's plain typed errors; they cannot yet distinguish an unknown ID, a mismatched secret or the wrong client type.
- **API enablement and publishing**: check steps 2 and 3 on Google's pages. The kit does not expose refresh-token lifetime or provider error causes, so Crewhouse cannot yet detect Testing, Internal audience or a disabled API, and these steps stay **You said done**. It does not perform a separate API probe after sign-in.
- **A box left unticked** on the sign-in page: the kit refuses an incomplete grant. The card says which service to tick, and Try again reopens the page.
- **Back to safety** on Google's warning: nothing is connected, and the card says so, with Try again.
- **A revoked connection**: the kit removes it only when the provider explicitly refuses its refresh grant. Chief says so once; the next Connect brings it back. A temporary connection failure keeps the saved sign-in.

## Later: the phone

On the phone, Google needs an `https` return address rather than the home computer's own.
That comes with the phone app's sign-in relay (a second, *Web application* client whose return address is a static Crewhouse page), and will be one more ID to paste here.

## The crew's own Google app

The file `~/.config/byokit/google-oauth-client.json` (or `$CREWHOUSE_GOOGLE_CLIENT`) holds a Google **Desktop app** client belonging to the crew, read through the kit's `googleClientFile` and never copied into Crewhouse's own storage. Crewhouse refuses a file other users can read, a non-regular file, or any client type other than a Desktop app; a missing file just falls back to the key you paste above. When the file is present, every Google app connects with a tap and the four steps above are not needed.
