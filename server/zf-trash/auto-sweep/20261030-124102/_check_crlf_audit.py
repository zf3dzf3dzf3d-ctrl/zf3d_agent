# -*- coding: utf-8 -*-
import subprocess, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
base = os.path.join('\u624b\u673a\u7248','bridge','termux')  # 手机版
files = ['crontab.txt','boot_bridge.sh','watchdog_bridge.sh','morning_report.sh','sync_memory.sh','install.sh']
print('=== HEAD CRLF ===')
for f in files:
    p = base + '/' + f
    try:
        d = subprocess.check_output(['git','show','HEAD:'+p])
        print(f.ljust(22), 'in_HEAD CRLF=', d.count(b'\r\n'))
    except Exception:
        print(f.ljust(22), 'NOT_IN_HEAD')
print('=== WORKDIR CRLF ===')
for f in files:
    p = os.path.join(base, f)
    if os.path.exists(p):
        d = open(p,'rb').read()
        print(f.ljust(22), 'CRLF=', d.count(b'\r\n'))
    else:
        print(f.ljust(22), 'NO_FILE')
print('=== git status termux ===')
st = subprocess.check_output(['git','status','--short','--',base]).decode('utf-8','replace')
print(st.strip() or '(clean)')
print('=== crontab content ===')
print(open(os.path.join(base,'crontab.txt'),'rb').read().decode('utf-8','replace'))
