// The page the standing phone link opens (src/link.ts `pairPage`). `href` hands the app a ticket minted for this open.
const APK = 'https://github.com/umeranjum17/crewhouse/releases/download/phone-preview/crewhouse.apk';

/** `install`: the app did not open, so the download comes first. The script keeps the ticket fresh while the page waits
 *  (a person installs the app and comes back), and swaps in the newest phone preview's build when GitHub answers. */
export const pairHtml = (href: string, ticket: string, install: boolean) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Add this phone to Crewhouse</title>
<style>:root{--bg:#F4F3EF;--card:#fff;--ink:#0B0B0B;--mute:#5F5E59;--go:#3D6FD6;--line:#D9D7D0}
@media(prefers-color-scheme:dark){:root{--bg:#000;--card:#141414;--ink:#F4F3EF;--mute:#8E8D88;--go:#0A84FF;--line:#262626}}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,sans-serif}main{max-width:480px;margin:0 auto}
h1{font-size:28px;line-height:1.15;margin:32px 0 12px}p{margin:0 0 14px}.mute{color:var(--mute);font-size:15px}
.btn{display:block;box-sizing:border-box;width:100%;padding:18px;border-radius:14px;background:var(--go);color:#fff;font-weight:700;font-size:19px;text-align:center;text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:20px 0}.card .btn{background:var(--ink);color:var(--bg)}ol{padding-left:22px;margin:0 0 14px}</style></head>
<body><main><h1>Add this phone to Crewhouse</h1>
<p>This is the link to the Crewhouse on your computer. Tap the button and the app asks your computer to let this phone in.</p>
<a id="go" class="btn" href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">Open Crewhouse and join</a>
<div id="install" class="card"${install ? '' : ' hidden'}><b>Crewhouse is not on this phone yet.</b>
<ol><li>Download the app below.</li><li>Open the file to install it. If the phone asks, allow installs from this browser.</li><li>Come back to this page and tap <b>Open Crewhouse and join</b> again.</li></ol>
<a id="apk" class="btn" href="${APK}">Download the app</a></div>
${install ? '' : '<p class="mute" style="margin-top:20px"><a href="#install" id="need" style="color:inherit">Crewhouse is not on this phone yet?</a></p>'}<p class="mute">Your computer shows two words and asks you to say yes. Nothing joins until you do. This link keeps working: open it again any time.</p></main>
<script>const go=document.getElementById('go'),box=document.getElementById('install');let at=Date.now();
const renew=()=>fetch(${JSON.stringify(ticket)},{cache:'no-store'}).then(r=>r.json()).then(j=>{go.href=j.href;at=Date.now()}).catch(()=>{});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renew()});setInterval(()=>{if(!document.hidden&&Date.now()-at>60000)renew()},15000);
go.addEventListener('click',()=>setTimeout(()=>{if(!document.hidden)box.hidden=false},2500));
const need=document.getElementById('need');if(need)need.addEventListener('click',e=>{e.preventDefault();box.hidden=false});
fetch('https://api.github.com/repos/umeranjum17/crewhouse/releases?per_page=20').then(r=>r.json()).then(l=>{const r=l.find(x=>!x.draft&&/^v\\d+\\.\\d+\\.\\d+-preview\\.\\d+\\.\\d+$/.test(x.tag_name)),f=r&&r.assets.find(a=>/-arm64-v8a\\.apk$/i.test(a.name));if(f)document.getElementById('apk').href=f.browser_download_url}).catch(()=>{});</script></body></html>`;
