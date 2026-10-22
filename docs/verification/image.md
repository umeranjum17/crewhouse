# An image both ways in Chief's chat

The person taps + in Chief's box (the paperclip on a computer) and picks a photo. The app makes it small the way the phone
does (about 1280 px wide, JPEG, no location data) and shows it in the box as a chip with its own thumbnail, its name, kind
and size, and ✕. On Send, crewd keeps it in Chief's `files/photos/<task>-<n>.jpg` under its own name, gives it to Chief's
model with the words, and the thread shows the photo with the words the person typed. Chief hands the job on; the
helper's finished picture (`crew_deliver` of a file under its `files/`) comes back on Chief's reply in the thread, shown
whole (`object-fit: contain`), and taps open full size. Chief's reply carries only what the crew made: the person's own
photo is the job's input (`input: true` on its `file.delivered` event) and is never shown again as a result.

## Drive and witness

`CHROME_DEVTOOLS_AXI_SESSION=<task> bash scripts/verify/image.sh <repo> <out-dir>` (stub engine, no account, no model, no
key; `npm run build:web` first). The browser has no file dialog, so the photo is staged on the composer's own
`input[type=file]` as the dialog leaves it; everything after is the app's. The stub engine reads a turn's calls from its
words (`src/stub-runtime.ts`), so the words sent carry Chief's `sessions_send` hand-off to Video Vic on a second line
(the app never shows it), and the hand-off carries Vic's two calls: his sandboxed shell writes the picture made by the
script into `files/photos/`, then `crew_deliver`.

What it proves, from the lab's own records: `picked-geometry.txt` (the chip has the photo's thumbnail, the typed words
are in the box, and the box, + and Send are on screen at 390); `records.txt` (the person's line ends
`[photo chief] files/photos/1-1.jpg`, the kept photo is a 1280-wide JPEG, `run.prompted` gave Chief's model one photo,
Vic's picture is byte-identical to the one made, both deliveries with their notes); `sent-line.txt` (the person's line
reads as their words only); `thread-geometry.txt` (exactly two pictures in the thread: the person's photo on their line
and Vic's on Chief's reply, both uncropped).

## Capture

`screens/image-attach-{day,night}-{390,1440}.png` (the box with + / the paperclip), `screens/image-picked-…` (the photo
in the box with the words), `screens/image-sent-…` (the person's line), `screens/image-thread-…` (Vic's picture on
Chief's reply), the same three in the installed app as `pwa/image-{picked,sent,thread}-installed-{day,night}-{390,1440}.png`,
and `look/image-thread-{day,night}.png` (360 wide, largest text).

## Not covered

The device's own picker sheet: on the web and the installed app, + opens the system's chooser (camera, photos, files),
which a headless browser cannot show; the phone app's own + sheet is in [chat-attach.md](chat-attach.md). A real model
looking at the photo (the engine is given it, `run.prompted` `photos: 1`, but no model runs here), a helper seeing the
person's photo (a native hand-off carries words only), making a new image (no image-generation tool), and the native
Expo app.
