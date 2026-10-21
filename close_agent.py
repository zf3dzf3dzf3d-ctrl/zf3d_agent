import os, signal, subprocess
out = subprocess.check_output('tasklist', shell=True).decode(errors='ignore')
pids = []
for line in out.splitlines():
    parts = line.split()
    if len(parts) >= 2 and parts[0].lower() in ('python.exe', 'pythonw.exe'):
        pids.append(int(parts[1]))
for p in pids:
    try:
        os.kill(p, signal.SIGTERM)
        print('killed', p)
    except Exception as e:
        print('fail', p, e)
