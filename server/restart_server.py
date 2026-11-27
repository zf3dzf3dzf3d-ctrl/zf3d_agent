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
MAX_LOG_BYTES = 5 * 1024 * 1024  # 日志上限：每次重启时检查，超过即轮转（保留一代 .1）

# 【P1 退出×重启复活拦截 2026-11-23】托盘"关闭"退出时写入 private/.app_quit_flag
# （内容=时间戳）。本脚本在任何拉起动作前检查：120 秒内的旗标 = 用户刚主动退出，
# 一律放弃拉起（idle_auto_restart / network_guard / 升级检查等自动触发源不得把
# 用户已退出的应用"复活"）。确认放弃后删除旗标；正常重启完成后也随手清理过期旗标。
QUIT_FLAG_FILE = os.path.join(BASE_DIR, 'private', '.app_quit_flag')
QUIT_FLAG_TTL = 120  # 秒

AUTO = '--auto' in sys.argv


def _quit_flag_age():
    """托盘退出旗标的年龄（秒）；无旗标返回 None。"""
    try:
        return time.time() - os.path.getmtime(QUIT_FLAG_FILE)
    except OSError:
        return None


def _clear_quit_flag():
    """仅在确认放弃拉起 / 旗标已过期时删除；无旗标时静默。"""
    try:
        if os.path.exists(QUIT_FLAG_FILE):
            os.remove(QUIT_FLAG_FILE)
    except OSError:
        pass


def rotate_log_if_large():
    """日志超限轮转（保留一代 .log.1）。调用时机在 kill_old 之后：旧 server 已退出、
    stdout 句柄已释放，改名安全。改名失败（句柄偶发未释放）退化为截断，保证不无限增长。
    【工程化整改 20261123】此前 append 永不轮转，实测涨到 28MB。"""
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_BYTES:
            try:
                rotated = LOG_FILE + '.1'
                if os.path.exists(rotated):
                    os.remove(rotated)
                os.replace(LOG_FILE, rotated)
            except OSError:
                with open(LOG_FILE, 'wb'):
                    pass  # 截断兜底
    except Exception:
        pass


def log(msg):
    line = '[%s] %s' % (time.strftime('%H:%M:%S'), msg)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8', errors='replace') as f:
            f.write(line + '\n')
    except Exception:
        pass


def _create_lock_excl():
    """原子建锁（O_CREAT|O_EXCL 由内核保证唯一）；成功返回 True。"""
    try:
        fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            os.write(fd, str(os.getpid()).encode('utf-8'))
        finally:
            os.close(fd)
        return True
    except OSError:
        return False


def acquire_lock():
    """A1 并发锁：已有重启在跑就直接退出，防止连点/看门狗并发互杀。
    【P1 修复 2026-11-23】改用 os.open(O_CREAT|O_EXCL) 原子建锁：旧实现
    "exists→查龄→open('w') 截断" 存在 TOCTOU 竞态——两个进程可同时判定旧锁过期、
    先后截断同一文件、双双持锁互杀。O_EXCL 下同一时刻只有一个进程能创建成功；
    过期锁先删除再重试一次原子创建，重试仍失败即让路。"""
    if _create_lock_excl():
        return True
    try:
        age = time.time() - os.path.getmtime(LOCK_FILE)
    except OSError as e:
        # 锁存在但查不到属性（权限/竞态删除）→ 按"有锁"处理，宁可让路
        log('锁龄检查失败（按有锁处理）: %s' % e)
        return False
    if age < 60:  # 60 秒内的锁视为有效（正常重启远小于 60s）
        log('已有重启进程在执行（锁龄 %.0fs），本次退出' % age)
        return False
    log('发现过期锁（%.0fs），清除后重试原子建锁' % age)
    try:
        os.remove(LOCK_FILE)
    except OSError as e:
        log('过期锁删除失败（按有锁处理）: %s' % e)
        return False
    if _create_lock_excl():
        return True
    log('过期锁清除后被其他进程抢先持锁，本次退出')
    return False


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

# 【P0 修复 2026-11-25】AI 代理网关纳入重启范围：此前重启只杀 server.py，ai_proxy.py
# 是 server_runtime._ensure_ai_proxy 拉起的常驻代理（auto-start + 看门狗自愈），重启后
# 端口仍被【旧代码】的代理占着 → _ensure_ai_proxy 探活成功直接复用旧进程 → 改在
# ai_proxy/上游链路的代码重启后永不生效，用户体感"改了重启了也没变化"。
# 方案：重启时先精确杀掉本项目 ai_proxy 进程（端口 ai_proxy_port + 命令行含 ai_proxy.py），
# server.py 新进程启动时 _ensure_ai_proxy 探不到代理 → 自动拉起新代码的代理。


def get_proxy_port():
    """读 private/port.json 的 ai_proxy_port（BOM 兼容），缺省 0 = 不处理代理。"""
    try:
        with open(PORT_JSON, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('ai_proxy_port') or 0)
    except Exception:
        return 0


def find_proxy_pid():
    """精确找到监听 ai_proxy_port 且命令行含 ai_proxy.py 的进程 PID；找不到返回 None。
    双重过滤防误杀：端口 + 命令行子串，均命中才杀。"""
    pport = get_proxy_port()
    if not pport:
        return None
    try:
        r = subprocess.run(['netstat', '-ano', '-p', 'TCP'],
                           capture_output=True, timeout=8,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = r.stdout.decode('gbk', errors='replace')
    except Exception as e:
        log('netstat(代理) 失败: %s' % e)
        return None
    pids = set()
    for ln in out.splitlines():
        parts = ln.split()
        if len(parts) >= 5 and parts[0].upper() == 'TCP' and parts[3].upper() == 'LISTENING':
            try:
                port = int(parts[1].rsplit(':', 1)[1])
            except (ValueError, IndexError):
                continue
            if port == pport:
                try:
                    pids.add(int(parts[4]))
                except ValueError:
                    pass
    for pid in pids:
        if pid == 0:
            continue
        cmd = get_cmdline(pid)
        if cmd and 'ai_proxy.py' in cmd.lower():
            return pid
    return None


def kill_proxy():
    """重启前杀掉旧 ai_proxy（不在册常驻进程）。找不到/杀失败都只记日志不阻断——
    server.py 新进程的 _ensure_ai_proxy 兜底逻辑自己会处理代理缺失。"""
    try:
        ppid = find_proxy_pid()
        if not ppid:
            log('AI 代理：未发现运行中的 ai_proxy（跳过）')
            return
        _hard_kill(ppid)
        log('旧 AI 代理已停止 PID=%s（新 server 启动时将自动拉起新代码代理）' % ppid)
        # 给端口释放一点时间，避免 _ensure_ai_proxy 探活时旧代理还没完全退场
        deadline = time.time() + 5
        while time.time() < deadline:
            if find_proxy_pid() is None:
                break
            time.sleep(0.3)
    except Exception as e:
        log('AI 代理停止失败（不阻断重启，server 兜底自愈）: %s' % e)


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
        # 【防误杀托盘 2026-11-22】'tray_server.py' 字符串本身就包含子串 'server.py'，
        # 旧匹配会把托盘进程当成"旧后台服务"——杀了它 = Shell_NotifyIcon 来不及注销，
        # 右下角留下死图标 + relaunch_tray 再画新图标 = 「两个朱峰图标」的直接根源。
        # 托盘进程（无论是否托管后台）绝不作为杀旧目标。
        if 'tray_server.py' in cmd:
            continue
        if 'server.py' in cmd and 'restart_server' not in cmd:
            return pid
    # A2 端口兜底：命令行匹配不上（如经 py.exe 启动）时，只要该 PID
    # 独占监听本项目端口，就视为旧服务器进程（端口本身就是强证据），
    # 否则旧进程杀不掉 → 新进程端口占用起不来 → 重启假成功/失败。
    if len(candidate_pids) == 1:
        # 【防误杀托盘】唯一监听者是托盘进程（旧版线程托管遗留场景）时绝不能杀：
        # 杀托盘 = 图标来不及注销留死图标。此时按"未找到旧后台"交上层处理。
        only = candidate_pids[0]
        cmd = get_cmdline(only)
        if cmd is not None and 'tray_server.py' in cmd.lower():
            log('唯一监听 PID=%s 是托盘进程（tray_server），跳过杀旧（防死图标）' % only)
            return None
        log('命令行未匹配到 server.py，按端口监听兜底 PID=%s' % only)
        return only
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
    rotate_log_if_large()
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
        # 【P1 修复 2026-11-23】加锁失败必须落结果文件：前端按 .restart_result.json
        # 判定成败，不写会让重启按钮永远停在"重启中"。
        write_result(False, '另一重启进行中')
        return 0
    # 【P1 退出×重启复活拦截】用户刚通过托盘"关闭"退出（120 秒内）→ 放弃拉起。
    # 命中即写结果文件让前端可见，并删除旗标（确认放弃后清理）。
    _qf_age = _quit_flag_age()
    if _qf_age is not None and _qf_age < QUIT_FLAG_TTL:
        log('检测到用户 %.0f 秒前已通过托盘退出，放弃本次拉起（防复活）' % _qf_age)
        write_result(False, '用户已退出')
        _clear_quit_flag()
        return 0
    ok = False
    try:
        # 顺序要义：先杀 server（其内部代理看门狗随之消失）→ 再杀 ai_proxy 常驻进程
        # → 最后拉新。若先杀代理，旧 server 的看门狗可能在窗口期把旧代码代理重新拉起。
        kill_old()
        kill_proxy()   # 【P0 2026-11-25】停掉旧 ai_proxy，让新 server 自动拉新代码代理
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
        # 【P1 退出×重启复活拦截】二次检查：退出发生在重启过程中（如优雅关停期间用户
        # 点了托盘关闭）→ 不复活托盘；未命中旗标则顺手清理 >120s 的过期旗标。
        try:
            _qf_age2 = _quit_flag_age()
            if _qf_age2 is not None and _qf_age2 < QUIT_FLAG_TTL:
                log('重启过程中检测到用户已退出（%.0f 秒前），跳过托盘拉起（防复活）' % _qf_age2)
                _clear_quit_flag()
            else:
                _clear_quit_flag()  # 过期旗标（>120s）随手清理；无旗标时为空操作
                # AUTO 仅作日志/语义标记；relaunch_tray 现行逻辑已统一为
                # 「检测→1.5秒复查→存活即跳过」，手动/自动路径防重复图标一致。
                relaunch_tray()
        except Exception as e:
            log('拉起托盘异常: %s' % e)
        release_lock()


if __name__ == '__main__':
    sys.exit(main())
