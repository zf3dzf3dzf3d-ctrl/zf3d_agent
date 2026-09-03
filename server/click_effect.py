# -*- coding: utf-8 -*-
"""
点击效果 — 录屏时后台运行，监听鼠标左键
按下/松开时在光标处绘制涟漪圆圈 + 播放音效
作为独立子进程运行，被录屏器 spawn/kill
"""
import sys
import os
import ctypes
import ctypes.wintypes
import tkinter as tk
import winsound

# 参数: volume(0-100) enable_circle(0/1) enable_sound(0/1)
# 【安全修复】默认全部关闭：只有显式传 "1" 才启用，防止进程遗留时脱离录屏继续画圈/响声
volume = int(sys.argv[1]) if len(sys.argv) > 1 else 50
enable_circle = (len(sys.argv) > 2 and sys.argv[2] == "1")
enable_sound = (len(sys.argv) > 3 and sys.argv[3] == "1")

VK_LBUTTON = 0x01
user32 = ctypes.windll.user32

click_down_wav = r"C:\Program Files (x86)\TechSmith\Camtasia Studio 8\Media\Recorder\Sounds\ClickDown.wav"
click_up_wav = r"C:\Program Files (x86)\TechSmith\Camtasia Studio 8\Media\Recorder\Sounds\ClickUp.wav"

# 设置系统音量 (0x0000~0xFFFF per channel)
vol = max(0, min(0xFFFF, int(volume / 100 * 0xFFFF)))
try:
    ctypes.windll.winmm.waveOutSetVolume(0, vol | (vol << 16))
except Exception:
    pass

root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)

prev_down = False


def get_cursor_pos():
    pt = ctypes.wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


def play_sound(wav_path):
    if enable_sound and os.path.exists(wav_path):
        try:
            winsound.PlaySound(wav_path, winsound.SND_FILENAME | winsound.SND_ASYNC)
        except Exception:
            pass


def show_ripple(is_down):
    if not enable_circle:
        return
    cx, cy = get_cursor_pos()
    # 固定窗口大小，圆圈在窗口内缩小而非扩大
    base_r = 20 if is_down else 14
    max_r = 30  # 最大半径不超过窗口
    color = "#ff5544" if is_down else "#44aaff"
    size = (max_r + 4) * 2  # 窗口固定大小

    win = tk.Toplevel(root)
    win.overrideredirect(True)
    win.attributes("-topmost", True)
    win.attributes("-transparentcolor", "#abcdef")
    win.geometry(f"{size}x{size}+{cx - size // 2}+{cy - size // 2}")
    win.configure(bg="#abcdef")

    canvas = tk.Canvas(win, width=size, height=size, bg="#abcdef", highlightthickness=0)
    canvas.pack()

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
        # 圆圈逐渐缩小+变淡，不超出窗口
        r = base_r + step[0] * 2
        if r > max_r:
            r = max_r
        # alpha效果：越往后线条越细
        w = max(1, 3 - step[0])
        canvas.coords(oval_id,
                      cx_win - r, cy_win - r,
                      cx_win + r, cy_win + r)
        canvas.itemconfig(oval_id, width=w)
        root.after(50, animate)

    root.after(50, animate)


def poll_mouse():
    global prev_down
    curr = user32.GetAsyncKeyState(VK_LBUTTON) & 0x8000
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
