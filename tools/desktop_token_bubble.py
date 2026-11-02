# -*- coding: utf-8 -*-
"""桌面悬浮气泡：点击直达朱峰社区领取token页面"""
import tkinter as tk
import webbrowser
import os, sys

# tkinter 自适配：Tcl/Tk 库路径探测（嵌入式 Python 或路径异常时）
def _fix_tcl_paths():
    cands = []
    exedir = os.path.dirname(sys.executable)
    cands.append(os.path.join(exedir, "tcl"))
    cands.append(os.path.join(os.path.dirname(exedir), "tcl"))
    cands.append(os.path.join(sys.prefix, "tcl"))
    for base in cands:
        tcl = os.path.join(base, "tcl8.6")
        tkk = os.path.join(base, "tk8.6")
        if os.path.exists(os.path.join(tcl, "init.tcl")):
            os.environ.setdefault("TCL_LIBRARY", tcl)
            os.environ.setdefault("TK_LIBRARY", tkk)
            return

_fix_tcl_paths()
import tkinter as tk2  # noqa: E402  (重新确认导入可用)


URL = "https://www.zf3d.com/aitoken.asp"  # 不带uid：登录态在浏览器cookie里，网站自动识别当前用户
APP_DIR = os.path.dirname(os.path.abspath(__file__))
VBS_PATH = os.path.join(APP_DIR, "token_bubble_autostart.vbs")
SELF = os.path.abspath(__file__)

def find_pythonw():
    base = os.path.join(os.path.dirname(APP_DIR), "python", "pythonw.exe")
    if os.path.exists(base):
        return base
    return sys.executable.replace("python.exe", "pythonw.exe").replace("pythonw.exe", "python.exe")

FLAG_PATH = os.path.join(os.environ.get("APPDATA", APP_DIR), "token_bubble_clicked.flag")

def already_clicked():
    return os.path.exists(FLAG_PATH)

def mark_clicked():
    try:
        with open(FLAG_PATH, "w") as f:
            f.write("clicked")
    except OSError:
        pass

def clear_flag():
    try:
        os.remove(FLAG_PATH)
    except OSError:
        pass

class Bubble:
    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        try:
            self.root.attributes("-alpha", 0.92)
        except tk.TclError:
            pass
        self.root.configure(bg="#FF6B35")

        self.dragging = False
        self.start_x = self.start_y = 0
        self.moved = False

        self.label = tk.Label(
            self.root, text="🎁\n领¥10", font=("Microsoft YaHei UI", 11, "bold"),
            bg="#FF6B35", fg="white", padx=14, pady=8, cursor="hand2", justify="center"
        )
        self.label.pack()

        self.label.bind("<ButtonPress-1>", self.on_press)
        self.label.bind("<B1-Motion>", self.on_motion)
        self.label.bind("<ButtonRelease-1>", self.on_release)
        self.label.bind("<Enter>", self.on_enter)
        self.label.bind("<Leave>", self.on_leave)
        self.label.bind("<Button-3>", self.on_right)

        self.tip = None
        self.to_root()

    def to_root(self):
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        w = self.root.winfo_reqwidth()
        h = self.root.winfo_reqheight()
        self.root.geometry(f"+{sw - w - 30}+{sh - h - 80}")

    def on_press(self, e):
        self.dragging = True
        self.moved = False
        self.start_x = e.x_root
        self.start_y = e.y_root

    def on_motion(self, e):
        if not self.dragging:
            return
        dx = e.x_root - self.start_x
        dy = e.y_root - self.start_y
        if abs(dx) > 3 or abs(dy) > 3:
            self.moved = True
        self.root.geometry(f"+{e.x_root - self.label.winfo_width() // 2}+{e.y_root - 15}")

    def on_release(self, e):
        self.dragging = False
        if not self.moved:
            mark_clicked()  # 点过一次就记下来，下次不再显示
            webbrowser.open_new_tab(URL)
            self.show_tip("已在浏览器打开领取页，若未登录请先登录~\n气泡将不再自动显示，可右键「重新显示气泡」恢复")
            self.root.after(3000, self.root.destroy)

    def on_enter(self, e):
        self.label.configure(bg="#FF8C42")
        if self.tip is None:
            self.show_tip("验证邮箱领10元 · 每日签到领1元\n单击直达 | 右键菜单 | 可拖动")

    def on_leave(self, e):
        self.label.configure(bg="#FF6B35")

    def show_tip(self, text):
        if self.tip:
            return
        x = self.root.winfo_x()
        y = self.root.winfo_y() + self.root.winfo_height() + 4
        self.tip = tk.Toplevel(self.root)
        self.tip.overrideredirect(True)
        self.tip.attributes("-topmost", True)
        tk.Label(self.tip, text=text, bg="#333333", fg="white",
                 font=("Microsoft YaHei UI", 9), padx=8, pady=4, justify="left").pack()
        self.tip.geometry(f"+{x}+{y}")
        self.root.after(3500, self.hide_tip)

    def hide_tip(self):
        if self.tip:
            self.tip.destroy()
            self.tip = None

    def on_right(self, e):
        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(label="🎁 打开领取页", command=lambda: webbrowser.open_new_tab(URL))
        menu.add_separator()
        menu.add_command(label="开机自启 开", command=lambda: self.set_autostart(True))
        menu.add_command(label="开机自启 关", command=lambda: self.set_autostart(False))
        menu.add_separator()
        menu.add_command(label="重新显示气泡", command=self.reset_flag)
        menu.add_command(label="退出气泡", command=self.root.destroy)
        menu.tk_popup(e.x_root, e.y_root)

    def set_autostart(self, on):
        startup = os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup")
        target = os.path.join(startup, "token_bubble_autostart.vbs")
        if on:
            pw = find_pythonw()
            with open(target, "w", encoding="gbk") as f:
                f.write(f'CreateObject("WScript.Shell").Run """{pw}"" ""{SELF}""", 0, False\n')
            self.show_tip("已开启开机自启")
        else:
            if os.path.exists(target):
                os.remove(target)
            self.show_tip("已关闭开机自启")

    def reset_flag(self):
        clear_flag()
        self.show_tip("已重置，下次启动会继续显示气泡")

    def run(self):
        if already_clicked():
            return  # 点过一次，不再弹出
        self.root.mainloop()

if __name__ == "__main__":
    Bubble().run()
