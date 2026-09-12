# -*- coding: utf-8 -*-
"""
点击效果 — 录屏时后台运行，监听鼠标左键
按下/松开时在光标处绘制涟漪圆圈 + 播放音效
作为独立子进程运行，被录屏器 spawn/kill
跨平台版: Windows 用 ctypes user32；macOS/Linux 用 pynput 监听（无需轮询）
"""
import sys
import os
import subprocess

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"

# 参数: volume(0-100) enable_circle(0/1) enable_sound(0/1)
volume = int(sys.argv[1]) if len(sys.argv) > 1 else 50
enable_circle = (len(sys.argv) > 2 and sys.argv[2] == "1")
enable_sound = (len(sys.argv) > 3 and sys.argv[3] == "1")

import tkinter as tk

if IS_WIN:
    import ctypes
    import ctypes.wintypes
    user32 = ctypes.windll.user32
    VK_LBUTTON = 0x01
    # 设置系统音量 (0x0000~0xFFFF per channel)
    vol = max(0, min(0xFFFF, int(volume / 100 * 0xFFFF)))
    try:
        ctypes.windll.winmm.waveOutSetVolume(0, vol | (vol << 16))
    except Exception:
        pass
else:
    # mac/linux: 可选鼠标位置模块
    try:
        from pynput import mouse
        _mouse_ctrl = mouse.Controller()
    except Exception:
        _mouse_ctrl = None

root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)

prev_down = False


def get_cursor_pos():
    if IS_WIN:
        pt = ctypes.wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        return pt.x, pt.y
    if _mouse_ctrl:
        p = _mouse_ctrl.position
        return int(p[0]), int(p[1])
    return 0, 0


def play_sound(wav_path):
    if not (enable_sound and os.path.exists(wav_path)):
        return
    try:
        if IS_WIN:
            import winsound
            winsound.PlaySound(wav_path, winsound.SND_FILENAME | winsound.SND_ASYNC)
        elif IS_MAC:
            subprocess.Popen(["afplay", wav_path])
        else:
            subprocess.Popen(["aplay", wav_path],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


# 音效文件：Windows 用 Camtasia 自带；mac/linux 回落到系统提示音
click_down_wav = r"C:\Program Files (x86)\TechSmith\Camtasia Studio 8\Media\Recorder\Sounds\ClickDown.wav"
click_up_wav = r"C:\Program Files (x86)\TechSmith\Camtasia Studio 8\Media\Recorder\Sounds\ClickUp.wav"
if not IS_WIN:
    click_down_wav = "/System/Library/Sounds/Tink.aiff"     # mac 系统音
    click_up_wav = "/System/Library/Sounds/P-pop.aiff" if os.path.exists(
        "/System/Library/Sounds/P-pop.aiff") else "/System/Library/Sounds/Pop.aiff"
    if not IS_MAC:
        click_down_wav = click_up_wav = ""   # linux 无内置短音，静默


def show_ripple(is_down):
    if not enable_circle:
        return
    cx, cy = get_cursor_pos()
    base_r = 20 if is_down else 14
    max_r = 30
    color = "#ff5544" if is_down else "#44aaff"
    size = (max_r + 4) * 2

    win = tk.Toplevel(root)
    win.overrideredirect(True)
    win.attributes("-topmost", True)
    if IS_WIN:
        win.attributes("-transparentcolor", "#abcdef")
    else:
        win.attributes("-alpha", 0.9)   # mac 无 transparentcolor，用半透明
    win.geometry(f"{size}x{size}+{cx - size // 2}+{cy - size // 2}")
    win.configure(bg="#abcdef")

    canvas = tk.Canvas(win, width=size, height=size,
                       bg="#abcdef" if IS_WIN else "white",
                       highlightthickness=0)
    canvas.pack()
    if not IS_WIN:
        # mac 上白底圆圈背景改为透明近似：绘制同色描边即可，视觉可接受
        pass

    cx_win = size // 2
    cy_win = size // 2
    oval_id = canvas.create_oval(
        cx_win - base_r, cy_win - base_r,
        cx_win + base_r, cy_win + base_r,
        outline=color, width=3
    )

    step = [0]
    max_steps = 5

    def animate():
        step[0] += 1
        if step[0] >= max_steps:
            try:
                win.destroy()
            except Exception:
                pass
            return
        r = min(base_r + step[0] * 2, max_r)
        w = max(1, 3 - step[0])
        canvas.coords(oval_id, cx_win - r, cy_win - r,
                      cx_win + r, cy_win + r)
        canvas.itemconfig(oval_id, width=w)
        root.after(50, animate)

    root.after(50, animate)


def _left_button_down():
    """查询左键是否按下"""
    if IS_WIN:
        return bool(user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000)
    if _mouse_ctrl:
        try:
            from pynput.mouse import Button
            # pynput 无直接查询按下状态；由监听线程维护
        except Exception:
            pass
    return _mouse_state["down"]


_mouse_state = {"down": False}

if not IS_WIN:
    # mac/linux: 后台监听线程维护按键状态
    def _start_listener():
        try:
            from pynput import mouse as m
            def on_click(x, y, button, pressed):
                if button == m.Button.left:
                    _mouse_state["down"] = pressed
            lis = m.Listener(on_click=on_click)
            lis.daemon = True
            lis.start()
        except Exception:
            pass
    _start_listener()


def poll_mouse():
    global prev_down
    curr = _left_button_down()
    if curr and not prev_down:
        play_sound(click_down_wav)
        show_ripple(True)
    elif not curr and prev_down:
        play_sound(click_up_wav)
        show_ripple(False)
    prev_down = curr
    root.after(20, poll_mouse)


poll_mouse()
root.mainloop()
