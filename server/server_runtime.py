# -*- coding: utf-8 -*-
"""server_runtime — 运行时模块（自 server.py 拆出，2026-11-08 瘦身 ≤300 行 DoD）。

承载端口探活/旧实例清理/QuickEdit/AI代理拉起/停机看门狗/横幅/四阶段
boot-attach-postboot/优雅关停等运行期逻辑；server.py 仅保留引导入口。
对外兼容：tray_server 只用 server.main / server.request_shutdown（保持原样）。
"""
import os
import json
import sys
import socket
import time
import threading
import traceback

_HERE_RT = os.path.dirname(os.path.abspath(__file__))
if _HERE_RT not in sys.path:
    sys.path.insert(0, _HERE_RT)
_PROJECT_ROOT_RT = os.path.dirname(_HERE_RT)
if _PROJECT_ROOT_RT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT_RT)

from config import HOST, PORT, BASE_DIR, PUBLIC_DIR, PRIVATE_DIR, VERSION, QUIET_CONSOLE
from db import init_db
from server_runtime_shared import _bf_dbg, QuietHTTPServer, DBHandler
from util_log import get_logger

log = get_logger('server_runtime')

# 附属线路实例标记（routes_manager 拉起时注入）：
# ROUTE_INSTANCE 非空 = 附属实例 → 不写 pid、不启动 TTS/proxy 看门狗/广场WS 等附属服务
ROUTE_INSTANCE = os.environ.get('ROUTE_INSTANCE', '').strip()
IS_ROUTE = bool(ROUTE_INSTANCE)

def main():
    """内核引导（绞杀者 Step4 拆分：复用检查 → boot → attach → serve）"""
    _disable_console_quickedit()
    _phase_port_reuse()
    _phase_boot()
    _phase_attach()
    _phase_serve()

def _port_in_use():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1.5)
            return s.connect_ex((HOST, PORT)) == 0
    except Exception:
        return False


def _foreign_instance_alive():
    """【6.3 安装下线】端口上有健康服务但 base_dir 不是本项目 = 旧版本实例。
    返回旧实例 base_dir（字符串），否则 None。探测失败一律视为非旧版（返回 None），
    宁可走「陌生进程不强杀」也不误下线。"""
    try:
        import urllib.request
        with urllib.request.urlopen(f'http://{HOST}:{PORT}/api/hot-reload/status', timeout=2.5) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
        status = payload.get('status') or {}
        actual = os.path.abspath(status.get('base_dir', ''))
        if payload.get('ok') is True and actual and actual != os.path.abspath(BASE_DIR):
            return actual
    except Exception:
        return None
    return None


def _retire_foreign_instances(foreign_base):
    """【6.3 安装下线】下线旧版本实例。安全约束：
    1) 只杀「命令行同时含 旧base_dir + 本产品族名（朱峰智能体无限）+ server 脚本」的进程——
       三重匹配均命中才算旧版本，绝不全端口扫描乱杀；
    2) 陌生进程（无产品族标记，如用户自己的 python 服务占了端口）绝不杀——
       由调用方走「拒绝启动+提示手动处理」分支；
    3) 先温和 taskkill（不带 /F）给旧版留收尾机会，2 秒后仍活再强制。
    """
    import subprocess
    me = os.getpid()
    _flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    fam = '朱峰智能体无限'

    def _match_lines():
        try:
            # 【6.3 编码坑】wmic 在中文 Windows 输出 GBK/OEM 编码，utf-8 解码会把中文路径与
            # 产品族名打成 replacement 乱码 → 匹配必败。改为拿 bytes 后按 utf-8→gbk→mbcs 顺序试解，
            # 以「能解出产品族名」的那个为准。
            out_bytes = subprocess.run(
                ['wmic', 'process', 'where', "name='python.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
                capture_output=True, timeout=10, creationflags=_flags).stdout
            out = ''
            for _enc in ('utf-8', 'gbk', 'mbcs'):
                try:
                    cand = out_bytes.decode(_enc, errors='replace')
                except Exception:
                    continue
                out = cand
                if fam in cand:
                    break
        except Exception as e:
            log.error('[6.3 安装下线] 进程扫描失败: %s' % e)
            return []
        lines = []
        for line in out.splitlines():
            line = line.strip()
            if 'server' not in line:
                continue
            low = line.lower()
            if str(foreign_base).lower() not in low:
                continue
            if fam not in line:
                continue
            lines.append(line)
        return lines

    def _kill(force):
        n = 0
        for line in _match_lines():
            pid_str = line.rsplit(',', 1)[-1].strip()
            if not pid_str.isdigit() or int(pid_str) == me:
                continue
            cmd = ['taskkill'] + (['/F'] if force else []) + ['/PID', pid_str]
            try:
                subprocess.run(cmd, capture_output=True, timeout=10, creationflags=_flags)
                n += 1
                log.info('[6.3 安装下线] %s旧版本实例 PID %s（%s）' % ('强制下线' if force else '优雅下线', pid_str, foreign_base))
            except Exception:
                pass
        return n

    _kill(force=False)
    time.sleep(2)
    if _port_in_use():
        _kill(force=True)


def _service_alive():
    """Probe the HTTP service on the port and confirm that the hot-reload directory belongs to the current project"""
    try:
        import urllib.request
        with urllib.request.urlopen(f'http://{HOST}:{PORT}/api/hot-reload/status', timeout=2.5) as resp:
            if resp.status >= 500:
                return False
            payload = json.loads(resp.read().decode('utf-8'))
        status = payload.get('status') or {}
        expected_base = os.path.abspath(BASE_DIR).casefold()
        actual_base = os.path.abspath(status.get('base_dir', '')).casefold()
        return payload.get('ok') is True and actual_base == expected_base
    except Exception:
        return False


def _remove_pid_file_if_owner():
    """删除 private/server.pid——仅当文件内容仍是本进程 PID（防误删后启动实例的 pid）。
    【P1 提为可调用 2026-11-23】原逻辑是 _write_pid_file 内的 atexit 闭包；但
    _shutdown_watcher 走 os._exit(0) 不触发 atexit，pid 残留会把"已死 PID"留给
    engine.js 查杀流程。提为模块级函数供两处调用。"""
    pid_file = os.path.join(BASE_DIR, 'private', 'server.pid')
    try:
        if os.path.exists(pid_file):
            with open(pid_file, 'r', encoding='utf-8-sig') as f:
                owner = (f.read() or '').strip()
            if owner == str(os.getpid()):
                os.remove(pid_file)
    except Exception as _e:
        _bf_dbg('server.py:115', _e)


def _write_pid_file():
    """将当前 server.py 的 PID 写入 private/server.pid,供 engine.js 精准定位杀进程"""
    # 附属线路实例不写 pid 文件：避免覆盖主线 pid，导致重启/查杀流程误杀附属实例
    if IS_ROUTE:
        return
    try:
        import atexit
        pid = os.getpid()
        pid_file = os.path.join(BASE_DIR, 'private', 'server.pid')
        os.makedirs(os.path.dirname(pid_file), exist_ok=True)
        with open(pid_file, 'w', encoding='utf-8') as f:
            f.write(str(pid))
        atexit.register(_remove_pid_file_if_owner)
        if not QUIET_CONSOLE:
            log.info(f'[Server] PID {pid} written to {pid_file}')
    except Exception as e:
        log.error(f'[Server] 写 PID 文件失败: {e}')


def _kill_stale_instances():
    """杀掉所有本项目的旧 server.py 实例(命令行含 server\\server.py 且非当前 PID)。
    仅清理命令行含本项目 BASE_DIR 路径的实例，不会误杀同机其他版本项目。纯标准库实现。"""
    import subprocess
    me = os.getpid()
    killed = []
    if sys.platform != 'win32':
        # Linux/macOS：无 wmic/taskkill，用 /proc 扫命令行 + SIGKILL
        import signal
        for pid_dir in ('/proc', ):
            try:
                for name in os.listdir(pid_dir):
                    if not name.isdigit() or int(name) == me:
                        continue
                    try:
                        with open(os.path.join(pid_dir, name, 'cmdline'),
                                  'rb') as fh:
                            cmd = fh.read().decode('utf-8', 'replace')
                    except Exception:
                        continue
                    if 'server.py' in cmd and 'restart_server' not in cmd:
                        # 收紧：仅当进程工作目录在本项目内才杀，避免误杀同机其他项目
                        try:
                            cwd = os.path.realpath(os.readlink(
                                os.path.join(pid_dir, name, 'cwd')))
                        except Exception:
                            continue
                        if not cwd.startswith(os.path.realpath(BASE_DIR)):
                            continue
                        try:
                            os.kill(int(name), signal.SIGKILL)
                            killed.append(int(name))
                            log.info(f'[Server] 已清理旧实例 PID {name}')
                        except Exception:
                            pass
            except Exception as e:
                log.error(f'[Server] 清理旧实例失败(不影响启动): {e}')
        return killed
    try:
        out = subprocess.run(
            ['wmic', 'process', 'where', "name='python.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
            capture_output=True, text=True,
            encoding='utf-8', errors='replace',  # 中文 Windows 下 wmic 输出非 UTF-8，默认解码会崩导致清理失效
            timeout=10, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        ).stdout
        for line in out.splitlines():
            line = line.strip()
            if 'server.py' not in line:
                continue
            # 附属线路实例（--route 标记）不属"旧实例"，多实例共存时严禁误杀
            if '--route' in line:
                continue
            pid_str = line.rsplit(',', 1)[-1].strip()
            if not pid_str.isdigit() or int(pid_str) == me:
                continue
            # 按「命令行含 server\server.py 且路径在本项目 BASE_DIR 内」匹配，不依赖引号/逗号格式。
            # （wmic CSV 中命令行带引号，旧版 endswith('server.py') 永远匹配不到，
            #  导致双实例未清理、SQLite 锁库。）
            # 收紧：仅当命令行含本项目路径才杀，避免误杀同机其他版本项目（对齐 Linux 分支防护）
            if os.path.abspath(BASE_DIR).lower() not in line.lower():
                continue
            try:
                subprocess.run(['taskkill', '/F', '/PID', pid_str],
                               capture_output=True, timeout=10,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                killed.append(int(pid_str))
                log.info(f'[Server] 已清理旧实例 PID {pid_str}')
            except Exception as _e:
                _bf_dbg('server.py:151', _e)
                pass
    except Exception as e:
        log.error(f'[Server] 清理旧实例失败(不影响启动): {e}')
    return killed


def _disable_console_quickedit():
    """禁用控制台 QuickEdit（快速编辑）模式。

    Windows 控制台默认开启 QuickEdit：用户在窗口里点一下鼠标即进入文本选中状态，
    此时所有向 stdout 的写入（print）会永久阻塞——engine 工具循环线程全部卡死，
    表现为"所有对话发不出去"但 health/db 等不打印的接口仍正常，极难排查。
    清除 ENABLE_QUICKEDIT_MODE 后不再因误点冻结（需要复制日志时用标题栏菜单的标记模式）。"""
    try:
        import sys as _s
        if _s.platform != 'win32':
            return  # 非 Windows 控制台无 QuickEdit 问题
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if k32.GetConsoleMode(h, ctypes.byref(mode)):
            k32.SetConsoleMode(h, mode.value & ~0x0040)
            from config import QUIET_CONSOLE as _qc
            if not _qc:
                log.info('[Server] 已禁用控制台 QuickEdit（防止误点窗口冻结所有对话）')
    except Exception:
        pass  # 非 Windows / stdout 被重定向到文件时无需处理


def _hold_window(reason):
    """保持窗口可见:打印提示并等待用户确认后退出(防止窗口一闪而过看不到错误)。"""
    log.info('')
    log.info('=' * 60)
    log.info(f'[Server] {reason}')
    log.info('[Server] 此窗口会保持打开,便于查看信息。按回车键关闭本窗口...')
    log.info('=' * 60)
    try:
        input()
    except Exception as _e:
        _bf_dbg('server.py:191', _e)
        pass
    except KeyboardInterrupt:
        # Ctrl+C 关闭本窗口是正常操作：安静地以 0 退出，
        # 否则非零退出码会让启动器打印吓人的 [ERROR] 块（复用路径里什么都没坏）
        pass
    sys.exit(0)


_port_warned = False

def _proxy_port():
    """代理端口：优先 AI_PROXY_PORT 环境变量，其次 private/port.json 的 ai_proxy_port 字段，兜底默认 8624（6.2.0 端口段）。
    【多版本共存】与 ai_proxy.py 的 _proxy_port 逻辑保持一致，各版本用独立端口互不冲击。"""
    try:
        _p = int(os.environ.get('AI_PROXY_PORT', '0'))
        if _p > 0:
            return _p
    except Exception:
        pass
    try:
        _pj = os.path.join(PRIVATE_DIR, 'port.json')
        with open(_pj, 'r', encoding='utf-8-sig') as _f:
            _v = json.load(_f).get('ai_proxy_port')
        if isinstance(_v, int) and _v > 0:
            return _v
    except Exception:
        pass
    return 8624  # 兜底默认（6.2.0=8620-8630 段，唯一事实来源是 private/port.json）

PROXY_PORT = _proxy_port()


def _ai_proxy_owner_ok():
    """探活端口上的进程是否为本项目的 ai_proxy（/health 返回 zf-ai-proxy 标记）。

    若端口被旧版本的 ai_proxy 或陌生进程占用，裸 TCP 探活会误判
    为"已在运行"，导致请求被异构进程抢走后出现 10054/10061。这里用
    HTTP /health 响应体区分归属，发现非本项目的占用者立即给出明确提示。
    """
    import json as _json
    try:
        from urllib.request import urlopen
        _resp = urlopen('http://127.0.0.1:%s/health' % PROXY_PORT, timeout=1.5)
        _data = _json.loads(_resp.read().decode('utf-8', 'replace'))
        return _data.get('service') == 'zf-ai-proxy'
    except Exception:
        # 无 /health 路由（旧版 ai_proxy）或根本不是 HTTP 服务 → 视为非本项目占用
        return False


def _ensure_ai_proxy():
    """确保本机 AI 代理网关(127.0.0.1:PROXY_PORT)在运行，未运行则自动拉起（幂等）。

    朱峰模型的全部流量必须经代理网关转发，代理没起来 = 所有朱峰模型
    WinError 10061 积极拒绝，普通用户既不知道端口的存在也无法自救。
    因此在 server 启动时兜底自启 + 后台看门狗自愈，用户零感知。
    【多版本共存】端口从 private/port.json 的 ai_proxy_port 读取，
    各版本使用独立端口段（如 5.4.x 用 8550-8554、5.5.x 用 8555-8559，ai_proxy 取段内最后一个），互不冲突。详见 docs/端口段约定.md。
    【附属实例】route 线路实例跳过：代理看门狗只挂主线，避免多实例重复拉起/重复看门狗线程。
    """
    if IS_ROUTE:
        return True
    import socket
    import subprocess

    def _up():
        try:
            _s = socket.create_connection(('127.0.0.1', PROXY_PORT), 0.4)
            _s.close()
            return True
        except Exception:
            return False

    if _up():
        if _ai_proxy_owner_ok():
            return True
        global _port_warned
        if not _port_warned:
            _port_warned = True  # 仅首次提示，避免看门狗心跳刷屏
            log.info('[AIPROXY] [!] %s 端口已被其他程序占用（非本项目的 ai_proxy，' % PROXY_PORT)
            log.info('[AIPROXY]   多为旧版本实例未关闭）。朱峰模型请求会被其抢走并报')
            log.info('[AIPROXY]   WinError 10054/10061。请关闭占用 %s 的旧程序后重启，' % PROXY_PORT)
            log.info('[AIPROXY]   查看占用进程: netstat -ano | findstr :%s' % PROXY_PORT)
        return False
    proxy_py = os.path.join(BASE_DIR, 'ai_proxy.py')
    try:
        from platform_compat import py_exe as _py_exe
        py_exe = _py_exe(BASE_DIR)
    except Exception:
        py_exe = os.path.join(BASE_DIR, 'python', 'python.exe')
    if not (os.path.isfile(proxy_py) and os.path.isfile(py_exe)):
        log.info('[AIPROXY] 未找到 %s，无法自动启动 AI 代理网关(%s)，朱峰模型将不可用' % (proxy_py, PROXY_PORT))
        return False
    _kill_stale_ai_proxy(py_exe, proxy_py)
    try:
        _log = open(os.path.join(BASE_DIR, 'ai_proxy_run.log'), 'a')
        subprocess.Popen(
            [py_exe, proxy_py], cwd=BASE_DIR,
            stdout=_log, stderr=_log, stdin=subprocess.DEVNULL,
            **({'creationflags': 0x08000000} if sys.platform == 'win32' else {}))  # CREATE_NO_WINDOW: 不弹黑框
        for _ in range(20):
            time.sleep(0.5)
            if _ai_proxy_owner_ok():  # 【复审修复】用归属校验而非裸TCP，防陌生进程抢绑误报成功
                log.info('[AIPROXY] 本机 AI 代理网关已自动启动 (127.0.0.1:%s)' % PROXY_PORT)
                return True
        log.info('[AIPROXY] %s 启动超时，朱峰模型可能不可用，详见 ai_proxy_run.log' % PROXY_PORT)
    except Exception as _e:
        log.error('[AIPROXY] 自动启动失败: %s' % _e)
    return False


def _kill_stale_ai_proxy(py_exe, proxy_py):
    """【僵尸防复发 2026-11-20】拉起前先清理本项目 ai_proxy 的旧进程/僵尸。

    Windows 上新实例总能绑定成功（Werkzeug/waitress 默认 SO_REUSEADDR），旧实例
    永远绑不上也退不了，导致僵尸堆积、请求随机落到旧代码实例。
    【多版本共存保护 2026-11-20 复审】探测条件除命令行含 ai_proxy.py 外，必须同时
    匹配本项目 BASE_DIR 路径，避免误杀其他版本目录（5.4.x/5.5.x 等）下健康运行的
    ai_proxy（它们监听各自端口段，本不该动）。陌生进程（其他程序）一律不动。
    """
    import subprocess
    try:
        # CommandLine 匹配：本项目路径（-like 通配）+ ai_proxy.py，收窄杀进程范围
        _ps = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             "Get-CimInstance Win32_Process -Filter \"name like 'python%' or name like '朱峰%'\" | "
             "Where-Object { $_.CommandLine -like '*%s*' -and $_.CommandLine -match 'ai_proxy\\.py' } | "
             "Select-Object -ExpandProperty ProcessId" % os.path.abspath(proxy_py).replace("'", "''")],
            capture_output=True, text=True, timeout=10)
        _self = os.getpid()
        for _pid_line in (_ps.stdout or '').split():
            try:
                _pid = int(_pid_line)
            except ValueError:
                continue
            if _pid == _self or _pid <= 4:
                continue
            try:
                subprocess.run(['taskkill', '/F', '/PID', str(_pid)],
                               capture_output=True, timeout=10)
                log.info('[AIPROXY] 已清理 ai_proxy 旧进程 PID=%s（防僵尸堆积）' % _pid)
            except Exception:
                pass
        time.sleep(0.8)  # 等端口释放
    except Exception as _e:
        log.info('[AIPROXY] 清理旧进程时出错(继续启动): %s' % _e)


# 全局停机事件：托盘"重启智能体"调用 request_shutdown() 置位，
# 服务循环轮询到后走正常关停流程（内存快照 → server.shutdown() → 退出进程）。
# 【修复】旧版托盘重启只 set 了一个无人检查的本地 stop_event，
# serve_forever 从不停止，端口一直被旧进程占着，新进程只能复用旧实例——
# 实际效果是"假重启"（只关托盘图标+重开界面，服务纹丝不动）。
shutdown_event = threading.Event()


def request_shutdown():
    """请求停止服务（线程安全，可从托盘线程调用）。"""
    shutdown_event.set()


def _shutdown_watcher(server):
    """后台轮询 shutdown_event，置位后触发服务优雅关停并结束进程。"""
    while not shutdown_event.is_set():
        time.sleep(0.3)
    try:
        log.info('[Server] 收到停机请求（托盘重启/关闭）...')
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if hr:
            hr.stop()
        # 关闭前对记忆库做最后一次 git 快照（与 Ctrl+C 路径一致）
        # 【P1 三方关停赛跑 2026-11-23】给快照 10 秒预算：run_autosave 内部 git 操作
        # 可能因 index.lock 残留/磁盘卡顿无限阻塞，导致关停永不完成、端口迟迟不释放，
        # 重启链路等不到就只能强杀（快照照样丢）。改为守护线程执行 + join(10)，
        # 超时打印提示并继续关停，绝不无限等待。
        try:
            from memory_autosave import run_autosave

            def _final_snapshot():
                try:
                    _r = run_autosave(BASE_DIR, reason='服务关闭前')
                    if _r.get('committed'):
                        log.info('[MemoryGit] %s' % _r.get('msg', ''))
                except Exception as _se:
                    _bf_dbg('server.py:shutdown_watcher_snap', _se)

            _snapshot_thread = threading.Thread(target=_final_snapshot,
                                                name='zf-final-snapshot', daemon=True)
            _snapshot_thread.start()
            _snapshot_thread.join(10)
            if _snapshot_thread.is_alive():
                log.info('[Server] 快照超时，跳过等待，继续关停')
        except Exception as _e:
            _bf_dbg('server.py:shutdown_watcher', _e)
        server.shutdown()
    except Exception as _e:
        _bf_dbg('server.py:shutdown_watcher2', _e)
    finally:
        # 【P1】os._exit 不触发 atexit → pid 文件会残留"已死 PID"，engine.js 按 pid
        # 查杀时会扑空/杀错。退出前显式清理一次（仅当 owner 是本进程才删）。
        try:
            _remove_pid_file_if_owner()
        except Exception:
            pass
        # 服务线程结束后彻底退出进程，让重启流程干净接续
        os._exit(0)




def _phase_port_reuse():
    """阶段1：端口冲突智能处理（必须先于 init_db）"""
    _disable_console_quickedit()

    # ---- 端口冲突智能处理（必须先于 init_db！）----
    # 若旧实例仍存活，它持有 SQLite 写锁；此时执行 init_db 会报
    # "database is locked"，甚至触发误判损坏的恢复流程（删 WAL 重建）。
    # 因此：先确认端口归属，复用/清理完成后再碰数据库。
    # 注意：_write_pid_file 必须在确认要真正绑定端口之后才执行——
    # 若"复用已有健康实例"的分支提前写入 pid，pid 文件会指向一个马上退出的进程，
    # 启动器/重启脚本按 pid 查杀时就会杀错对象（或杀空）。
    if _port_in_use():
        if _service_alive():
            # 【6.3 安装下线】健康服务但 base_dir 不是本项目 = 旧版本实例占用端口
            # （本机曾实录：8600 被旧 6.1.0 实例占用，新版起不来、旧版 deny 规则拦工具写操作）
            _foreign = _foreign_instance_alive()
            if _foreign:
                log.warning('[6.3 安装下线] 检测到旧版本实例占用端口 %s（base_dir=%s），开始自动下线旧版…' % (PORT, _foreign))
                _retire_foreign_instances(_foreign)
                time.sleep(2)
                if _port_in_use():
                    time.sleep(3)
                if _port_in_use():
                    log.error('[6.3 安装下线] 旧版本未能自动下线。为避免双实例抢端口/数据库锁，本新版本拒绝启动。')
                    sys.stderr.write('旧版本朱峰智能体仍在运行且无法自动下线，请手动关闭后再启动新版本。\n')
                    _hold_window('检测到旧版本朱峰智能体（%s）仍在运行且无法自动下线。\n为避免双实例互相干扰（抢端口/数据库锁），本新版本已停止启动。\n请手动关闭旧版本后再启动。' % _foreign)
                    return
                log.info('[6.3 安装下线] 旧版本已下线、端口已释放，新版本继续启动。【提醒】旧版本进程已被关闭，请勿再从旧目录启动，以免双实例冲突。')
            else:
                # 已有健康实例在跑:直接复用,不重复启动(由启动器负责打开浏览器)
                log.info(f'[Server] port {PORT} already has a healthy service, reusing existing instance, this startup exits (0)')
                # 统一启动界面：复用已有实例时也显示大字
                # S1-3 绞杀者切换：横幅已插件化（tool.banner），失败时回退内联
                _print_banner()
                log.info('[Server] 服务已在运行（复用已有实例），按回车键关闭本窗口...')
                try:
                    input()
                except BaseException:
                    pass
                sys.exit(0)
        else:
            # 端口被占但服务不健康:先尝试自动清理旧实例,再重试
            log.info(f'[Server] 端口 {PORT} 被占用但服务无响应,尝试自动清理旧实例...')
            killed = _kill_stale_instances()
            time.sleep(2)
            if killed and not _port_in_use():
                log.info('[Server] 旧实例已清理,继续启动。')
            elif _port_in_use() and not _service_alive():
                time.sleep(3)
                if _port_in_use() and not _service_alive():
                    log.error(f'[Server] 错误: 端口 {PORT} 仍被非本服务进程占用')
                    sys.stderr.write(f'端口 {PORT} 被占用且占用者无 HTTP 响应.请关闭占用进程后重试.\n')
                    _hold_window(f'错误: 端口 {PORT} 被占用且占用者无响应,无法启动服务。')


def _print_banner():
    """S1-3→T8 摘壳（2026-11-23）：横幅完全归 tool.banner 插件（唯一真源）。
    插件未启用/异常时只留一行版本日志（运维标识，非横幅功能本体）。"""
    try:
        import kernel as _k
        _kern = _k.get_kernel()
        if not _kern._enabled:  # 插件引导未跑过时先引导（幂等，load_all 会跳过已启用）
            _k.boot_plugins()
        tool = _kern.tools.get("banner_print")
        if tool:
            r = tool["exec"]({})
            if r and r.get("printed"):
                return
    except Exception as _be:
        pass  # 插件轨异常静默（摘壳：旧轨 ASCII 横幅已删除，git 历史可恢复）
    # 【20261123 迁移修正】本函数是控制台界面职能（banner 插件未启用的版本回退行），
    # print 属接口输出而非日志，测试 test_banner_switch 场景B 以 stdout 捕获断言。
    # ★★★【勿迁移为日志】本行是控制台界面输出，test_banner_switch 场景B 以 stdout
    # 捕获断言钉死（蜂群已两次误迁，均被门禁拦回）。print 是功能，不是日志。★★★
    print('[Server] ZF3D Agent v%s（banner 插件未启用：仅版本日志）' % VERSION)


def _cleanup_stale_git_lock():
    """【P1 三方关停赛跑 2026-11-23】启动时清理记忆库 git 的残留 index.lock：
    上个进程被强杀/断电时 git 会留下 index.lock，之后每一次 run_autosave 快照
    都因锁存在而永久失败（重启丢快照的直接根源之一）。超过 5 分钟的残留视为
    崩溃遗留（正常 git 操作不会持有这么久），直接删除；刚产生的锁不动（可能是
    并行进程正在快照）。失败不影响启动。"""
    lock_path = os.path.join(BASE_DIR, 'private', '记忆', '.git', 'index.lock')
    try:
        if os.path.exists(lock_path):
            age = time.time() - os.path.getmtime(lock_path)
            if age > 300:
                os.remove(lock_path)
                log.info('[MemoryGit] 已清理残留 git index.lock（%.0f 秒前遗留）' % age)
    except Exception as _e:
        _bf_dbg('server_runtime:git_lock', _e)


def _phase_boot():
    """阶段2：init_db + 启动横幅 + 可插拔后台模块 + pid"""
    init_db()
    _cleanup_stale_git_lock()

    # 统一启动界面：放到最前面，即使复用已有实例也能看到大字
    _print_banner()  # S1-3 绞杀者切换：横幅已插件化（tool.banner），失败时回退内联

    # 流式TTS模块（可插拔、独立线程/端口，失败不影响主服务）
    try:
        import json as _json
        _pcfg = {}
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'port.json'), 'r', encoding='utf-8-sig') as _f:
                _pcfg = _json.load(_f)
        except Exception:
            _pcfg = {}
        _ts = _pcfg.get('tts_stream') or {}
        if _ts.get('enabled'):
            from tts_stream import start_tts_stream as _start_tts
            _start_tts(host=_pcfg.get('host') or '127.0.0.1', port=int(_ts.get('port') or 8622))
    except Exception as _e:
        log.error('[Server] 流式TTS模块启动失败(已跳过，不影响主服务): %s' % _e)

    # 删除缓冲垃圾箱：启动即清理超过保留期(默认30天)的条目，之后每6小时一次
    try:
        from trash import auto_cleanup as _trash_cleanup
        import threading as _threading

        def _trash_cleanup_loop():
            while True:
                try:
                    r = _trash_cleanup()
                    if r.get('purged') or r.get('errors'):
                        log.info('[Trash] cleanup purged=%s errors=%s'
                              % (r.get('purged'), r.get('errors')))
                except Exception as e:
                    log.info('[Trash] cleanup error: %s' % e)
                time.sleep(6 * 3600)

        _threading.Thread(target=_trash_cleanup_loop, name='trash-cleanup',
                          daemon=True).start()
        _trash_cleanup()
    except Exception as _trash_e:
        log.info('[Trash] init failed: %s' % _trash_e)

    # 长期记忆库：独立 git 仓库定时快照（定期强制 git 保存，隐私数据不进主仓库）
    # 【T6 一切皆插件】双轨守卫：schedule.mem-autosave 插件启用时由插件提供 start（provides=mem_autosave），
    # 旧轨不再自启，防双线程双快照；插件未启用/内核未引导时走旧轨（行为不变）。
    try:
        _memgit_by_plugin = False
        try:
            from kernel import get_kernel as _get_kernel_memgit
            _k_memgit = _get_kernel_memgit()
            if _k_memgit is not None and _k_memgit.resolve('mem_autosave'):
                _memgit_by_plugin = True
        except Exception:
            pass
        if _memgit_by_plugin:
            log.info('[MemoryGit] 由 schedule.mem-autosave 插件接管（旧轨跳过）')
        else:
            from memory_autosave import start_autosave_thread
            start_autosave_thread(BASE_DIR)
    except Exception as _memgit_e:
        log.info('[MemoryGit] init failed: %s' % _memgit_e)

    # 主脑（Main Brain）：常驻观察线程（零侵入采集 + 事件驱动总结）
    # 【T8 摘壳 2026-11-23】唯一真源=brain.core 插件轨；旧轨 start_brain_thread 已删除
    # （git 历史可恢复）。插件未启用/失败=主脑不启动（可插拔语义），仅日志告知。
    _brain_started = False
    try:
        from kernel import boot_plugins, get_kernel
        boot_plugins()
        _impl_pid = get_kernel().implementations.get('brain')
        if _impl_pid:
            _mod = (get_kernel().plugins.get(_impl_pid) or {}).get('module')
            # 插件模块闭包内 start 经 ctx.schedule 提供：重新 setup 不可取，
            # 改由插件模块暴露 module 级 API —— 见 brain.core/main.py _schedule 静态类
            _sched = getattr(_mod, 'SCHEDULE', None) or getattr(_mod, 'schedule', None)
            if _sched and getattr(_sched, 'start', None):
                _brain_started = bool(_sched.start(BASE_DIR))
    except Exception as _kbrain_e:
        log.error('%s %s', '[Server] 主脑插件轨启动异常:', _kbrain_e)
    if _brain_started:
        log.info('[Server] 主脑观察线程已启动（插件轨 brain.core，20s/轮）')
    else:
        log.error('[Server] 主脑未启动（brain.core 插件未启用或失败；旧轨已摘壳）')

    _write_pid_file()

def _phase_attach():
    """阶段3：构造 HTTP server + 热更新 + 远程/心跳/升级后台线程"""
    # 【修复】request_queue_size 必须在构造 server 之前设置到类上：
    # socketserver 在 __init__ 内部就调用 server_bind()+server_activate()（即 listen(backlog)），
    # 构造之后再赋值实例属性为时已晚，backlog 仍是默认 5。前端 8 个 SSE 长连接 +
    # Agent 循环并发请求极易打满，队列满后新连接被 Windows 内核直接 RST，
    # 浏览器报 net::ERR_EMPTY_RESPONSE（典型症状：点击施工队按钮新对话框出不来）。
    class _QuietHTTPServer(QuietHTTPServer):
        request_queue_size = 128
    server = _QuietHTTPServer((HOST, PORT), DBHandler)
    # 【跨阶段共享】挂到全局，供 _phase_serve 复用（避免二次绑定同端口双 socket）
    global _HTTP_SERVER
    _HTTP_SERVER = server
    # 停机看门狗：托盘"重启/关闭"置位 shutdown_event 后由它完成优雅关停
    threading.Thread(target=_shutdown_watcher, args=(server,),
                     name='zf-shutdown-watcher', daemon=True).start()
    
    # 启动热更新引擎
    server_dir = os.path.dirname(os.path.abspath(__file__))
    from hot_reload import init_hot_reloader
    init_hot_reloader(server, DBHandler, server_dir, PUBLIC_DIR)

    # [僵尸回收] 服务启动时清理上个进程遗留的 running/queued 流水线任务，
    # 使面板「进行中」计数准确（daemon worker 随进程重启已死，状态却卡住）
    try:
        import db as _db0
        _reclaimed = _db0.reconcile_jobs_on_startup()
        if _reclaimed and not QUIET_CONSOLE:
            log.info(f'[Server] 启动回收僵尸流水线任务 {len(_reclaimed)} 个: {_reclaimed}')
    except Exception as e:
        if not QUIET_CONSOLE:
            log.error(f'[Server] 僵尸任务回收失败(不影响主服务): {e}')

    # 【双副本消灭 2026-11-10】public/ 与 server/public/ 双副本治理收口：
    # 实测静态服务本就只读项目根 public/（config.PUBLIC_DIR），server/public 无运行时消费方
    # （唯一消费方 domain_music 已改指根 public），启动同步 sync_public_js 停用。
    # server/public 保留为历史归档，待"跑满一天无 404"验收门通过后 git rm 彻底移除。
    if not QUIET_CONSOLE:
        log.info('[Server] 双副本同步已停用（2026-11-10 双副本消灭裁决）：静态服务只用根 public/，server/public 为退役归档')

    # 【功能下线 2026-11-09】远程控制（多机互联）整体移除，不再启动信令 WebSocket 服务
    # （原 8516 remote/ 包，及 zf3d_commands 远程命令消费通道，一并停用——避免用户误以为被监控）。

    # 启动朱峰智能体心跳上报线程
    # 【隐私整改 2026-11-05】默认关闭，须在设置页明示开启（或 private/port.json "heartbeat": true）。
    try:
        _hb_cfg = {}
        _hb_path = os.path.join(BASE_DIR, 'private', 'port.json')
        if os.path.exists(_hb_path):
            with open(_hb_path, 'r', encoding='utf-8-sig') as _f:
                _hb_cfg = json.load(_f)
        if isinstance(_hb_cfg, dict) and _hb_cfg.get('heartbeat') is True:
            from zf3d_heartbeat import start_heartbeat
            start_heartbeat()
        else:
            if not QUIET_CONSOLE:
                log.info('[Server] 心跳上报默认关闭（如需开启：设置页开启，或 port.json 写 "heartbeat": true）')
    except Exception as e:
        if not QUIET_CONSOLE:
            log.error(f'[Server] 心跳线程启动失败: {e}')

    # 【功能下线 2026-11-09】远程命令消费（zf3d_commands）已随远程控制功能一并移除，不再启动。

    # 启动自动升级检查线程（启动后 30s 首检，按 private/updater.json 间隔循环；
    # auto_apply=true 时发现新版自动升级并重启，false 则只提示）
    try:
        from updater import start_auto_checker
        start_auto_checker()
    except Exception as e:
        if not QUIET_CONSOLE:
            log.error(f'[Server] 自动升级线程启动失败: {e}')


def _post_boot_tasks():
    # 【插件内核】阶段0引导：扫描 plugins/ 并启用已授权插件（空目录=空白体照常跑）
    try:
        import kernel as _kernel
        _kernel.boot_plugins()
        # dispatcher ensure_loaded 需在插件 http 注册后可用——插件经
        # routes.dispatcher 装饰器注册，首次分发自动触发，无需额外处理
    except Exception as _k:
        log.error('[Server] 插件内核引导异常(不影响主服务): %s' % _k)
    # 【断点续跑】启动后扫描上次中断的池任务并自动重投（非阻塞）
    try:
        import pool_resume
        pool_resume.recover_on_boot()
    except Exception as _pre:
        log.error('[Server] pool_resume 启动扫描异常: %s' % _pre)
    # 【小镇工单自愈】启动后扫描上个进程遗留的未收尾村民工单：定性死亡+按预算自动复活
    # （domain_town._revive_scan_once 进程内仅跑一次且失败可重试；放线程防阻塞启动流程）
    def _town_revive_boot():
        try:
            from routes import domain_town as _dt
            _dt._revive_scan_once()
            log.info('[TownRevive] 小镇工单重启扫描完成')
        except Exception as _trb:
            log.error('[TownRevive] 启动扫描异常: %s' % _trb)
    threading.Thread(target=_town_revive_boot, daemon=True, name='town-revive-boot').start()
    # 【Jobs 断点自愈】启动后把被僵尸回收(reconcile 标 failed)的中断任务自动重跑。
    # daemon worker 随进程重启已死，jobs 状态卡在 queued/running，已被上方
    # reconcile_jobs_on_startup 回收为 failed；此处按原 cfg 重新拉起（保持原
    # job_id/session 续写流水线）。开关在 private/port.json 加 "jobs_auto_resume": false 关闭。
    def _jobs_recover_on_boot(reclaimed_ids):
        try:
            _cfg = {}
            _pj = os.path.join(BASE_DIR, 'private', 'port.json')
            if os.path.exists(_pj):
                with open(_pj, 'r', encoding='utf-8-sig') as _f:
                    _cfg = json.load(_f)
            if _cfg.get('jobs_auto_resume') is False:
                log.info('[JobsRecover] 已按 port.json 配置关闭自动恢复')
                return
            import db as _db
            from routes.mixin_jobs import _run_pipeline_worker
            n = 0
            for jid in (reclaimed_ids or []):
                row = _db.get_job(jid) or {}
                try:
                    cfg = json.loads(row.get('cfg_json') or '{}')
                except Exception:
                    cfg = {}
                if not (row.get('goal') or cfg.get('goal')):
                    log.info('[JobsRecover] 跳过 %s：无 goal 无法重跑' % jid)
                    continue
                cfg['goal'] = row.get('goal') or cfg.get('goal')
                cfg['session'] = row.get('session_id') or cfg.get('session') or ('pl-' + str(int(time.time())))
                cwd = os.path.abspath(cfg.pop('_cwd', None) or BASE_DIR)
                threading.Thread(target=_run_pipeline_worker,
                                 args=(jid, cfg, cwd), daemon=True).start()
                n += 1
                log.info('[JobsRecover] 已重新拉起中断任务 %s' % jid)
            if n:
                log.info('[JobsRecover] 共恢复 %d 个中断任务' % n)
        except Exception as _jre:
            log.error('[JobsRecover] 启动扫描异常: %s' % _jre)
    # 【修复】_reclaimed 定义在另一启动阶段，跨作用域取不到会 NameError；
    # 保险起见再 reconcile 一次（幂等），失败则传空列表跳过自动恢复
    try:
        import db as _db1
        _reclaimed_here = _db1.reconcile_jobs_on_startup()
    except Exception:
        _reclaimed_here = []
    threading.Thread(target=_jobs_recover_on_boot, args=(_reclaimed_here,), daemon=True).start()
    # 本机 AI 代理网关(8787)兜底自启：朱峰模型全部流量经此转发，
    # 没起来用户端表现为 WinError 10061 且无法自救，必须启动即保证在跑
    try:
        _ensure_ai_proxy()
        import threading as _thr
        def _proxy_watchdog():
            while True:
                try:
                    time.sleep(60)
                    _ensure_ai_proxy()
                except Exception:
                    pass
        _thr.Thread(target=_proxy_watchdog, name='aiproxy-watchdog',
                    daemon=True).start()
    except Exception as _ape:
        log.error('%s %s', '[AIPROXY] 看门狗启动失败:', _ape)
    # 朱峰官方模型同步（网站=权威来源，失败不影响启动）
    try:
        import zf_model_sync
        _zr = zf_model_sync.sync()
        log.info('[Server] 朱峰官方模型同步: ' + _zr['msg'])
    except Exception as _ze:
        log.error('%s %s', '[Server] 朱峰官方模型同步失败(不影响启动):', _ze)
    # 【全卡死自救】独立存活探针服务：先把"进程活着"权威判据起起来
    try:
        import health_liveness
        health_liveness.start()
    except Exception as _lve:
        log.error('%s %s', '[Server] 存活探针启动失败(不影响启动):', _lve)
    # 【全卡死自救】心跳探针：存活端口连续失败 → 自动重启后台（前台/托盘保持）
    try:
        import network_guard
        network_guard.start_heartbeat_probe()
    except Exception as _hbe:
        log.error('%s %s', '[Server] 心跳探针启动失败(不影响启动):', _hbe)
    # 【卡死自动取证】>90s 无进度自动 py-spy dump（P2.2 防复发机制）
    try:
        import stuck_watch
        stuck_watch.start()
    except Exception as _swe:
        log.error('%s %s', '[Server] 卡死取证看门狗启动失败(不影响启动):', _swe)


def _start_bg_services():
    """serve_forever 之前拉起：post-boot 后台线程、缩略图预热、广场WS。
    【修复】serve_forever 之前的网络类启动步骤（模型同步/AI代理拉起）曾会
    无限阻塞主线程：socket 已 listen 但 accept 循环未运行，表现为端口监听
    却所有请求永久超时。改为全部后台线程执行，serve_forever 立即进入。"""
    import threading as _post_thr
    _post_thr.Thread(target=_post_boot_tasks, name='post-boot',
                     daemon=True).start()
    # 【首开提速 2026-10-27】缩略图后台预热（320px/WebP，单飞+限频，失败不影响启动）
    try:
        from routes.mixin_project_fs import start_thumb_warmup
        start_thumb_warmup()
    except Exception as _tw:
        log.error('%s %s', '[Server] 缩略图预热线程启动失败(不影响启动):', _tw)
    # 【智能体广场 2026-11-04】WS 广播服务（端口 8625，失败不影响启动；改动了启动逻辑，需重启服务验证）
    try:
        from plaza.ws_plaza import start_plaza_ws
        start_plaza_ws()
    except Exception as _pz:
        log.error('%s %s', '[Server] 广场WS服务启动失败(不影响启动):', _pz)
    # 【i视频 2026-11-11】独立端口流媒体代理（默认 8626，磁盘缓存保连通，失败不影响启动）
    try:
        from ivideo_stream import start_stream_server
        start_stream_server()
    except Exception as _iv:
        log.error('%s %s', '[Server] i视频流媒体代理启动失败(不影响启动):', _iv)


def _graceful_shutdown(server):
    """Ctrl+C 优雅关停：停热更新、记忆库末次 git 快照、shutdown。"""
    log.info('\n[Server] 正在停止...')
    from hot_reload import get_hot_reloader
    hr = get_hot_reloader()
    if hr:
        hr.stop()
    try:
        from memory_autosave import run_autosave
        _r = run_autosave(BASE_DIR, reason='服务关闭前')
        if _r.get('committed'):
            log.info('[MemoryGit] %s' % _r.get('msg', ''))
    except Exception as _e:
        _bf_dbg('server.py:378', _e)
    server.shutdown()
    log.info('[Server] stopped')


def _phase_serve():
    """阶段4：后台服务拉起 + serve_forever + 优雅关停"""
    try:
        _start_bg_services()
        # 【修复】_phase_attach 已创建 server（含 request_queue_size=128 和
        # 热更新引擎注入），此阶段直接复用；此前在这里二次 new 一个 server 会造成
        # 同端口双 socket 绑定（Windows SO_REUSEADDR 不报错），连接全被内核投递到
        # 无人 accept 的死 socket 上，表现为端口监听却所有请求超时。
        log.info(f'[Server] HTTP 服务已监听 http://{HOST}:{PORT}')
        server = _HTTP_SERVER  # 复用 _phase_attach 创建的实例（原局部变量，重构拆分时丢失）
        server.serve_forever()
    except KeyboardInterrupt:
        _graceful_shutdown(_HTTP_SERVER)
    finally:
        # 异常退出时同样保持窗口,让用户能看清错误
        _hold_window(f'服务已停止 (PID {os.getpid()})。')




if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        # 崩溃取证：traceback 同时落盘到 server/crash.log（控制台窗口可能被随手关掉，
        # 用户贴报错时也常漏掉上方的 traceback，落盘后任何崩溃原因都可追溯）
        try:
            _crash_log = os.path.join(BASE_DIR, 'server', 'crash.log')
            with open(_crash_log, 'a', encoding='utf-8') as _f:
                _f.write('\n==== %s (PID %s) ====\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), os.getpid()))
                traceback.print_exc(file=_f)
        except Exception as _e:
            _bf_dbg('server.py:399', _e)
            pass
        _hold_window('发生未捕获异常,服务启动失败!')
