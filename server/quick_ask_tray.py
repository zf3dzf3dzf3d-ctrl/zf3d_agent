# -*- coding: utf-8 -*-
"""
quick_ask_tray.py — P0 托盘壳最小原型：热键呼出一句话
=======================================================
蜂群收口定稿 P0 验收：任何前台程序中 热键→一句话→通知反馈，全链路 <5 秒。

组成（全部复用现有底座，零新 pip 依赖）：
  - pynput GlobalHotKeys 监听 Alt+Space（global_hotkey.py 同款机制）
  - 无边框置顶 tkinter 输入条（失焦即收起，"水的无形"）
  - POST /api/tools/monitor {action:'send', chat_id, message} 下发一句话
    （与 monitor_watch.js 恢复通道同一条链路，后台窗口自动处理）
  - pystray 托盘图标 + notify 气泡反馈提交结果；右键菜单：打开工作台/退出

用法：python\pythonw.exe server\quick_ask_tray.py   （后台无窗常驻）
配置：private/quick_ask.json  可选 {"hotkey": "<alt>+<space>", "chat_id": "xxx"}
      chat_id 缺省自动取 monitor list 第一个活跃窗口。
"""
import os
import sys
import json
import time
import socket
import threading
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
_BASE = os.path.dirname(_HERE)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

LOG = os.path.join(_HERE, '.quick_ask.log')
CFG = os.path.join(_BASE, 'private', 'quick_ask.json')
LOCK_PORT = 58766   # 单实例锁


def log(msg):
    try:
        with open(LOG, 'a', encoding='utf-8', errors='replace') as f:
            f.write('[%s] %s\n' % (time.strftime('%m-%d %H:%M:%S'), msg))
    except Exception:
        pass


def _load_cfg():
    try:
        with open(CFG, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return {}


def _api_port():
    try:
        with open(os.path.join(_BASE, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        return int(cfg.get('api_port') or cfg.get('port') or 8000)
    except Exception:
        return 8000


def _post(path, payload, timeout=8):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (_api_port(), path),
                                 data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def _pick_chat_id():
    """优先用配置；否则取 monitor list 第一个会话。"""
    cid = (_load_cfg().get('chat_id') or '').strip()
    if cid:
        return cid
    try:
        r = _post('/api/tools/monitor', {'action': 'list'})
        sessions = r.get('sessions') or r.get('results') or []
        if sessions:
            s0 = sessions[0]
            return s0.get('session_id') or s0.get('chat_id') or s0.get('id') or ''
    except Exception as e:
        log('pick_chat_id 失败: %s' % e)
    return ''


# ---------------- 托盘 ----------------
_tray = None


def notify(title, msg):
    try:
        if _tray:
            _tray.notify(msg, title=title)
    except Exception:
        pass


def _open_workbench():
    import webbrowser
    webbrowser.open('http://127.0.0.1:%d/' % _api_port())


# ---------------- 输入条（主线程跑 tk，热键线程投递） ----------------
_box_evt = None   # threading.Event 由 tk 主循环消费


def _ask_loop():
    """tkinter 必须在主线程；这里作为独立常驻循环等事件。"""
    try:
        import tkinter  # noqa: F401
    except Exception:
        log('无 tkinter，改用 PowerShell 输入条兜底')
        # 兜底：热键事件直接起一个 PowerShell WinForms 小窗（零 pip 依赖）
        while True:
            _evt_wait()
            threading.Thread(target=_ps_ask, daemon=True).start()
    return _tk_ask_loop()


def _evt_wait():
    global _box_evt
    while _box_evt is None:
        time.sleep(0.1)
    _box_evt = None


_PS_ASK = r'''
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'; $f.TopMost = $true; $f.BackColor = [Drawing.Color]::FromArgb(30,30,46)
$f.Width = 560; $f.Height = 64
$f.StartPosition = 'Manual'
$f.Location = New-Object Drawing.Point(([System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Width - 560) / 2, 120)
$t = New-Object System.Windows.Forms.TextBox
$t.Font = New-Object Drawing.Font('Microsoft YaHei UI', 13)
$t.BackColor = [Drawing.Color]::FromArgb(49,50,68); $t.ForeColor = [Drawing.Color]::FromArgb(205,214,244)
$t.BorderStyle = 'None'; $t.Dock = 'Fill'
$t.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $f.Close() } })
$t.Add_LostFocus({ $f.Close() })
$f.Controls.Add($t); $f.Add_Shown({ $t.Focus() })
$f.Show(); $f.Activate()
$done = $false
$t.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $script:done = $true; $f.Close() } })
[System.Windows.Forms.Application]::Run($f)
if ($script:done -and $t.Text.Trim()) {
  [IO.File]::WriteAllText($env:TEMP + '\zf_quick_ask.txt', $t.Text.Trim(), [Text.Encoding]::UTF8)
}
'''


def _ps_ask():
    """PowerShell 弹输入条；用户回车则读回文本发送。"""
    import subprocess
    global _ps_ask
    tf = os.path.join(os.environ.get('TEMP', _HERE), 'zf_quick_ask.txt')
    try:
        if os.path.exists(tf):
            os.remove(tf)
    except Exception:
        pass
    try:
        subprocess.Popen(['powershell', '-NoProfile', '-STA', '-Command',
                          _PS_ASK.replace('$env:TEMP + ', "'%s' + " % tf.replace('\\', '\\\\'))],
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except Exception as e:
        log('PS 输入条失败: %s' % e)
        return
    for _ in range(300):   # 最多等 30 秒
        time.sleep(0.1)
        if os.path.exists(tf):
            break
    else:
        return
    time.sleep(0.3)   # 等写完
    try:
        with open(tf, 'r', encoding='utf-8') as f:
            text = f.read().strip()
        os.remove(tf)
    except Exception:
        return
    if text:
        threading.Thread(target=_send, args=(text,), daemon=True).start()


def _tk_ask_loop():
    global _box_evt
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()

    def build():
        win = tk.Toplevel(root)
        win.overrideredirect(True)
        win.attributes('-topmost', True)
        win.configure(bg='#1e1e2e')
        w, h = 560, 64
        sw = win.winfo_screenwidth()
        win.geometry('%dx%d+%d+%d' % (w, h, (sw - w) // 2, 120))

        ent = tk.Entry(win, font=('Microsoft YaHei UI', 13), bg='#313244',
                       fg='#cdd6f4', insertbackground='#cdd6f4',
                       relief='flat', bd=12)
        ent.pack(fill='both', expand=True)
        ent.focus_set()

        def submit(evt=None):
            text = ent.get().strip()
            hide()
            if text:
                threading.Thread(target=_send, args=(text,), daemon=True).start()

        def hide(evt=None):
            win.withdraw()
            ent.delete(0, 'end')

        win.bind('<Return>', submit)
        win.bind('<Escape>', hide)
        win.bind('<FocusOut>', hide)   # 失焦即收起
        win._submit = submit
        return win, ent

    win, ent = build()
    win.withdraw()

    def show():
        win.deiconify()
        ent.focus_set()

    def pump():
        global _box_evt, _monitor_evt
        if _box_evt is not None:
            _box_evt = None
            show()
        if _monitor_evt is not None:
            _monitor_evt = None
            try:
                import tray_monitor
                w = _monitor_win[0]
                if w is not None and w.winfo_exists():
                    w.deiconify(); w.lift()
                else:
                    _monitor_win[0] = tray_monitor.run_panel(root=root, topmost=False)
            except Exception as e:
                log('监控面板失败: %s' % e)
        root.after(60, pump)

    pump()
    root.mainloop()


def _send(text):
    t0 = time.time()
    try:
        cid = _pick_chat_id()
        if not cid:
            notify('朱峰智能体', '未找到可用对话窗口，请先在工作台开一个对话')
            return
        r = _post('/api/tools/monitor', {'action': 'send', 'chat_id': cid, 'message': text})
        ok = r.get('ok', r.get('success', True)) and not r.get('error')
        dt = time.time() - t0
        if ok:
            notify('已受理 ✓ %.1fs' % dt, '「%s」→ 后台处理中，完成会通知' % text[:24])
            log('sent %r -> %s (%.1fs)' % (text[:40], cid, dt))
        else:
            notify('发送失败 ✗', str(r.get('error'))[:80])
    except Exception as e:
        notify('发送失败 ✗', str(e)[:80])
        log('send 失败: %s' % e)


# ---------------- 热键 ----------------
def _hotkey_loop(combo):
    from pynput import keyboard

    def on_activate():
        global _box_evt
        _box_evt = time.time()
        log('热键触发')

    try:
        with keyboard.GlobalHotKeys({combo: on_activate}) as h:
            h.join()
    except Exception as e:
        log('热键异常: %s' % e)
        notify('朱峰智能体', '热键监听失败：%s（可用托盘菜单兜底）' % str(e)[:40])


# ---------------- 监控面板 ----------------
def _open_monitor():
    """从托盘线程拉起监控面板（需在 tkinter 主线程创建控件，走事件泵）。"""
    global _monitor_evt
    _monitor_evt = time.time()
    log('托盘菜单：监控面板')


_monitor_evt = None
_monitor_win = [None]


def main():
    # 单实例锁
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        log('已有实例在跑，退出')
        return

    import pystray
    from pystray import Menu, MenuItem as Item
    from PIL import Image, ImageDraw

    img = Image.new('RGB', (64, 64), '#7C6CFF')
    d = ImageDraw.Draw(img)
    d.ellipse((16, 16, 48, 48), fill='#cdd6f4')

    cfg = _load_cfg()
    combo = cfg.get('hotkey') or '<alt>+<space>'

    global _tray
    _tray = pystray.Icon('zf_quick_ask', img, '朱峰智能体 · 一句话 (Alt+Space)',
                         Menu(
                             Item('打开工作台', lambda *_: _open_workbench(), default=True),
                             Item('监控面板', lambda *_: _open_monitor()),
                             Item('退出', lambda *_: _tray.stop()),
                         ))

    threading.Thread(target=_hotkey_loop, args=(combo,), daemon=True).start()
    threading.Thread(target=_ask_loop, daemon=True).start()
    log('启动完成 hotkey=%s port=%d' % (combo, _api_port()))
    _tray.run()


if __name__ == '__main__':
    main()
