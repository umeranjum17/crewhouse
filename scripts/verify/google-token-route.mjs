// Lab only, preloaded into crewd by action-card.sh: @byokit/connect moves its four named Google presets onto emulate, not Crewhouse's
// gmailsend app, so the code exchange for that one connection is routed to emulate here rather than to Google.
const emulator = process.env.CREWHOUSE_GOOGLE_EMULATOR, real = globalThis.fetch;
if (emulator) globalThis.fetch = (url, init) => real(String(url) === 'https://oauth2.googleapis.com/token' ? `${emulator}/oauth2/token` : url, init);
