// The plain screen a person sees when Crewhouse didn't start: from the app menu there is no terminal to read a path in.
// `why` says what actually went wrong, in words the person can act on; `href` is where "Open Crewhouse again" goes.
export const trouble = (why, href) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crewhouse</title>
<style>
/* The app's own values (web/src/tokens.ts): the same day and night the person sees everywhere else. */
:root{color-scheme:light dark;--bg:#F6F7F9;--surface:#FFF;--ink:#141A2A;--ink2:#4D566B;--mute:#666D80;--fill:#F0482A;--line:#E3E6EC}
@media (prefers-color-scheme:dark){:root{--bg:#111014;--surface:#1A191E;--ink:#F1EFEA;--ink2:#ABA7B1;--mute:#88848E;--fill:#FF6A4D;--line:#2A2830}}
body{margin:0;background:var(--bg);color:var(--ink);font:400 15px/1.55 'Inter',system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:12vh 1.5rem 4rem;text-align:center}
h1{font:600 28px/1.2 'Instrument Serif',Georgia,serif;margin:.6rem 0 .8rem}
p{margin:0 0 1rem;color:var(--ink2)}
.lead{font-size:17px}
.why{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:.9rem 1.1rem;color:var(--ink);font-size:14px}
.why b{color:var(--fill)}
.btn{display:inline-block;margin-top:1.2rem;background:var(--ink);color:var(--bg);text-decoration:none;font:500 15px/1 'Inter',system-ui,sans-serif;padding:13px 22px;border-radius:10px}
.btn:hover{opacity:.92}
.mute{color:var(--mute);font-size:13px}
@media (max-width:430px){main{padding-top:8vh}h1{font-size:24px}}
</style>
<main>
<svg width="86" height="112" viewBox="0 0 72 96" role="img" aria-label="Chief" fill="none" stroke="var(--ink)" stroke-width="2.6" stroke-linejoin="round">
<path d="M18 36c0-8 8-12 18-12s18 4 18 12c0 6-2 9-2 17 0 14 6 21 6 27 0 6-10 10-22 10s-22-4-22-10c0-6 6-13 6-27 0-8-2-11-2-17Z" fill="var(--surface)"/>
<path d="M12 33h48"/><path d="M25 33a11 10 0 0 1 22 0"/>
<path d="M29 52h4M41 52h4"/><path d="M31 61c3 3 7 3 10 0"/><path d="M29 71l7 6 7-6" fill="var(--fill)" stroke="none"/>
</svg>
<h1>Crewhouse didn't start</h1>
<p class="lead">Give it another try, or restart your computer.</p>
<p class="why"><b>What happened:</b> ${why}.</p>
<a class="btn" href="${href}">Open Crewhouse again</a>
<p class="mute">Still nothing? Open Crewhouse from your app menu.</p>
</main>`;
