# Phone reconnects through a brief computer stall

This journey holds the isolated `crewd` JavaScript event loop synchronously while the real Android app and installed
PWA are paired over the encrypted link. Scout is kept working by the scripted engine. Two task-owned TCP probes connect
while the event loop is held; `ss -ltn` records both connections in the link listener's accept queue, and a new connection
must succeed after the loop resumes. The journey captures both apps before the stall, during the reconnect attempt, and
after the link returns. It uses an owned stub-engine lab and an owned emulator; it needs no account or model.

Run it with `done-done run phone-link-stall`, setting `LAB` to a task-owned scratch folder, `SERIAL` to the task-owned
emulator, and `APK` to the release APK built from this checkout. Set `ANDROID_USER_HOME`, `ADB_SERVER_PORT`, and
`ADB_VENDOR_KEYS` to the task's private Android home, ADB server port, and generated key. The command starts and stops its own lab. The actual
driver is `scripts/verify/phone-link-stall.sh`; it delegates pairing to `scripts/verify/phone-pair-link.mjs` and the
stall, queue measurement, screenshots, and automatic recovery assertion to `scripts/verify/phone-link-stall.mjs`.

The evidence must show the accept queue above zero during the event-loop hold, Scout still reading **At work** in both
apps during the retry, no cannot-reach banner for the short offline interval, and automatic recovery. The native app's
**Back in touch with the home computer** notice and its successful read of Chief's thread prove the return path. The event-loop hold reproduces a sufficient cause of listener
starvation. It does not establish that the historical incident had the same trigger; the 07:10–07:13 crewd log was not
available in the isolated task materials.
