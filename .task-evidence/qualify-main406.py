import os,sys,time,json,fcntl,subprocess,pathlib,hashlib,signal
repo=str(pathlib.Path(__file__).resolve().parent.parent)
e=pathlib.Path(repo)/'.task-evidence'
lock=open('/home/umer/lab-tmp/crewhouse-heavy.lock','r+')
try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: print('NOT ADMITTED: lock busy'); sys.exit(75)
load=os.getloadavg()[0]; now=time.time()
forced='--main415-final' in sys.argv # Only explicit Main415 final-try authority; Main381's one-shot override was already used.
if load>=40 and not forced: print('NOT ADMITTED: load',load); sys.exit(75)
if forced:
 marker=e/'main415-admission.used'
 try:
  with marker.open('x') as used: used.write(str(now)); used.flush(); os.fsync(used.fileno())
 except FileExistsError: print('NOT ADMITTED: Main415 final try already used'); sys.exit(75)
elif now>=1791098400: print('NOT ADMITTED: final fresh-load try expired07:20Z'); sys.exit(75)
lab=e/('main406-'+str(int(now))); lab.mkdir()
for d in ['home','tmp','config','cache','data','state','runtime','shots']: (lab/d).mkdir()
node='/home/umer/.local/share/mise/installs/node/24.21.0'
cmd=['/usr/bin/bwrap','--die-with-parent','--ro-bind','/','/','--tmpfs','/home/umer','--ro-bind',repo,repo,'--tmpfs','/opt','--ro-bind',node,'/opt/task-node','--bind',str(lab),str(lab),'--tmpfs','/tmp','--bind',str(lab),'/tmp/ch-proof','--tmpfs','/run','--dev','/dev','--proc','/proc','--unshare-ipc','--unshare-uts','--chdir',repo,'/bin/bash','-c','node --version && npm run check && node --test --test-concurrency=1 test/office.test.ts test/teach.test.ts']
inside=pathlib.Path('/tmp/ch-proof')
env={'HOME':str(inside/'home'),'TMPDIR':str(inside/'tmp'),'PATH':'/opt/task-node/bin:/usr/bin:/bin','MISE_OFFLINE':'1','CREWHOUSE_ENGINE':'stub','OFFICE_SHOTS':str(inside/'shots'),'DBUS_SESSION_BUS_ADDRESS':'unix:path='+str(inside/'no-bus')}
for k,d in [('CONFIG','config'),('CACHE','cache'),('DATA','data'),('STATE','state'),('RUNTIME_DIR','runtime')]: env['XDG_'+(k if k=='RUNTIME_DIR' else k+'_HOME')]=str(inside/d)
record={'began':now,'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now)),'load1':load,'admission_limit':40,'forced':forced,'low_load_only':'--low-load-only' in sys.argv,'authority':'Main415 explicit final try' if forced else 'Main406 budget2 fresh<40 only','budget_seconds':360,'work_seconds':330,'cleanup_reserve_seconds':30,'command':cmd,'env':env,'base':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'signals':[],'errors':[]}
record['source_sha256']={f:hashlib.sha256((pathlib.Path(repo)/f).read_bytes()).hexdigest() for f in ['test/browser.ts','test/office.test.ts','test/teach.test.ts']}
record['runner_sha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
def save(name):
 tmp=lab/(name+'.new')
 with tmp.open('w') as out: out.write(json.dumps(record,indent=2)); out.flush(); os.fsync(out.fileno())
 os.replace(tmp,lab/name)
 fd=os.open(lab,os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
save('admission.json'); print('ADMITTED',str(lab),load,flush=True)
def ident(pid):
 try:
  a=pathlib.Path('/proc/'+str(pid)+'/stat').read_text(); f=a[a.rfind(')')+2:].split(); return {'pid':pid,'parent':int(f[1]),'start':f[19],'state':f[0]}
 except (FileNotFoundError,ProcessLookupError): return None
owned={}; excluded={os.getpid(),os.getppid()}
record['excluded_pids']=sorted(excluded)
def same(p):
 current=ident(p['pid']); return current if current and current['start']==p['start'] else None
def survivors(): return [current for p in owned.values() if (current:=same(p))]
def track():
 # Only children of witnessed live owned identities, including children of their threads.
 todo=list(owned.values()); changed=False
 while todo:
  parent=todo.pop()
  if not same(parent): continue
  try:
   threads=list(pathlib.Path('/proc/'+str(parent['pid'])+'/task').iterdir())
  except (FileNotFoundError,ProcessLookupError): continue
  for thread in threads:
   try: children=(thread/'children').read_text().split()
   except (FileNotFoundError,ProcessLookupError): continue
   for raw in children:
    pid=int(raw)
    if pid in owned: continue
    child=ident(pid)
    if child and child['parent']==parent['pid'] and same(parent):
     owned[pid]=child; todo.append(child); changed=True
     record['owned']=list(owned.values()); save('ownership.json')
 if changed: record['last_ancestry_at']=time.time()
def send_owned(sig):
 # pidfd pins the witnessed process: never a PID/group/cwd/session guess or an ancestor signal.
 for p in reversed(list(owned.values())):
  if p['pid']<=0 or p['pid'] in excluded: raise RuntimeError('unsafe cleanup target')
  fd=None
  try:
   if not same(p): continue
   fd=os.pidfd_open(p['pid'])
   if not same(p): continue
   entry={'pid':p['pid'],'start':p['start'],'signal':sig,'at':time.time(),'state':'pending'}
   record['signals'].append(entry); save('ownership.json')
   signal.pidfd_send_signal(fd,sig); entry['state']='sent'; save('ownership.json')
  except (FileNotFoundError,ProcessLookupError): pass
  except OSError as error:
   record['errors'].append('signal: '+repr(error)); save('ownership.json')
  finally:
   if fd is not None: os.close(fd)
p=None; cutoff=False
try:
 with (lab/'tests.log').open('w') as out:
  p=subprocess.Popen(cmd,env=env,stdout=out,stderr=subprocess.STDOUT)
  root=ident(p.pid)
  if root is None or root['parent']!=os.getpid():
   record['identity_gap']=True
   raise RuntimeError('runner positive PID/starttime/parent ownership not witnessed')
  owned[p.pid]=root; record['root']=root; record['owned']=list(owned.values()); save('ownership.json')
  deadline=time.monotonic()+max(0,330-(time.time()-now))
  while p.poll() is None and time.monotonic()<deadline:
   track(); time.sleep(.1)
  cutoff=p.poll() is None
  record['cutoff']=cutoff; record['before_fallback']=survivors(); save('ownership.json')
except Exception as error:
 record['errors'].append(repr(error)); record['identity_gap']=True; save('ownership.json')
finally:
 try:
  left=survivors()
  if left:
   # Even successful tests with leftover witnessed children are a failed cleanup, never a passing fallback.
   record['cleanup_fallback']=True; record['before_fallback']=left; save('ownership.json')
   send_owned(signal.SIGTERM)
   end=time.monotonic()+10
   while survivors() and time.monotonic()<end:
    if p: p.poll()
    time.sleep(.1)
   if survivors(): send_owned(signal.SIGKILL)
   end=time.monotonic()+10
   while survivors() and time.monotonic()<end:
    if p: p.poll()
    time.sleep(.1)
  readback=[]
  for witnessed in owned.values():
   current=ident(witnessed['pid'])
   readback.append({'recorded':witnessed,'current':current,'account':'same identity present' if current and current['start']==witnessed['start'] else ('different identity' if current else 'absent')})
  record['final_identity_readback']=readback
  record['known_survivors']=[row['current'] for row in readback if row['account']=='same identity present']
  record['survivors']='UNKNOWN' if record.get('identity_gap') else record['known_survivors']
 except Exception as error:
  record['errors'].append('final census: '+repr(error)); record['survivors']='UNKNOWN'
 record.update({'finished':time.time(),'exit':p.poll() if p else None,'cutoff':cutoff,'owned':list(owned.values())})
 save('result.json'); print(json.dumps(record),flush=True)
failed=cutoff or record['errors'] or record.get('cleanup_fallback') or record['survivors'] or record['exit']!=0
sys.exit(1 if failed else 0)
