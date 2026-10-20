// Task-owned live crewd proof. Scripted model; real HTTP, policy, browser, files and SQLite.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const repo = resolve(import.meta.dirname, '../..');
const ev = process.env.CREWHOUSE_RECEIPT_EVIDENCE;
if (!ev || resolve(ev).startsWith(repo + '/')) throw Error('Set CREWHOUSE_RECEIPT_EVIDENCE outside the repo');
if (process.env.CREWHOUSE_ENGINE !== 'stub' || ['STATE_DIR','CREW_DIR','TOOLS_DIR'].some(k=>!process.env[`CREWHOUSE_${k}`])) throw Error('Use the isolated stub Launch environment with explicit state, crew and tools directories');
mkdirSync(ev, {recursive:true});
const { loadConfig } = await import(`${repo}/src/config.ts`);
const { Store } = await import(`${repo}/src/db.ts`);
const { Crew } = await import(`${repo}/src/crew.ts`);
const { startServer } = await import(`${repo}/src/server.ts`);
const free = createServer(); await new Promise(r=>free.listen(0,'127.0.0.1',r));
const linkPort=free.address().port; await new Promise(r=>free.close(r));
const cfg = {...loadConfig(), port:0, linkPort, linkHost:'127.0.0.1'};
const db = new Store(cfg.stateDir), crew = new Crew(cfg,db); crew.init();
const server = await startServer(cfg,db,crew);
const base = `http://127.0.0.1:${server.address().port}`;
const facts = 'Your order is placed, Umer. Order CH-1042: five building sets, $241.34 on your Amex ending 1005. Free shipping to West Lake Hills; delivery in 3–5 business days. The receipt goes to umer@example.test. A good weekend in the making.';
let placed = false;
const shop = createServer((req,res) => {
 res.setHeader('content-type','text/html; charset=utf-8');
 if(req.url === '/placed') placed=true;
 res.end(`<!doctype html><html><head><title>Building Shop · ${placed?'Order placed':'Checkout'}</title><style>body{font:18px system-ui;background:#f5f2ec;color:#193c36;margin:0}header{padding:24px;background:#193c36;color:white}main{max-width:740px;margin:48px auto;padding:32px;background:white;border-radius:18px}h1{font-size:32px}p{line-height:1.7}button{padding:16px;background:#193c36;color:white;border:0;border-radius:8px;font:inherit}</style></head><body><header>BUILDING SHOP · Private demo shop</header><main><h1>${placed?'Your order is placed':'Checkout'}</h1><p>Order CH-1042 · Five building sets</p><p>Total $241.34<br>Amex ending 1005<br>Free shipping · West Lake Hills<br>Delivery in 3–5 business days<br>Receipt: umer@example.test</p>${placed?'<p>Thank you, Umer. We’ll email you when it ships.</p>':'<button autofocus onclick="location.href=\'/placed\'">Place order</button>'}</main></body></html>`);
});
await new Promise(r=>shop.listen(0,'127.0.0.1',r));
const shopBase=`http://127.0.0.1:${shop.address().port}`;
const api=async(method,path,body)=>{const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${readFileSync(join(cfg.stateDir,'person.key'),'utf8')}`,'x-crewhouse':'1','content-type':'application/json'},body:body&&JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(JSON.stringify(result));return result;};
const until=async(label,fn)=>{for(const end=Date.now()+60000;!await fn();await new Promise(r=>setTimeout(r,50)))if(Date.now()>end)throw Error(label);};
const call=(name,input)=>`[tool ${name} ${JSON.stringify(input)}]`;
await until('engine ready',()=>crew.runtime);
await api('POST','/api/onboard',{address:'Umer'});
await api('PUT','/api/house/money',{cap:300});
await api('POST','/api/recruit',{template:'scout',name:'Scout'});
await api('PUT','/api/bots/scout/tools',{tools:['files','browser']});
await api('PUT','/api/bots/scout/settings',{computer:false});
mkdirSync(join(cfg.crewDir,'bots/scout/files/photos'),{recursive:true});
const task='Place the building sets order, then ask permission '+[
 call('browser',{args:['goto',shopBase+'/checkout']}),
 call('browser',{args:['press','Enter']}),
 call('browser',{args:['screenshot','--filename=files/photos/order-result.png']}),
 call('crew_deliver',{path:'files/photos/order-result.png',note:'The shop’s order-placed page'}),
 call('crew_outcome',{worked:true,seen:facts})
].join(' ');
crew.say('chief','person','Order the five building sets');
crew.assign('scout',task,'chief');
await until('approval',()=>db.get("SELECT id FROM asks WHERE kind='permission' AND state='open'"));
const approval=db.get("SELECT * FROM asks WHERE kind='permission' AND state='open'");
writeFileSync(join(ev,'approval-before.json'),JSON.stringify(await api('GET','/api/state'),null,2));
await api('POST',`/api/asks/${approval.id}/answer`,{answer:'allow',scope:'once'});
await until('model held',()=>crew.sessionOf('scout')&&crew.runtime.holding(crew.sessionOf('scout').key));
if(!placed)throw Error('the real private demo shop did not receive the approved press');
crew.runtime.release(crew.sessionOf('scout').key,facts);
await until('finished',()=>db.get("SELECT 1 FROM tasks WHERE bot='scout' AND state='done'"));
// A helper offers its own shipping check: still a propose card, never silently started.
await api('POST','/api/bots/scout/messages',{text:'Offer the follow-up '+call('crew_routine',{when:'every morning 9am',name:'Building sets shipping watch',task:'Check the order page and tell me if the tracking link or delivery date changes',watch:shopBase+'/placed'})});
await until('routine proposal',()=>db.get("SELECT id FROM asks WHERE kind='propose' AND json_extract(detail,'$.routine') IS NOT NULL AND state='open'"));
const offer=db.get("SELECT id FROM asks WHERE kind='propose' AND json_extract(detail,'$.routine') IS NOT NULL AND state='open'");
writeFileSync(join(ev,'routine-before.json'),JSON.stringify(await api('GET','/api/state'),null,2));
await api('POST',`/api/asks/${offer.id}/answer`,{answer:'allow'});
writeFileSync(join(ev,'current-thread.json'),JSON.stringify({base,shopBase,placed,facts,chief:await api('GET','/api/bots/chief'),state:await api('GET','/api/state')},null,2));
writeFileSync(join(ev,'base'),base);
console.log('READY '+base);
const stop = async()=>{crew.stop();server.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>shop.close(r));db.close();process.exit(0);};
process.on('SIGTERM',stop);
