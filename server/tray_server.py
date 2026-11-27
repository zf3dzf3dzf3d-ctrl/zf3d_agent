#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体 - Windows 托盘常驻启动器
以【子进程】方式拉起并守护 server.py（监督线程自动补拉），主线程显示右下角托盘图标。
托盘菜单（左键/右键同一菜单）：显示主界面 / 重启后台 / 关闭。
用法：python tray_server.py   （或打包 exe 后双击）

【架构定稿 2026-11-22 · 根治「右下角出现两个朱峰图标」】
旧版在托盘进程内用后台线程跑 server.main()（"托管模式"）：监听端口的 PID 就是
托盘进程本身。于是所有重启路径（网页重启按钮 / Ctrl+Alt+R 热键 / 空闲自动重启 /
托盘菜单重启）最终都会走到 restart_server.py → find_server_pid() 按 netstat 找到
的监听 PID 恰是托盘进程，再经 /api/app/quit 的停机看门狗 os._exit(0)（或 taskkill）
把托盘进程整个硬杀——Shell_NotifyIcon 没机会 NIM_DELETE，右下角留下一个死图标；
随后 relaunch_tray 又画一个新图标 → 死+活=两个图标，死的那个鼠标划过才消失。
触发源每隔几分钟就有一次（空闲自动重启每 20 分钟一轮），表现为"图标不知不觉变多"。

根治：托盘进程永不参与重启互杀——
  1) server.py 改为托盘拉起的独立子进程（裸 server，监听 PID ≠ 托盘 PID），
     杀旧/拉新永远只发生在裸 server 进程上；
  2) 托盘菜单"重启后台"只触发 restart_server.py，托盘自身不再退出交棒
     （旧"退托盘→补图标"的交棒竞态是双图标的另一半来源）；
  3) 监督线程保住"端口有人服务"：子进程崩溃自动补拉（restart_server 持锁期间让路）；
  4) 退出流程固定顺序：优雅停子进程 → 注销图标(stop/NIM_DELETE) → 才 os._exit。
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

from config import PORT, VERSION

# 【托盘单实例锁】端口被占时旧逻辑会进「附加模式」再画一个托盘图标，
# 双击两次启动脚本/旧托盘未退净时会同时出现两个一模一样的图标。
# 与 quick_ask_tray.py 同款方案：绑定固定锁端口，抢不到说明已有托盘实例，直接退出。
# 【多版本并存】锁端口按版本派生：58700 + (主端口 % 1000)，
# 6.2.0(8620)→59320，5.8.0(8580)→59280，各版本互不误判。
# 端口登记：58766=quick_ask_tray 锁；58790=global_hotkey 锁；托盘锁范围 58700-58999+。
TRAY_LOCK_PORT = 58700 + (PORT % 1000)  # 托盘单实例锁端口（只 bind 不 listen）

# ---- 子进程托管 server.py 所需常量 ----
SERVER_PY = os.path.join(_HERE, 'server.py')
SERVER_LOG = os.path.join(_HERE, '.tray_child_server.log')  # 子进程 stdout/stderr 落盘
RESTART_LOCK = os.path.join(_HERE, '.restart_lock')  # restart_server.py 的并发锁文件

# 托管状态（main() 内赋值，监督线程/回调读取）
_child_proc = [None]     # 当前 server.py 子进程（Popen）
_last_spawn = [0.0]      # 上次拉起子进程的时间（补拉冷却用）
_quit_flag = None        # threading.Event：退出流程进行中，监督线程停止补拉


def _port_open(port, timeout=0.5):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=timeout):
            return True
    except OSError:
        return False


def _spawn_child_server():
    """以独立子进程方式拉起裸 server.py（重启链路杀旧/拉新都只发生在它身上，
    托盘进程的存亡与后台重启彻底解耦——双图标的结构性根源在此切断）。
    启动方式与 restart_server.start_new 同款：stdout 重定向落盘 + NO_WINDOW。"""
    exe = sys.executable
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    # 日志超限轮转（保留一代 .log.1）：此刻旧子进程已退出、句柄已释放，改名安全；
    # 改名失败则跳过（下次再试），绝不阻塞拉起。【工程化整改 20261123】
    try:
        if os.path.exists(SERVER_LOG) and os.path.getsize(SERVER_LOG) > 5 * 1024 * 1024:
            try:
                _rotated = SERVER_LOG + '.1'
                if os.path.exists(_rotated):
                    os.remove(_rotated)
                os.replace(SERVER_LOG, _rotated)
            except OSError:
                pass
    except Exception:
        pass
    try:
        out = open(SERVER_LOG, 'ab')
        proc = subprocess.Popen([exe, SERVER_PY], cwd=_PROJECT_ROOT,
                                stdout=out, stderr=subprocess.STDOUT,
                                creationflags=flags)
    except Exception as e:
        print('[Tray] 拉起后台子进程失败:', e)
        return None
    _child_proc[0] = proc
    _last_spawn[0] = time.time()
    print('[Tray] 后台子进程已拉起 PID=%s' % proc.pid)
    return proc


def _restart_in_progress():
    """restart_server.py 正在执行重启（.restart_lock 60 秒内）时监督线程必须让路：
    它自己会杀旧拉新；监督线程若同时补拉，Windows SO_REUSEADDR 下双进程绑同一端口
    不报错但请求会全被投到死 socket（server_runtime._phase_serve 注释里的老坑）。"""
    try:
        return (time.time() - os.path.getmtime(RESTART_LOCK)) < 90
    except OSError:
        return False


def _supervise_server():
    """监督守护线程：只保一件事——「端口有人服务」。
      - 子进程意外退出且端口没人听 → 冷却后补拉（自愈，旧行为是托盘变僵尸图标）；
      - 端口被外部进程服务（restart_server 拉的新进程 / 用户手跑的 server.py）→ 不动，
        端口健康即目标，不纠结服务者是谁；
      - restart_server 持锁期间让路；退出流程中停止补拉。"""
    while not _quit_flag.is_set():
        time.sleep(3)
        try:
            if _port_open(PORT):
                continue
            child = _child_proc[0]
            if child is not None and child.poll() is None:
                continue  # 子进程还活着（启动中/正在优雅关停），给它时间
            if _restart_in_progress():
                continue  # 重启脚本正在杀旧拉新，别抢
            if time.time() - _last_spawn[0] < 15:
                continue  # 补拉冷却，防止异常情况下疯狂拉起
            print('[Tray] 后台服务不在（子进程已退出且端口无监听），自动补拉')
            _spawn_child_server()
        except Exception as e:
            print('[Tray] 监督线程异常:', e)


def _open_ui():
    """优先用 pywebview 独立窗口（桌面客户端），失败回退浏览器。
    单实例：已有窗口进程则发聚焦通知，不再开新窗口。"""
    exe = sys.executable
    script = os.path.join(_HERE, 'webview_client.py')
    if not os.path.exists(script):
        from webview_client import open_url_maximized  # 20261123 补：回退分支缺延迟导入
        open_url_maximized(f'http://127.0.0.1:{PORT}/')
        return
    # 窗口进程单实例检测：锁文件 + OpenProcess + PID 复用校验（与 webview_client 侧对齐）
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
    # 【初始最大化修复 2026-10-27】回退浏览器也用 --start-maximized 启动
    try:
        from webview_client import open_url_maximized
        open_url_maximized(f'http://127.0.0.1:{PORT}/')
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


def _graceful_stop_exit(icon):
    """【防幽灵图标 2026-11】stop 是异步的（向消息循环投 WM_STOP），随后立刻
    os._exit(0) 会抢在 Shell_NotifyIcon(NIM_DELETE) 注销完成之前把进程杀掉，
    留下一个死图标——右下角出现两个图标，点一下才被 explorer 清掉。
    修复：stop 后给消息循环 0.6 秒完成图标注销，再退出。"""
    try:
        icon.stop()
    except Exception:
        pass
    # 【加长 2026-11-13】0.6s 在低配机/资源紧张时仍偶有残留（用户实报"托盘出现两个
    # 图标、鼠标划过才消一个"即此幽灵图标）。加长到 1.2s 给 NIM_DELETE 更多完成时间。
    time.sleep(1.2)
    os._exit(0)


def _async(fn):
    """【右键无响应修复 2026-11】把菜单回调包装成异步执行。
    根因：pystray 的 Windows 菜单回调是同步调用——旧版 _on_open 里最长等 15 秒
    服务就绪、_on_quit 里最长等 12 秒端口释放、_confirm_box 是模态阻塞，
    这些都在 pystray 的消息循环线程里跑；期间用户再点左键/右键，托盘完全无响应，
    表现为"图标点了没反应、关不掉"。
    修复：回调立即返回，真正工作丢到独立 daemon 线程，菜单/图标永远秒响应。"""
    def wrapper(icon=None, item=None, *a, **kw):
        threading.Thread(target=fn, args=(icon, item) + a, kwargs=kw,
                         name='zf-tray-cb', daemon=True).start()
    return wrapper


def _confirm_box(title, text, warn=True):
    """自研 tkinter 模态确认框（C2，用于退出这类不可逆操作二次确认）。
    返回 True=确认，False=取消。
    【弃用 MessageBoxW 2026-11】部分 Windows 版本下后台线程弹的系统消息框
    不置顶、抢不到焦点，按钮点不动；且系统框样式不可控。改为自研 tkinter
    对话框：显式 attributes('-topmost', True) 置顶 + focus_force() 抢焦点 +
    lift()/激活，跨 Windows 版本表现一致。tkinter 随 Python 自带，无新依赖。
    失败时放行返回 True：宁可少一次二次确认，也不能让程序关不掉。
    【视觉低调化 2026-11-22】去掉顶部亮蓝品牌条与亮蓝大按钮；对齐 Web 端
    _confirmDialog（app-backup.js）的观感：暗色卡片 #1e222d、正文柔和灰、
    按钮右对齐（取消=暗色描边次按钮，确定=暗红主按钮，危险操作语义色），
    悬停微亮。全低饱和配色，安静不抢眼。"""
    try:
        import tkinter  # noqa: F401  先探测：项目内嵌 Python 可能不带 tkinter
        import tkinter as tk
        result = {'ok': False}

        box = tk.Tk()
        box.title(title)
        box.resizable(False, False)
        box.attributes('-topmost', True)
        try:
            box.attributes('-toolwindow', True)  # 隐藏最大化/最小化按钮，像系统对话框
        except Exception:
            pass
        # 【视觉低调化 2026-11-22】配色取自 Web 端 _confirmDialog（app-backup.js）：
        # 卡片 #1e222d / 分隔线 #2e323e / 正文 #b8bcc8 / 确定按钮暗红 #a8383d。
        # 不再有 #0984e3 亮蓝。
        C_BG, C_LINE, C_TEXT, C_TEXT2 = '#1e222d', '#2e323e', '#f0f0f2', '#b8bcc8'
        C_BTN, C_BTN_HOVER = '#262a35', '#2e3340'
        C_BTN_BORDER, C_BTN_TEXT = '#3a3f4d', '#c8ccd8'
        C_OK, C_OK_HOVER = '#a8383d', '#b84246'
        box.configure(bg=C_BG)

        # 【标题栏暗色 2026-11】tkinter 标题栏由系统渲染，用 DWM API 涂成暗色：
        # DWMWA_USE_IMMERSIVE_DARK_MODE(20)=启用暗色标题栏；DWMWA_CAPTION_COLOR(35)
        # 直接指定标题栏颜色（Win11 22000+ 支持）。Win10 无 35 号属性会静默失败，
        # 但 20 号在 Win10 1809+ 生效，两层兜底；再旧系统保持系统默认色，不影响功能。
        def _apply_dark_titlebar():
            """【标题栏暗色 2026-11】tkinter 标题栏由系统渲染，用 DWM API 涂成暗色。
            DWMWA_USE_IMMERSIVE_DARK_MODE(20)=启用暗色标题栏；DWMWA_CAPTION_COLOR(35)
            直接指定标题栏颜色（Win11 22000+ 支持）。Win10 无 35 号属性会静默失败，
            但 20 号在 Win10 1809+ 生效，两层兜底；再旧系统保持系统默认色，不影响功能。
            【白标题栏修复】DWM 属性必须在窗口实际映射显示后才生效——
            旧版在 Tk() 创建后立即调用，窗口还没显示，属性被系统重置 → 白色。
            现在封装成函数，窗口映射前后各涂一次（after 兜底），确保生效。"""
            try:
                import ctypes
                hwnd = box.winfo_id()
                # 注意：winfo_id 是客户区子窗口，真正的顶层窗口句柄要取父级
                top = ctypes.windll.user32.GetParent(hwnd) or hwnd
                for attr, val in ((20, 1), (35, 0x002D221E)):  # COLORREF 是 0x00BBGGRR → #1e222d
                    ctypes.windll.dwmapi.DwmSetWindowAttribute(
                        top, attr, ctypes.byref(ctypes.c_int(val)), 4)
            except Exception:
                pass
        _apply_dark_titlebar()

        # 【视觉低调化 2026-11-22】不再有顶部蓝色品牌条；内容区 = 标题 + 正文，
        # wraplength 兜底未来单行长文案自动换行。
        frm = tk.Frame(box, bg=C_BG)
        frm.pack(padx=26, pady=(22, 8), fill='x')
        tk.Label(frm, text=title, bg=C_BG, fg=C_TEXT,
                 font=('Microsoft YaHei UI', 11, 'bold'), justify='left').pack(anchor='w')
        tk.Label(frm, text=text, bg=C_BG, fg=C_TEXT2,
                 font=('Microsoft YaHei UI', 10), justify='left',
                 wraplength=340).pack(anchor='w', pady=(8, 0))

        def _ok():
            result['ok'] = True
            box.destroy()

        def _cancel():
            box.destroy()

        # 按钮区：上方一条极淡分隔线压住层次，按钮右对齐（取消左、确定右），
        # 与 Web 端 _confirmDialog 同一排布；hover 用 Enter/Leave 微调底色。
        tk.Frame(box, bg=C_LINE, height=1).pack(fill='x')
        btns = tk.Frame(box, bg=C_BG)
        btns.pack(fill='x', padx=20, pady=(12, 16))

        def _mkbtn(label, primary):
            bg0 = C_OK if primary else C_BTN
            hover = C_OK_HOVER if primary else C_BTN_HOVER
            b = tk.Button(btns, text=label, width=8,
                          command=_ok if primary else _cancel,
                          font=('Microsoft YaHei UI', 9, 'bold' if primary else 'normal'),
                          bg=bg0, fg='#ffffff' if primary else C_BTN_TEXT,
                          activebackground=hover,
                          activeforeground='#ffffff' if primary else C_TEXT,
                          bd=0, relief='flat', cursor='hand2',
                          highlightthickness=0 if primary else 1,
                          highlightbackground=C_BTN_BORDER, highlightcolor=C_BTN_BORDER)
            b.bind('<Enter>', lambda e, w=b, c=hover: w.configure(bg=c))
            b.bind('<Leave>', lambda e, w=b, c=bg0: w.configure(bg=c))
            b.pack(side='right', padx=(8, 0), ipady=4)

        _mkbtn('确定', True)
        _mkbtn('取消', False)
        box.protocol('WM_DELETE_WINDOW', _cancel)
        box.bind('<Escape>', lambda e: _cancel())

        # 居中显示
        box.update_idletasks()
        w, h = box.winfo_width(), box.winfo_height()
        sw, sh = box.winfo_screenwidth(), box.winfo_screenheight()
        box.geometry(f'+{(sw - w) // 2}+{(sh - h) // 2}')

        # 【白标题栏修复】窗口映射显示后立即补涂一次 DWM 暗色属性（此时才真正生效）
        _apply_dark_titlebar()

        # 置顶 + 抢焦点（跨版本兼容关键动作）
        box.lift()
        box.focus_force()
        box.after(200, lambda: (box.lift(), box.focus_force()))

        box.mainloop()
        return result['ok']
    except Exception as e:
        # tkinter 不可用（嵌入式 Python 常不带 tkinter）或弹框失败时的兜底：
        # 先尝试带置顶标志的系统 MessageBoxW；连它也失败则放行退出。
        # 原则：宁可少一次二次确认，也不能让程序关不掉。
        print('[Tray] 自研确认框不可用，回退系统框:', e)
        try:
            import ctypes
            rc = ctypes.windll.user32.MessageBoxW(
                0, text, title,
                0x1 | 0x40000 | 0x10000 | 0x1000)  # 【去图标 2026-11】去掉 0x30/0x40 警告/信息图标位，提示更精简
            if rc == 0:
                print('[Tray] 系统确认框返回0（调用失败），跳过二次确认直接继续')
                return True
            return rc == 1
        except Exception as e2:
            print('[Tray] 系统确认框也失败，跳过二次确认直接继续:', e2)
            return True


def main():
    import pystray
    from pystray import Menu, MenuItem as Item

    # 【互斥修正 2026-11-21】旧版此处用 bind 58766 做"反向互斥"，结果旧托盘自己
    # 长期占用 58766，把新版主托盘挡在门外（启动即退出→只剩死图标）。已删除该段：
    # 主托盘只认自己的单实例锁 58600（见下），quick_ask 是否运行由其自身锁管理。

    # 【托盘单实例】抢锁失败说明已有托盘在跑（无论其处于托管还是附加模式），直接退出，
    # 不再进附加模式重复画图标。锁在进程存活期间一直持有，托盘退出即释放。
    global _tray_lock_sock
    try:
        _tray_lock_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _tray_lock_sock.bind(('127.0.0.1', TRAY_LOCK_PORT))
    except OSError:
        print('[Tray] 已有托盘实例在跑（锁端口 %d 被占），本实例退出' % TRAY_LOCK_PORT)
        return

    # 已有实例在跑则先等它退出（重启场景，最多等 10 秒）
    for _ in range(20):
        if not _port_open(PORT):
            break
        time.sleep(0.5)
    # 【附加模式】端口仍被占（服务由别的方式启动，如裸 server.py）：
    # 不再直接退出，而是仍创建托盘图标（不启动服务线程），保证图标常驻
    attach_mode = _port_open(PORT)
    # 【静默启动】托盘提示日志默认隐藏（用户要求启动不打印这些提示）；
    # 需要排查时设置环境变量 ZF_TRAY_VERBOSE=1 可恢复打印
    _verbose = os.environ.get('ZF_TRAY_VERBOSE') == '1'
    if attach_mode:
        if _verbose:
            print(f'[Tray] 端口 {PORT} 已有服务在运行，进入附加模式（仅托盘，不托管服务）')

    # 【空闲自动重启】每20分钟检查：暴击数==0 持续10秒 → 无感重启后台
    try:
        import idle_auto_restart
        idle_auto_restart.start_watcher()
    except Exception as e:
        print('[Tray] 空闲自动重启线程启动失败:', e)

    # 全局退出旗标：监督线程据此停止补拉（在 _on_quit 确认后置位）
    global _quit_flag
    _quit_flag = threading.Event()

    def _on_open(icon, item):
        # 等服务就绪再开页面
        for _ in range(50):
            if _port_open(PORT):
                break
            time.sleep(0.3)
        _open_ui()

    def _on_restart(icon, item):
        # 【根治双图标 2026-11-22】重启完全交给独立脚本 restart_server.py
        # （杀旧裸 server 子进程 → 拉新 → 健康检查），托盘进程全程不动。
        # 旧版流程是"托盘 icon.stop()+os._exit 交棒 → restart_server 再 relaunch_tray
        # 补图标"，交棒与补图之间全是竞态：旧图标常因 /api/app/quit 的 os._exit(0)
        # 被抢杀而留死图标，新图标跟着补上 → 右下角双图标。现在图标永不换进程，
        # 从结构上不可能再出现"死图标+新图标"。
        try:
            exe = sys.executable  # 沿用当前解释器（改名副本「朱峰智能体无限.exe」保持任务栏显示名）
            script = os.path.join(_HERE, 'restart_server.py')
            # cmd start /b 中转脱离本进程树（防 taskkill /T 连带），argv + shell=False 防注入
            cmd = ['cmd', '/c', 'start', '', '/b', exe, script]
            subprocess.Popen(cmd, shell=False, cwd=_PROJECT_ROOT,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            # 【C1 体验反馈】给一个气泡告知后台正在重启，避免用户误以为"被关掉了"。
            _notify(icon, '朱峰智能体', '正在重启后台，稍候界面会自动恢复…')
        except Exception as e:
            print('[Tray] 重启触发失败:', e)
            _notify(icon, '朱峰智能体', '重启触发失败：%s' % e)

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
        # 【C2 危险操作二次确认】退出会停服/丢界面，属不可逆操作。
        # 【统一退出流程 2026-11-22】不再区分附加/托管两套退出路径：
        # 先优雅停后台（/api/app/quit → 停热更新→记忆库git快照→shutdown→退出），
        # 等端口释放，残留才按端口精确强杀（永不碰托盘进程自身），
        # 最后注销图标 → os._exit。顺序保证：图标一定经 NIM_DELETE 注销，不留死图标。
        if not _confirm_box('退出系统',
                            '确定退出朱峰智能体？\n将保存记忆库快照并关停后台服务，界面随后关闭。'):
            return
        _quit_flag.set()  # 停监督补拉：防止退出过程中服务又被自动拉起
        # 【P1 退出×重启复活拦截 2026-11-23】落盘退出旗标（时间戳）：
        # idle_auto_restart / network_guard 等后台触发源会在退出后拉起 restart_server，
        # restart_server 见 120 秒内的旗标即放弃拉起并写 .restart_result.json，
        # 根治"用户明明点了关闭，几分钟后服务又自己复活"。失败不阻断退出主流程。
        try:
            _quit_flag_path = os.path.join(_PROJECT_ROOT, 'private', '.app_quit_flag')
            os.makedirs(os.path.dirname(_quit_flag_path), exist_ok=True)
            with open(_quit_flag_path, 'w', encoding='utf-8') as _f:
                _f.write(str(time.time()))
        except Exception as _e:
            print('[Tray] 写退出旗标失败(不影响退出):', _e)
        _notify(icon, '朱峰智能体', '正在保存记忆库并优雅退出…')
        # 1) 请求后台优雅关停（裸 server 进程的停机看门狗完成快照后自行退出）
        try:
            import urllib.request
            urllib.request.urlopen(urllib.request.Request(
                'http://127.0.0.1:%d/api/app/quit' % PORT, method='POST', data=b''), timeout=3)
        except Exception as e:
            print('[Tray] 优雅关停请求失败，稍后按端口强杀兜底:', e)
        # 2) 等端口释放（最多 15 秒，快照落盘通常数秒）；超时仍有监听 → 精确强杀
        for _ in range(30):
            if not _port_open(PORT):
                break
            time.sleep(0.5)
        me = os.getpid()
        for pid in _find_port_pids(PORT):
            if pid != me:
                _kill_pid(pid)
        # 3) 关掉主界面窗口进程；图标注销完成后才允许进程退出
        _kill_ui_process()
        _graceful_stop_exit(icon)

    if attach_mode:
        # 【附加值守】端口已被外部 server.py 占用（如 restart_server 拉起的新后台、
        # 用户手跑的裸 server）：不重复拉子进程，只补图标；监督线程继续值守，
        # 若该外部服务日后消亡且端口空出，会自动接管补拉子进程。
        pass
    else:
        # 【子进程托管 2026-11-22】不再线程内跑 server.main()——那会让监听 PID
        # 变成托盘进程自己，所有重启链路都会把托盘当成"旧后台"误杀留死图标。
        _spawn_child_server()
        # 监督守护线程：子进程崩溃自动补拉（自愈）
        threading.Thread(target=_supervise_server, name='zf-supervisor', daemon=True).start()
    # 【启动自动开窗】等服务就绪（最多 30 秒）再开窗；已开窗时 webview 单实例
    # 机制会聚焦已有窗口，不会重复开窗。
    def _auto_open():
        for _ in range(100):
            if _port_open(PORT):
                break
            time.sleep(0.3)
        _open_ui()
    threading.Thread(target=_auto_open, name='zf-autopen', daemon=True).start()
    if attach_mode:
        threading.Thread(target=_supervise_server, name='zf-supervisor', daemon=True).start()

    # 设置独立 AppUserModelID：让 Windows 把本进程当作独立应用（而非 pythonw.exe），
    # 任务栏/跳转列表归属朱峰应用，避免显示 Python 默认图标。
    # 【v2 2026-11-22】旧 AUMID「ZF.ZhuFengAgentInfinity」在 shell AppResolver 缓存里
    # 残留了 Python 蛇标的图标关联（任务管理器分组图标一直显示旧标志，清图标缓存/
    # 重启 Explorer 均无效），换新 AUMID 强制全新解析。
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('ZF.ZhuFengAgentInfinity.v2')
    except Exception:
        pass

    mode_tag = '(附加值守·端口占用)' if attach_mode else ''

    # 【左键弹菜单 2026-11】pystray Windows 后端的真实行为（实查 _win32._on_notify）：
    # 左键 WM_LBUTTONUP → self()（激活 default 项）；没有 default 项时左键什么都不做。
    # 只有右键 WM_RBUTTONUP 才弹菜单。所以"删掉 default 项左键就会弹菜单"不成立。
    # 修法：子类覆写 _on_notify，把左键点击改写成右键事件再交给父类 → 左键=右键同一菜单。
    class _TrayIcon(pystray.Icon):
        def _on_notify(self, wparam, lparam):
            WM_LBUTTONUP, WM_RBUTTONUP = 0x0202, 0x0205
            if lparam in (0x0202, 0x0203):  # 左键单击/双击均转右键 → 弹菜单
                lparam = 0x0205
            return super()._on_notify(wparam, lparam)

    # 【菜单精简 2026-11】左键/右键弹出同一菜单，仅保留 3 项：显示主菜单/重启后台/彻底关闭。
    icon = _TrayIcon(
        name='zf_agent',
        icon=_make_icon_image(),
        title=f'朱峰智能体 v{VERSION} (端口 {PORT}) {mode_tag}',
        menu=Menu(
            Item('显示主界面', _async(_on_open)),
            Item('重启后台', _async(_on_restart)),
            Item('关闭', _async(_on_quit)),
        ),
    )
    # 【回调异步化】_async 包装：菜单回调立即返回，工作丢独立线程执行，避免托盘卡死
    if _verbose:
        print(f'[Tray] 托盘已启动（{"附加值守" if attach_mode else "子进程托管"}），服务端口 {PORT}，右键图标可操作')
    icon.run()


if __name__ == '__main__':
    main()
