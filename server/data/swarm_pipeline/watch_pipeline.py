import time, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
time.sleep(240)
os.chdir(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0')
r = subprocess.run('cmd /c dir /o-d server\\data\\swarm_state', capture_output=True, text=True)
lines = [l for l in r.stdout.splitlines() if 'batch' in l][:10]
print('\n'.join(lines))
r2 = subprocess.run('tasklist /FI "PID eq 20852"', capture_output=True, text=True)
print([l for l in r2.stdout.splitlines() if 'python' in l])
print('desktop poem exists:', os.path.exists(r'C:\Users\Administrator\Desktop\朱峰智能体之春.txt'))
