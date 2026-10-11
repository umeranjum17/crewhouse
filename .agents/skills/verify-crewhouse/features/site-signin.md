# site-signin: a helper asks to be signed in to a site, the person signs in on its screen

A helper on a page it needs the person signed in to calls `crew_signin {site}` (skill `sign-in-for-me`). crewd opens a
`kind: 'signin'` ask owned by Chief (`askSignin` in `src/crew.ts`), so the card sits in Chief's thread: the site's icon,
"Sign in to <host>" and one button with the same words (`SignInCard` in `web/src/parts.tsx`). The button opens the
helper's screen large (`SiteSignIn` in `web/src/screen.tsx`, `#/ask/:id`): it takes the wheel at once, the site name on
top, one Done; "Add a note" is a link. Done is the old Give back: the wheel returns, the ask is answered, the host is
kept signed in (its presses ask), the helper's task resumes, and the card leaves its receipt "Signed in to <host> · <time>".
On the desk the card shows once: the right column skips an ask Chief's thread already shows (`ChiefRail`).
The crew never types the password; the bot's browser never offers to keep one (`credentials_enable_service: false`).

## Gate

`node --test --test-name-pattern="sign-in card: a helper|Done on a sign-in" test/unit.test.ts`: the card (Chief's, site and icon, in Needs
you) and Done (task resumes, host signed in, no open ask, the answered line with its time).

## Drive (real crewd, stub engine)

`bash run.sh "$PWD"` from the evidence folder (or the same steps by hand), one fresh lab per pass so no shot carries an
earlier pass's answered lines: a local shop
(`scripts/test-shop.mjs <port>`, any email signs in; reached as `shop.localhost:<port>`), an isolated crewd, Umer
onboarded, Penny recruited from `helper`, then
`SITE_URL=http://shop.localhost:<port> node .agents/skills/verify-crewhouse/scripts/site-signin.ts "$PWD" "$B" "$LAB/state" "$EV" penny <tag>`.
The job is asked of Chief ("Penny, check my Corner Shop orders"), as a person would. Per tag (day/night × 1440/390) it
writes `screens/card-*`, `large-*`, `done-*` (signed in, before Done)
and `answered-*`; one clip `motion/site-signin-day-1440.webm`; and appends to `site-signin-report.json`. The person's sign-in is typed through the
streamed picture (clicks mapped to the helper's 1280×800 pixels, then keys), as a person would.

On the iPad: the installed web app per [pwa-resume.md](pwa-resume.md#on-the-ipad-simulator-real-safari-home-screen-app),
tap the card's button, capture the large screen.

## Pass

Card: in Chief's thread and shown once (`copies: 1`), icon loaded, button "Sign in to <host>", no sideways scroll.
Large: fills the viewport, the
bar shows the site and Done, the picture fits under it, `controls: true`. Answered: the line matches
`Signed in to <host> · <time>`, no open sign-in ask, `signedIn` holds the host, the card is gone, the helper finishes;
the helper's chat has no unread badge (its finished job came through Chief, whose thread relays it).

## Gotchas

- On the stub engine the helper's browser tool is headless (`onScreen` is off), so the script puts the shop on the
  helper's own display with `scripts/xtype.py` (its Xvfb found by `$STATE/desktops/<bot>.xauth`), standing in for the
  helper's `browser goto`. The real engine's browser tool drives that same screen.
- The site icon is fetched by the person's own browser from the site (`<origin>/favicon.ico`, no referrer); a site
  without one shows its first letter.
