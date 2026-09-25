# Switching Google on for the house

Once, by the owner, about twenty minutes, free. After this, anyone in the house can let a helper use their own Google Calendar, Gmail or Drive with a tap on the Connect card in a chat.
Until it is done, those cards say "Google isn't switched on for the house yet. Ask Umer." and nobody reaches a broken Google page.

Notion, Canva, sharing from the phone and ChatGPT need none of this.

## What you are making

A private Google "app" called Crewhouse that only your family uses.
Google allows that without its review for personal use by fewer than 100 people: each person clicks through one "unverified app" warning, once ([Google: when verification is not needed](https://support.google.com/cloud/answer/13464323)).

## Steps

1. Open the [Google Cloud console](https://console.cloud.google.com/) with your own Google account, and create a project named **Crewhouse (family)**. No billing account is needed.
2. **APIs & Services → Library**: enable the **Google Calendar API**, the **Gmail API** and the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google now calls it *Google Auth Platform*):
   - User type **External**. App name **Crewhouse**, your email as the support and developer contact.
   - **Data access / Scopes**: add `.../auth/calendar.events`, `.../auth/gmail.readonly` and `.../auth/drive.file`.
   - **Audience**: press **Publish app** so the status reads **In production**.
     Leave it in *Testing* and every connection stops working after 7 days ([Google: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)).
     Publishing does not start a review; it only lifts the 7-day limit and the test-user list.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Desktop app**, name **Crewhouse home computer**.
   - Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) and the **Client secret**.
5. In Crewhouse on the home computer: **Settings → Google for the house**, paste both, and press **Switch it on**.

That's all. The Client ID and secret stay on the home computer, in Crewhouse's own folder; nobody's Google password or token ever passes through them.

## What each person sees when they connect

| Service | Taps | Why |
|---|---|---|
| Google Drive | 3: Connect → their account → Continue | Crewhouse only asks for the files it makes or they pick (`drive.file`), which Google counts as non-sensitive: no warning. |
| Google Calendar | 5: Connect → account → **Advanced** → **Go to Crewhouse (unsafe)** → Continue | Calendar is a *sensitive* scope, so Google shows its "This app isn't verified" screen. The Connect card warns them first, in one line. |
| Gmail (read only) | 5, the same way | Gmail is a *restricted* scope. The warning stays: removing it needs a paid yearly security assessment, which a family app doesn't need. |

The warning is Google's, and "unsafe" is Google's word for an app it has not reviewed.
If someone taps **Back to safety**, nothing is connected and Crewhouse says so kindly, with Try again.

## Costs

Nothing. The Cloud project, the APIs and the OAuth client are free at a family's usage, and no billing account is attached.

Optional, later: Google's free *sensitive-scope verification* (a privacy policy, a homepage on a domain you own, a short demo video, a few weeks of review) removes the warning for Calendar, making it 3 taps.
Gmail's warning can only go with the paid assessment (CASA), so it stays at 5.

## When something goes wrong

- **"Access blocked: Authorization Error … invalid_client"**: the Client ID was pasted wrongly or the client was deleted. Paste it again under Settings → Google for the house → Change.
- **Connections stop after a week**: the app is still in *Testing*. Publish it (step 3), then each person taps Connect once more.
- **Someone left a box unticked** on Google's page: Crewhouse says "Google Calendar still isn't ticked" and Try again reopens the page.
- **Connections lapse after about six months unused, or after a password change (Gmail)**: Chief says so once, and the next Connect card brings it back.

## Later: the phone

On the phone, Google needs an `https` return address rather than the home computer's own.
That comes with the phone app's sign-in relay (a second, *Web application* client whose return address is a static Crewhouse page), and will be one more ID to paste here.
