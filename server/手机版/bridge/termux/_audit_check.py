# -*- coding: utf-8 -*-
import subprocess, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
os.chdir(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0')
files = ['crontab.txt','boot_bridge.sh','watchdog_bridge.sh','morning_report.sh','sync_memory.sh','install.sh']
print('=== HEAD CRLF ===')
for f in files:
    p = '手机版/bridge/termux/' + f
    try:
        d = subprocess.check_output(['git','show','HEAD:'+p])
        print(f.ljust(22), 'in_HEAD CRLF=', d.count(b'\r\n'))
    except Exception:
        print(f.ljust(22), 'NOT_IN_HEAD')
print('=== WORKDIR CRLF ===')
for f in files:
    p = '手机版/bridge/termux/' + f
    if os.path.exists(p):
        d = open(p,'rb').read()
        print(f.ljust(22), 'CRLF=', d.count(b'\r\n'))
    else:
        print(f.ljust(22), 'NO_FILE')
print('=== git status termux ===')
st = subprocess.check_output(['git','status','--short','--','手机版/bridge/termux/']).decode('utf-8','replace')
print(st.strip() or '(clean)')
print('=== crontab content ===')
ct = open('手机版/bridge/termux/crontab.txt','rb').read().decode('utf-8','replace')
print(ct)
