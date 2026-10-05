import pathlib,time,os,json,hashlib,subprocess,sys
repo=pathlib.Path(__file__).resolve().parent.parent
status=pathlib.Path('/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/state/ch-safe-suite-source.status')
config=pathlib.Path('/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/config')
runner=repo/'.task-evidence/qualify-main406.py'
expected='969bccc81ec9b84959ac9454a3d72c125b224673273329efaef570d83b24e43b'
observations=[]
next_check=1791096021 # 2026-10-04T06:40:21Z, 15min after last diagnostic load observation.
deadline=1791098421 # 2026-10-04T07:20:21Z; stay inside new 1.2h outcome target.
def notify(state,message):
 with status.open('a') as out: out.write(f'{state} [at={int(time.time())}]: {message}\n')
 if (config/'fleet-ledger').exists():
  subprocess.run(['/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/bin/fm-fleet-ledger.sh','appended',str(config),str(status)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
while time.time()<deadline:
 while time.time()<next_check and time.time()<deadline: time.sleep(min(1,max(0,next_check-time.time())))
 if time.time()>=deadline: break
 load=os.getloadavg()[0]; observations.append({'at':time.time(),'load1':load}); print(json.dumps(observations[-1]),flush=True)
 (repo/'.task-evidence/main406-admission-wait.json').write_text(json.dumps(observations,indent=2))
 if load<40:
  inbox=pathlib.Path('/home/umer/.treehouse/firstmate-8bf1b0/3/firstmate/state/ch-safe-suite-source.inbox')
  if list(inbox.glob('*.msg')):
   notify('blocked','Steer pending before final proof; monitor exits without launch. .task-evidence/main406-admission-wait.json'); sys.exit(75)
  for line in (repo/'.task-evidence/recovery-source.sha256').read_text().splitlines():
   digest,name=line.split(maxsplit=1)
   if hashlib.sha256((repo/name).read_bytes()).hexdigest()!=digest:
    notify('blocked','Candidate source changed; final proof not launched. .task-evidence/main406-admission-wait.json'); sys.exit(1)
  if hashlib.sha256(runner.read_bytes()).hexdigest()!=expected:
   notify('blocked','Final proof runner changed after readback; no launch. .task-evidence/main406-admission-wait.json'); sys.exit(1)
  with (repo/'.task-evidence/main406-attempt2.log').open('a') as out:
   result=subprocess.run(['python3',str(runner),'--low-load-only'],cwd=repo,stdout=out,stderr=subprocess.STDOUT)
  if result.returncode!=75:
   notify('working',f'Final Main406 proof process returned{result.returncode}; inspect retained result before any claim. .task-evidence/main406-attempt2.log')
   sys.exit(result.returncode)
 next_check+=900
notify('blocked','Fresh<40 final diagnostic admission did not clear by07:20:21Z; no final heavy attempt. .task-evidence/main406-admission-wait.json')
sys.exit(75)
