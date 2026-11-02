# -*- coding: utf-8 -*-
"""等待版启动器：等 gen_pixel.py（早上18张任务）结束后再跑 gen_pixel80.py。
防多开：pixel80.lock；每 60 秒检查一次 gen_pixel.py 是否仍在运行。
"""
import os, time, subprocess, sys, io

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK = os.path.join(HERE, "pixel80.lock")
WAIT_LOG = os.path.join(HERE, "pixel80_wait_log.txt")

if os.path.exists(LOCK):
    sys.exit(0)  # 已有实例在跑/等待，防多开
with io.open(LOCK, "w") as f:
    f.write(str(os.getpid()))


def wlog(m):
    with io.open(WAIT_LOG, "a", encoding="utf-8") as f:
        f.write("[%s] %s\n" % (time.strftime("%m-%d %H:%M:%S"), m))


def pixel_running():
    r = subprocess.run(['wmic', 'process', 'where', "name like 'python%'",
                        'get', 'processid,commandline'],
                       capture_output=True, text=True, timeout=25,
                       encoding='gbk', errors='replace')
    for ln in (r.stdout or '').splitlines():
        low = ln.lower()
        if 'gen_pixel.py' in low and 'pixel80' not in low and 'sentinel' not in low:
            return True
    return False


wlog("wait for gen_pixel.py to finish...")
while pixel_running():
    time.sleep(60)
wlog("gen_pixel.py finished, launching gen_pixel80.py")
try:
    subprocess.call([sys.executable, "-X", "utf8",
                     os.path.join(HERE, "gen_pixel80.py")])
finally:
    os.remove(LOCK)
    wlog("gen_pixel80.py done, lock released")
