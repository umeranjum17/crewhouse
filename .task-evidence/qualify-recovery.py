import os,sys,time,json,fcntl,subprocess,pathlib,hashlib
repo=str(pathlib.Path(__file__).resolve().parent.parent)
e=pathlib.Path(repo)/'.task-evidence'
lock=open('/home/umer/lab-tmp/crewhouse-heavy.lock','r+')
try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: print('NOT ADMITTED: lock busy'); sys.exit(75)
load=os.getloadavg()[0]; now=time.time()
if load>16: print('NOT ADMITTED: load',load); sys.exit(75)
lab=e/('lab-'+str(int(now))); lab.mkdir()
for d in ['home','tmp','config','cache','data','state','runtime','shots']: (lab/d).mkdir()
node='/home/umer/.local/share/mise/installs/node/24.21.0'
cmd=['/usr/bin/bwrap','--die-with-parent','--ro-bind','/','/','--tmpfs','/home/umer','--ro-bind',repo,repo,'--tmpfs','/opt','--ro-bind',node,'/opt/task-node','--bind',str(lab),str(lab),'--tmpfs','/tmp','--tmpfs','/run','--dev','/dev','--proc','/proc','--unshare-ipc','--unshare-uts','--chdir',repo,'/opt/task-node/bin/node','--test','--test-concurrency=1','test/office.test.ts','test/teach.test.ts']
env={'HOME':str(lab/'home'),'TMPDIR':str(lab/'tmp'),'PATH':'/opt/task-node/bin:/usr/bin:/bin','MISE_OFFLINE':'1','CREWHOUSE_ENGINE':'stub','OFFICE_SHOTS':str(lab/'shots'),'DBUS_SESSION_BUS_ADDRESS':'unix:path='+str(lab/'no-bus')}
for k,d in [('CONFIG','config'),('CACHE','cache'),('DATA','data'),('STATE','state'),('RUNTIME_DIR','runtime')]: env['XDG_'+(k if k=='RUNTIME_DIR' else k+'_HOME')]=str(lab/d)
record={'began':now,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now)),'load1':load,'admission_limit':16,'budget_seconds':360,'command':cmd,'env':env,'base':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()}
record['source_sha256']={f:hashlib.sha256((pathlib.Path(repo)/f).read_bytes()).hexdigest() for f in ['test/browser.ts','test/office.test.ts','test/teach.test.ts']}
(lab/'admission.json').write_text(json.dumps(record,indent=2))
print('ADMITTED',str(lab),load,flush=True)
def ident(pid):
 try:
  a=pathlib.Path('/proc/'+str(pid)+'/stat').read_text(); f=a[a.rfind(')')+2:].split(); return (int(f[1]),f[19])
 except FileNotFoundError: return None
with (lab/'tests.log').open('w') as out:
 p=subprocess.Popen(cmd,env=env,stdout=out,stderr=subprocess.STDOUT)
 root=ident(p.pid)
 if root is None or root[0]!=os.getpid(): raise RuntimeError('runner ownership not witnessed')
 owned={p.pid:root}
 deadline=now+360
 while p.poll() is None and time.time()<deadline:
  live={int(x.name):ident(int(x.name)) for x in pathlib.Path('/proc').iterdir() if x.name.isdigit()}
  added=True
  while added:
   added=False
   for pid,i in live.items():
    if i and pid not in owned and i[0] in owned and live.get(i[0])==owned[i[0]]: owned[pid]=i; added=True
  time.sleep(.1)
 cutoff=p.poll() is None
 if cutoff:
  # No group signals: exact witnessed PID + starttime, children before wrapper.
  record['cutoff_survivors']={pid:i for pid,i in owned.items() if ident(pid)==i}
  for pid,i in reversed(list(owned.items())):
   if ident(pid)==i: os.kill(pid,15)
  try: p.wait(timeout=10)
  except subprocess.TimeoutExpired:
   for pid,i in reversed(list(owned.items())):
    if ident(pid)==i: os.kill(pid,9)
   p.wait(timeout=10)
record.update({'finished':time.time(),'exit':p.returncode,'cutoff':cutoff,'owned':owned,'survivors':{pid:i for pid,i in owned.items() if ident(pid)==i}})
(lab/'result.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record),flush=True)
sys.exit(1 if cutoff or record['survivors'] else p.returncode)
