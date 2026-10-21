#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体 - Windows 托盘常驻启动器
后台线程运行 server.py 的 main()，主线程显示右下角托盘图标。
托盘右键菜单：打开主界面 / 重启服务 / 退出。
用法：python tray_server.py   （或打包 exe 后双击）
"""
import os
import sys
import threading
import webbrowser
import socket
import time
import subprocess

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from config import HOST, PORT, VERSION


def _port_open(port, timeout=0.5):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_status(port, attach_mode):
    """探测后台服务运行状态（D1/D5）。返回单行文本，供托盘气泡/提示显示：
    端口、是否在线、当前监听 PID、热重载是否启用、本托盘托管/附加模式。"""
    online = _port_open(port)
    pid = '-'
    if online:
        try:
            out = subprocess.run(['netstat', '-ano', '-p', 'TCP'],
                                 capture_output=True, timeout=6,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for ln in out.stdout.decode('gbk', errors='replace').splitlines():
                parts = ln.split()
                if len(parts) >= 5 and parts[0].upper() == 'TCP' and parts[3].upper() == 'LISTENING':
                    if parts[1].rsplit(':', 1)[-1] == str(port):
                        pid = parts[4]
                        break
        except Exception:
            pid = '?'
    hot = '-'
    if online:
        try:
            import urllib.request
            with urllib.request.urlopen(
                    'http://127.0.0.1:%d/api/hot-reload/status' % port, timeout=2) as r:
                hot = '已启用' if r.status == 200 else '未知'
        except Exception:
            hot = '未探测'
    mode = '附加(不托管)' if attach_mode else '托管'
    return '端口 %s · %s\nPID %s · 热重载 %s · 托盘 %s' % (
        port, '运行中' if online else '已停止', pid, hot, mode)


def _open_ui():
    """优先用 pywebview 独立窗口（桌面客户端），失败回退浏览器。
    单实例：已有窗口进程则发聚焦通知，不再开新窗口。"""
    exe = sys.executable
    script = os.path.join(_HERE, 'webview_client.py')
    if not os.path.exists(script):
        webbrowser.open(f'http://127.0.0.1:{PORT}/')
        return
    # 窗口进程单实例检测：扫描 python 进程命令行是否已带 webview_client.py
    try:
        import ctypes, ctypes.wintypes
        kernel32 = ctypes.windll.kernel32
        # 简单方案：用锁文件 + PID 存活检测
        import tempfile
        lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
        alive = False
        if os.path.exists(lock):
            try:
                pid = int(open(lock).read().strip())
                # OpenProcess 成功且未退出视为存活
                SYNCHRONIZE = 0x00100000
                h = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
                if h:
                    kernel32.CloseHandle(h)
                    alive = True
                else:
                    # 进程已死：清掉残留锁文件
                    try:
                        os.remove(lock)
                    except Exception:
                        pass
            except Exception:
                alive = False
        if alive:
            env = dict(os.environ)
            env['ZF_UI_FOCUS_NOTIFY'] = '1'
            subprocess.Popen([exe, script], env=env,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            return
        flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.Popen([exe, script], cwd=_PROJECT_ROOT,
                         creationflags=flags)
        # 延迟写入 PID 锁（窗口进程自己也会写，这里兜底）
        return
    except Exception:
        pass
    webbrowser.open(f'http://127.0.0.1:{PORT}/')


def _make_icon_image():
    """优先用项目 public/logo.ico，没有就用程序生成的蓝色方块图标"""
    ico_path = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    if os.path.exists(ico_path):
        try:
            from PIL import Image
            return Image.open(ico_path).convert('RGBA')
        except Exception:
            pass
    # 优先用项目自带 logo 图标
    ico = os.path.join(_PROJECT_ROOT, 'public', 'logo.ico')
    if os.path.exists(ico):
        try:
            from PIL import Image as _PILImage
            return _PILImage.open(ico)
        except Exception:
            pass
    from PIL import Image, ImageDraw
    img = Image.new('RGBA', (64, 64), (25, 118, 210, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([12, 26, 52, 50], fill=(255, 255, 255, 230))
    d.polygon([(32, 10), (52, 26), (12, 26)], fill=(255, 255, 255, 230))
    return img


def _notify(icon, title, message):
    """托盘气泡通知（C1）。Windows 走 Shell_NotifyIcon 的 balloon（系统 toast），
    调用返回即表示 balloon 已交给 shell。重启/退出场景紧接着 stop 图标，
    已投递的 balloon 一般仍会显示数秒（Windows 不主动撤回）。失败静默不影响主流程。"""
    if icon is None:
        return
    try:
        icon.notify(message, title)
        time.sleep(0.15)   # 给底层消息循环一点时间把 balloon 投出去，再被 stop 撤下
    except Exception as e:
        print('[Tray] 通知失败:', e)


def _confirm_box(title, text, warn=True):
    """Windows 原生模态确认框（C2，用于退出这类不可逆操作二次确认）。
    返回 True=确认，False=取消。MessageBoxW 阻塞当前线程，必须在托盘回调线程外
    或回调内同步等待均可（pystray 菜单回调本就在独立线程）。"""
    try:
        import ctypes
        MB_OKCANCEL = 0x00000001
        MB_ICONWARNING = 0x00000030 if warn else 0x00000040
        IDOK = 1
        # 0 句柄=无父窗口；第三个参数 caption，第四个 text
        rc = ctypes.windll.user32.MessageBoxW(
            0, text, title, MB_OKCANCEL | MB_ICONWARNING)
        return rc == IDOK
    except Exception as e:
        print('[Tray] 确认框失败，按“不退出”保守处理:', e)
        return False


def main():
    import pystray
    from pystray import Menu, MenuItem as Item

    # 已有实例在跑则先等它退出（重启场景，最多等 10 秒）
    for _ in range(20):
        if not _port_open(PORT):
            break
        time.sleep(0.5)
    # 【附加模式】端口仍被占（服务由别的方式启动，如裸 server.py）：
    # 不再直接退出，而是仍创建托盘图标（不启动服务线程），保证图标常驻
    attach_mode = _port_open(PORT)
    if attach_mode:
        print(f'[Tray] 端口 {PORT} 已有服务在运行，进入附加模式（仅托盘，不托管服务）')

    stop_event = threading.Event()

    # 【空闲自动重启】每10分钟检查：暴击数==0 持续10秒 → 无感重启后台
    try:
        import idle_auto_restart
        idle_auto_restart.start_watcher()
    except Exception as e:
        print('[Tray] 空闲自动重启线程启动失败:', e)

    def _run_server():
        import server as server_mod
        try:
            server_mod.main()
        except Exception as e:
            print('[Tray] 服务线程异常:', e)

    def _on_open(icon, item):
        # 等服务就绪再开页面
        for _ in range(50):
            if _port_open(PORT):
                break
            time.sleep(0.3)
        _open_ui()

    def _on_restart(icon, item):
        # 【修复】旧版在本进程内调 request_shutdown()，而 server 的停机看门狗
        # 收尾是 os._exit(0)——会把整个托盘进程（含本函数后续"等端口释放、
        # 拉起新托盘"的代码）一起硬杀，表现为"点重启=直接关闭"。
        # 新版：启动独立重启脚本 restart_server.py（经 cmd start 中转脱离本进程
        # 树，防止 taskkill /T 把重启脚本一并杀掉），由它完成
        # 杀旧服务 → 拉起新后台 → 拉回托盘图标；本托盘立即退出交棒。
        try:
            # 优先沿用当前进程可执行文件名（改名副本「朱峰智能体无限.exe」），
            # 使任务管理器显示名在「应用内重启」后保持一致；回退 pythonw.exe。
            exe = sys.executable
            if not os.path.basename(exe).lower().startswith('pythonw'):
                _pw = os.path.join(os.path.dirname(exe), 'pythonw.exe')
                # 仅当当前就是原生 pythonw 时才用它；改名副本则保留自身
                if os.path.basename(exe).lower() == 'python.exe' and os.path.exists(_pw):
                    exe = _pw
            script = os.path.join(_HERE, 'restart_server.py')
            cmd = 'start "" /b "{}" "{}"'.format(exe, script)
            subprocess.Popen(cmd, shell=True, cwd=_PROJECT_ROOT,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            # 【C1 体验反馈】重启已交棒给独立脚本，给一个气泡告知用户后台正在重启，
            # 避免图标一闪消失让用户误以为"被关掉了"。
            _notify(icon, '朱峰智能体', '正在重启后台，稍候界面会自动恢复…')
        except Exception as e:
            print('[Tray] 重启失败，仅退出:', e)
            _notify(icon, '朱峰智能体', '重启失败，仅关闭托盘：%s' % e)
        icon.stop()
        os._exit(0)

    def _kill_ui_process():
        """退出时一并结束主界面窗口进程（webview_client）。"""
        try:
            import tempfile, ctypes
            lock = os.path.join(tempfile.gettempdir(), f'zf_webview_{PORT}.pid')
            if os.path.exists(lock):
                pid = int(open(lock).read().strip())
                kernel32 = ctypes.windll.kernel32
                PROCESS_TERMINATE = 0x0001
                h = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
                if h:
                    kernel32.TerminateProcess(h, 0)
                    kernel32.CloseHandle(h)
                try:
                    os.remove(lock)
                except OSError:
                    pass
        except Exception as e:
            print('[Tray] 关闭窗口进程失败:', e)

    def _find_port_pids(port):
        """找到监听指定端口的【所有】进程 PID（附加模式下用于彻底关闭外部服务进程）。
        Windows 允许多进程重复绑定同一端口（本次卡顿故障正是双进程同占 8521），
        必须收集全部 LISTENING PID 循环结束，只杀第一个会漏杀残留。"""
        pids = []
        try:
            import subprocess as _sp
            out = _sp.run(['netstat', '-ano', '-p', 'tcp'], capture_output=True,
                          text=True, timeout=10,
                          creationflags=getattr(_sp, 'CREATE_NO_WINDOW', 0)).stdout
            for line in out.splitlines():
                parts = line.split()
                # 形如 TCP  0.0.0.0:8555  0.0.0.0:0  LISTENING  1234
                if len(parts) >= 5 and parts[3].upper() == 'LISTENING' \
                        and parts[1].rsplit(':', 1)[-1] == str(port):
                    try:
                        pid = int(parts[4])
                    except ValueError:
                        continue
                    if pid not in pids:
                        pids.append(pid)
        except Exception as e:
            print('[Tray] 查找端口进程失败:', e)
        return pids

    def _kill_pid(pid):
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            PROCESS_TERMINATE = 0x0001
            h = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
            if h:
                kernel32.TerminateProcess(h, 0)
                kernel32.CloseHandle(h)
                return True
        except Exception as e:
            print('[Tray] 结束进程 %s 失败:' % pid, e)
        return False

    def _on_quit(icon, item):
        # 【C2 危险操作二次确认】退出会停服/丢界面，属不可逆操作，托盘侧此前直接执行、
        # 与前端 quitApp 的确认弹窗不一致。这里统一加原生确认框（取消则原样返回不退出）。
        # 【改为彻底退出】附加模式下点关闭不再"仅退托盘"，而是把占用服务端口的外部
        # 服务进程一并结束（防止旧版本/残留进程占端口导致卡顿、关不干净）。
        if attach_mode:
            if not _confirm_box('彻底退出',
                                '确定彻底退出朱峰智能体？\n将结束后台服务进程（含残留的旧版本进程），界面随后关闭。'):
                return
            _notify(icon, '朱峰智能体', '正在结束后台服务并彻底退出…')
            print('[Tray] 彻底退出：结束端口 %s 上的所有服务进程' % PORT)
            pids = _find_port_pids(PORT)
            me = os.getpid()
            for pid in pids:
                if pid != me:
                    _kill_pid(pid)
            # 杀完后再探测确认端口已释放；仍有残留则提示用户可能需手动处理
            import time as _t
            for _ in range(10):
                _t.sleep(0.2)
                if not [p for p in _find_port_pids(PORT) if p != me]:
                    break
            else:
                leftover = [p for p in _find_port_pids(PORT) if p != me]
                if leftover:
                    print('[Tray] 警告：端口 %s 仍被进程 %s 占用' % (PORT, leftover))
            _kill_ui_process()
            icon.stop()
            os._exit(0)
        if not _confirm_box('退出系统',
                            '确定退出朱峰智能体？\n将优雅关停后台服务（记忆库快照落盘），界面随后关闭。'):
            return
        # 【C1 体验反馈】托管模式退出前给气泡，告知正在保存并关停，避免无感消失。
        _notify(icon, '朱峰智能体', '正在保存记忆库并优雅退出…')
        # 托管模式：与重启路径统一：走 server 的优雅关停（停热更新→记忆库git快照→shutdown→os._exit），
        # 保证退出时内存快照也落盘，不留端口占用残留
        # 【P0-A1 修复】旧版 request_shutdown()（仅 set 事件、非阻塞）后立即 os._exit(0)，
        # 抢在后台看门狗 _shutdown_watcher（轮询 0.3s + 记忆库 git 快照耗时数秒）之前把整个
        # 进程硬杀，注释声称的"快照落盘"实际落空。改为：触发优雅关停后轮询等待端口释放
        # （端口释放即表示看门狗已完成 快照→server.shutdown→os._exit，进程随之结束），
        # 不再抢跑截断快照；并保留超时兜底强退，防止看门狗异常卡死时退不掉。
        try:
            import server as server_mod
            server_mod.request_shutdown()
        except Exception as e:
            print('[Tray] 优雅关停失败，直接退出:', e)
        _kill_ui_process()
        # 等看门狗跑完优雅关停（最多 12 秒）；正常情况看门狗会先 os._exit 杀掉本进程，
        # 此处循环根本到不了末尾——只有看门狗卡死才会走到超时兜底强退。
        for _ in range(40):
            if not _port_open(PORT):
                break
            time.sleep(0.3)
        icon.stop()
        os._exit(0)

    def _on_status(icon, item):
        # 【D1/D5 状态查看】探测并显示后台运行状态（端口/PID/热重载/模式）。
        # 用独立线程跑探测，避免 netstat/HTTP 阻塞托盘菜单响应。
        def _work():
            txt = _probe_status(PORT, attach_mode)
            _notify(icon, '朱峰智能体 · 状态', txt)
            print('[Tray] 状态：%s' % txt.replace('\n', ' | '))
        threading.Thread(target=_work, name='zf-status', daemon=True).start()

    if attach_mode:
        # 附加模式不启动服务线程；直接打开主界面（服务已在跑）
        threading.Thread(target=_on_open, args=(None, None),
                         name='zf-autopen', daemon=True).start()
    else:
        t = threading.Thread(target=_run_server, name='zf-server', daemon=True)
        t.start()
        # 启动时自动打开主界面（后台等端口就绪，不阻塞托盘显示）
        threading.Thread(target=_on_open, args=(None, None),
                         name='zf-autopen', daemon=True).start()

    # 设置独立 AppUserModelID：让 Windows 把本进程当作独立应用（而非 pythonw.exe），
    # 任务栏/跳转列表归属朱峰应用，避免显示 Python 默认图标
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('ZF.ZhuFengAgentInfinity')
    except Exception:
        pass

    mode_tag = '(附加模式·端口占用)' if attach_mode else ''
    quit_label = '彻底退出'
    icon = pystray.Icon(
        name='zf_agent',
        icon=_make_icon_image(),
        title=f'朱峰智能体 v{VERSION} (端口 {PORT}) {mode_tag}',
        menu=Menu(
            Item('还原主界面', _on_open, default=True),
            Item('查看服务状态', _on_status),
            Item('重启智能体', _on_restart),
            Item(quit_label, _on_quit),
        ),
    )
    print(f'[Tray] 托盘已启动（{"附加" if attach_mode else "托管"}模式），服务端口 {PORT}，右键图标可操作')
    icon.run()


if __name__ == '__main__':
    main()
