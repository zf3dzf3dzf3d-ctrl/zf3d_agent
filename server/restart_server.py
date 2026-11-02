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
  python restart_server.py            # 默认行为：杀旧后台→拉新→健康检查→确保托盘（防重复）
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
                           capture_output=True, timeout=8, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
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
            capture_output=True, timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if r.returncode == 0:
            return r.stdout.decode('gbk', errors='replace')
    except Exception:
        pass
    return None


QUIT_URL_TMPL = 'http://127.0.0.1:%d/api/app/quit'


def _post_quit(port):
    """向旧后台发 /api/app/quit 触发 server 优雅关停（停热更新→记忆库 git 快照→shutdown）。
    成功投递返回 True；网络异常返回 False（交由上层兜底强杀）。"""
    try:
        req = urllib.request.Request(QUIT_URL_TMPL % port, method='POST', data=b'')
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status == 200
    except Exception as e:
        log('POST /api/app/quit 失败: %s' % e)
        return False


def _wait_port_released(timeout=15):
    """轮询等待监听端口释放（旧进程完成优雅关停并退出）。释放返回 True，超时返回 False。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if find_server_pid() is None:
            return True
        time.sleep(0.4)
    return False


def _hard_kill(pid):
    """兜底强杀（仅在优雅关停失败/卡死时调用）。"""
    try:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(pid)],
                       capture_output=True, timeout=10,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        log('已强制结束旧后台 PID=%s' % pid)
    except Exception as e:
        log('taskkill 失败: %s' % e)


def kill_old():
    """停止旧后台。【P1-B1 优雅化】旧版直接 taskkill /F /T 硬杀，绕过 server 自身优雅关停，
    导致重启时记忆库快照（run_autosave）根本不执行——重启丢失未落盘的内存态。
    新版：先 POST /api/app/quit 触发优雅关停（含 git 快照），轮询等端口释放；
    仅当优雅关停失败或看门狗卡死超时，才回退 taskkill 强杀，保证重启一定成功。"""
    pid = find_server_pid()
    if not pid:
        log('未找到旧后台进程（可能已退出）')
        return None
    # 1) 先请求优雅关停（走 autosave 快照）
    graceful_ok = _post_quit(PORT)
    if graceful_ok and _wait_port_released(timeout=15):
        log('旧后台 PID=%s 已优雅关停（记忆库快照已落盘）' % pid)
        return pid
    # 2) 优雅关停失败/卡死 → 兜底强杀，再等端口释放
    if graceful_ok:
        log('优雅关停超时未释放端口，回退强杀 PID=%s' % pid)
    else:
        log('优雅关停请求失败，直接强杀 PID=%s' % pid)
    _hard_kill(pid)
    # 强杀后再给端口释放一点时间（TIME_WAIT 等）
    _wait_port_released(timeout=8)
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


def wait_up(timeout=30, expect_pid=None):
    """健康检查：/api/health 通了且监听端口 PID == 新进程 PID 才算成功。
    【P0-B2 防假重启】server.py 启动时若发现端口已被健康实例占用，会"复用已有实例并
    sys.exit(0)"。当 kill_old 没把旧进程杀干净时，新进程会主动让位退出，端口上仍是旧进程——
    仅探 health==200 会把旧进程误判为新进程成功，报"重启成功"实为假重启。增加 PID 校验堵死此路径。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as r:
                if r.status == 200:
                    if expect_pid is not None:
                        cur = find_server_pid()
                        if cur is not None and cur != expect_pid:
                            log('健康检查通过但监听 PID=%s ≠ 新进程 PID=%s'
                                '（旧进程未杀净、新进程已让位复用）→ 判定重启失败' % (cur, expect_pid))
                            return False
                    log('后台已恢复（健康检查通过%s）' %
                        ('，PID 校验 OK=%s' % expect_pid if expect_pid else ''))
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


def _detect_tray_running():
    """检测是否已有 tray_server 进程在跑。
    必须按命令行精确匹配 tray_server，且限定进程名为 python/朱峰，排除 powershell /
    restart_server 自身命令行里出现的 'tray_server' 字面导致的自匹配误判。"""
    try:
        r = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match 'tray_server' -and $_.Name -match 'python|朱峰'} | Select-Object -ExpandProperty ProcessId"],
            capture_output=True, timeout=15,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = (r.stdout or b'').decode('gbk', errors='replace')
        return bool(out.strip())
    except Exception as e:
        log('托盘检测(powershell)失败，改用 wmic 兜底: %s' % e)
        try:
            r = subprocess.run(['wmic', 'process', 'where',
                                "name like '%%python%%' or name like '%%朱峰%%'",
                                'get', 'commandline'],
                               capture_output=True, timeout=10,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            out = (r.stdout or b'').decode('gbk', errors='replace')
            return ('tray_server' in out)
        except Exception as e2:
            log('托盘检测(wmic)也失败，按"未运行"处理: %s' % e2)
            return False


def relaunch_tray():
    """后台拉起成功后，确保托盘图标存在。【防双图标·终版】绝不在本脚本里杀任何
    存活的 tray_server，也绝不在检测到已有托盘时重复拉起（检测到就跳过=不建新图标）。
    唯一的竞态：交棒场景旧托盘 icon.stop()+os._exit(0) 后进程表消失有延迟，
    初检可能命中"正在退出的旧托盘"而误跳过 → 图标丢失。故初检命中后等 1.5 秒复查：
      - 复查仍在跑 = 真有活托盘（自动重启/前端重启路径旧托盘本就存活）→ 跳过，不建新图标；
      - 复查已消失 = 命中的是正在退出的旧托盘 → 由本脚本拉起新托盘。
    不再提供 force 杀旧托盘分支：杀旧拉新是双图标/图标闪失的直接根源。"""
    tray_py = os.path.join(SERVER_DIR, 'tray_server.py')
    if not os.path.exists(tray_py):
        return
    if _detect_tray_running():
        time.sleep(1.5)  # 等正在退出的旧托盘彻底消失再复查
        if _detect_tray_running():
            log('托盘进程仍在运行，跳过重复拉起（不新建图标）')
            return
        log('初检命中的 tray_server 已退出（旧托盘交棒自杀），现在拉起新托盘')
    try:
        # 优先沿用当前进程解释器本身：当它已是改名副本「朱峰智能体无限.exe」
        # （无控制台版，任务管理器显示中文进程名）时必须保留该名字，
        # 否则应用内重启后任务管理器名称会被打回 pythonw.exe，与改名目标冲突。
        # 仅当当前进程是原生 python.exe（带控制台）时，才尝试无控制台 pythonw.exe 兜底。
        cur_name = os.path.basename(sys.executable).lower()
        if cur_name == 'python.exe':
            cand = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
            exe = cand if os.path.exists(cand) else sys.executable
        else:
            exe = sys.executable
        flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.Popen([exe, tray_py], cwd=BASE_DIR, creationflags=flags)
        log('托盘进程已重新拉起')
    except Exception as e:
        log('拉起托盘失败: %s' % e)


def main():
    t0 = time.time()
    log('===== 无感重启开始 (auto=%s) =====' % AUTO)
    if not acquire_lock():
        return 0
    ok = False
    try:
        kill_old()
        new_proc = start_new()
        ok = wait_up(30, expect_pid=(new_proc.pid if new_proc else None))
        write_result(ok, 'restart took %.1fs' % (time.time() - t0))
        log('===== 重启%s，耗时 %.1f 秒 =====' % ('成功' if ok else '失败', time.time() - t0))
        return 0 if ok else 1
    finally:
        # 【修复·健壮性】无条件、且覆盖异常路径重新拉起托盘。
        # 旧逻辑 `if ok: relaunch_tray()` 在 wait_up 超时（DB 锁致 /api/health 卡死，
        # ok=False）时不拉托盘；而 _on_restart 已先 icon.stop()+os._exit(0) 关掉当前
        # 托盘 → 图标永久消失，表现为「点重启 = 把程序关掉」。
        # 进一步：relaunch_tray 若仍留在 try 内，kill_old/start_new/wait_up 任一抛硬异常
        # 会跳过它，同样丢图标。故移入 finally，并用 try 兜住 relaunch_tray 自身异常，
        # 确保无论成功/失败/异常图标都一定回来（relaunch_tray 自带单实例保险，不会重复拉）。
        try:
            # AUTO 仅作日志/语义标记；relaunch_tray 现行逻辑已统一为
            # 「检测→1.5秒复查→存活即跳过」，手动/自动路径防重复图标一致。
            relaunch_tray()
        except Exception as e:
            log('拉起托盘异常: %s' % e)
        release_lock()


if __name__ == '__main__':
    sys.exit(main())
