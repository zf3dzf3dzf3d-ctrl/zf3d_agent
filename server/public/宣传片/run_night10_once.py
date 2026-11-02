# -*- coding: utf-8 -*-
"""带互斥锁的夜间批产启动器：确保全机只有一个 gen_night10 实例（无头、关窗存活）。
用法: python.exe run_night10_once.py  （或由 run_night10.vbs 调起）
"""
import sys, os, time, subprocess

ROOT = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片"
LOCK = os.path.join(ROOT, "night10.lock")
LOG = os.path.join(ROOT, "night10_launcher_log.txt")
TARGET = os.path.join(ROOT, "gen_night10.py")
PY = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\python\python.exe"


def log(msg):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write("[%s] %s\n" % (time.strftime("%m-%d %H:%M:%S"), msg))


def other_running():
    """按命令行找其他 gen_night10 实例（排除自己）"""
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match 'gen_night10'} | Select-Object -ExpandProperty ProcessId"],
            capture_output=True, text=True, timeout=20)
        pids = [int(x) for x in out.stdout.split() if x.strip().isdigit()]
        me = os.getpid()
        return [p for p in pids if p != me]
    except Exception as e:
        log("check err: %r" % e)
        return []


def main():
    # 清掉可能残留的陈旧锁（进程不存在才算陈旧）
    if os.path.exists(LOCK):
        try:
            old = int(open(LOCK).read().strip())
            os.kill(old, 0)  # 还活着？
            log("already running pid=%s, exit" % old)
            return
        except Exception:
            os.remove(LOCK)
            log("removed stale lock")
    with open(LOCK, "w") as f:
        f.write(str(os.getpid()))
    try:
        dup = other_running()
        for p in dup:
            try:
                os.kill(p, 9)
                log("killed duplicate pid=%s" % p)
            except Exception:
                pass
        log("launching gen_night10")
        r = subprocess.run([PY, "-X", "utf8", TARGET], timeout=3600)
        log("gen_night10 rc=%s" % r.returncode)
    except Exception as e:
        log("ERR %r" % e)
    finally:
        if os.path.exists(LOCK):
            os.remove(LOCK)


if __name__ == "__main__":
    main()
