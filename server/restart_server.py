# -*- coding: utf-8 -*-
"""
restart_server.py — 无感一键重启后台（精简重做版）
====================================================
目标：快、静默、真正能拉起后台。

设计（相对旧版的改进）：
1. 不再跑 cleanup_stale_python.ps1（旧版慢的最大来源，动辄 15 秒超时强杀）。
   改为直接精确定位旧 server.py 的 PID，taskkill /T 精确杀掉，不误伤其他 python。
2. 不做 60 秒冷却阻塞（限流放在前端，双击防抖即可）。
3. 拉起新后台后用 /api/health 轮询确认（最多 30 秒），成功即退出，
   把结果写到 .restart_result.json 供前端读取。

用法:
  python restart_server.py            # 默认: --manual --force（前端按钮用）
  python restart_server.py --auto     # 看门狗用
"""

import os
import sys
import json
import time
import subprocess
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')
SERVER_PY = os.path.join(SERVER_DIR, 'server.py')
PORT_JSON = os.path.join(BASE_DIR, 'private', 'port.json')
RESULT_FILE = os.path.join(SERVER_DIR, '.restart_result.json')
LOG_FILE = os.path.join(SERVER_DIR, '.restart_out.log')
LOCK_FILE = os.path.join(SERVER_DIR, '.restart_lock')

AUTO = '--auto' in sys.argv


def log(msg):
    line = '[%s] %s' % (time.strftime('%H:%M:%S'), msg)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8', errors='replace') as f:
            f.write(line + '\n')
    except Exception:
        pass


def acquire_lock():
    """A1 并发锁：已有重启在跑就直接退出，防止连点/看门狗并发互杀。"""
    try:
        if os.path.exists(LOCK_FILE):
            age = time.time() - os.path.getmtime(LOCK_FILE)
            if age < 60:  # 60 秒内的锁视为有效（正常重启远小于 60s）
                log('已有重启进程在执行（锁龄 %.0fs），本次退出' % age)
                return False
            log('发现过期锁（%.0fs），清除后继续' % age)
        with open(LOCK_FILE, 'w', encoding='utf-8') as f:
            f.write(str(os.getpid()))
        return True
    except Exception as e:
        log('加锁异常（不阻塞重启）: %s' % e)
        return True


def release_lock():
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except Exception:
        pass


def get_port():
    """读 private/port.json。历史坑：该文件的实际键名是 api_port（PowerShell 写入），
    旧代码读 'port' 永远取不到 → 回退 8000 → 一键重启找不到旧进程、健康检查
    打错端口，表现为"重启失败/卡死旧实例杀不掉"。兼容读 api_port > port。"""
    try:
        with open(PORT_JSON, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('api_port') or cfg.get('port') or 8000)
    except Exception:
        return 8000


PORT = get_port()
HEALTH_URL = 'http://127.0.0.1:%d/api/health' % PORT


def find_server_pid():
    """精确找到监听当前端口的 server.py 进程 PID（netstat）。"""
    try:
        r = subprocess.run(['netstat', '-ano', '-p', 'TCP'],
                           capture_output=True, timeout=8)
        out = r.stdout.decode('gbk', errors='replace')
    except Exception as e:
        log('netstat 失败: %s' % e)
        return None
    pids = set()
    for ln in out.splitlines():
        parts = ln.split()
        # TCP  127.0.0.1:8000  0.0.0.0:0  LISTENING  1234
        if len(parts) >= 5 and parts[0].upper() == 'TCP' and parts[3].upper() == 'LISTENING':
            try:
                port = int(parts[1].rsplit(':', 1)[1])
            except (ValueError, IndexError):
                continue
            if port == PORT:
                try:
                    pids.add(int(parts[4]))
                except ValueError:
                    pass
    if not pids:
        return None
    # 过滤：PID 必须是本项目的 python（命令行含 server.py），避免误杀
    candidate_pids = [p for p in pids if p != 0]
    for pid in candidate_pids:
        cmd = get_cmdline(pid)
        if cmd is None:
            # wmic/PowerShell 均不可用时保守跳过
            continue
        cmd = cmd.lower()
        if 'server.py' in cmd and 'restart_server' not in cmd:
            return pid
    # A2 端口兜底：命令行匹配不上（如经 py.exe 启动）时，只要该 PID
    # 独占监听本项目端口，就视为旧服务器进程（端口本身就是强证据），
    # 否则旧进程杀不掉 → 新进程端口占用起不来 → 重启假成功/失败。
    if len(candidate_pids) == 1:
        log('命令行未匹配到 server.py，按端口监听兜底 PID=%s' % candidate_pids[0])
        return candidate_pids[0]
    return None


def get_cmdline(pid):
    """查询进程命令行：优先 wmic，Win11 新版无 wmic 时用 PowerShell 兜底。"""
    # 兜底：PowerShell Get-CimInstance（wmic 优先会拖慢：新版 Win11 无 wmic 时
    # 每次都要先失败一次再走 PS，逐 PID 叠加可达数十秒，曾在退出窗口内卡死）。
    try:
        ps = ("Get-CimInstance Win32_Process -Filter \"ProcessId=%d\" "
              "| Select-Object -ExpandProperty CommandLine" % pid)
        r = subprocess.run(
            ['powershell', '-NoProfile', '-Command', ps],
            capture_output=True, timeout=10)
        if r.returncode == 0:
            return r.stdout.decode('gbk', errors='replace')
    except Exception:
        pass
    return None


def kill_old():
    pid = find_server_pid()
    if not pid:
        log('未找到旧后台进程（可能已退出）')
        return None
    try:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)],
                       capture_output=True, timeout=10)
        log('已停止旧后台 PID=%s' % pid)
    except Exception as e:
        log('taskkill 失败: %s' % e)
    # 等端口释放（最多 5 秒）
    for _ in range(10):
        if find_server_pid() is None:
            break
        time.sleep(0.5)
    return pid


def start_new():
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW \
        if sys.platform == 'win32' else 0
    out = open(LOG_FILE, 'ab')
    p = subprocess.Popen(
        [sys.executable, SERVER_PY],
        cwd=SERVER_DIR,
        stdout=out, stderr=subprocess.STDOUT,
        creationflags=flags, close_fds=True,
    )
    log('新后台已拉起 PID=%s' % p.pid)
    return p


def wait_up(timeout=30):
    """健康检查：只要 /api/health 通了就算成功。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as r:
                if r.status == 200:
                    log('后台已恢复（健康检查通过）')
                    return True
        except Exception:
            pass
        time.sleep(0.8)
    log('超时 %ds 后台仍未恢复' % timeout)
    return False


def write_result(ok, detail):
    try:
        with open(RESULT_FILE, 'w', encoding='utf-8') as f:
            json.dump({'ok': ok, 'detail': detail, 'time': time.time()}, f)
    except Exception:
        pass


def main():
    t0 = time.time()
    log('===== 无感重启开始 (auto=%s) =====' % AUTO)
    if not acquire_lock():
        return 0
    try:
        kill_old()
        start_new()
        ok = wait_up(30)
        write_result(ok, 'restart took %.1fs' % (time.time() - t0))
        log('===== 重启%s，耗时 %.1f 秒 =====' % ('成功' if ok else '失败', time.time() - t0))
        return 0 if ok else 1
    finally:
        release_lock()


if __name__ == '__main__':
    sys.exit(main())
