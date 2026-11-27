#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体 - 启动闪屏（splash screen）
双击启动后立刻弹出居中闪屏：
- 无边框圆角窗口，居中显示 logo + 标题 + 动态进度条
- 自动检测系统深浅色主题：黑风格(深色系统) / 白风格(浅色系统)
- 进度条动画（不真实反映加载百分比，而是「流转+渐近」动画，到达 90% 后等待就绪信号）
- 由 webview_client 在服务端口就绪后调用 finish() → 渐隐淡出销毁
用法：
    splash = start_splash()   # 非阻塞，立刻返回
    ...
    splash.finish()           # 服务就绪后关闭
依赖：仅 tkinter（Python 自带），无第三方依赖，启动开销极小。
"""
import os
import sys
import threading
import traceback
import tkinter as tk

from util_log import get_logger

log = get_logger('splash_window')
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGO = os.path.join(_PROJECT_ROOT, 'public', 'logo.png')


def _log_splash_error(where, exc):
    """闪屏失败写日志（server/logs/splash_err.txt 追加），绝不静默吞掉——便于换机/
    重装内嵌 Python 后 tcl/tkinter 缺失时可诊断。日志失败也不影响主流程。"""
    try:
        log_dir = os.path.join(_PROJECT_ROOT, 'server', 'logs')
        os.makedirs(log_dir, exist_ok=True)
        import datetime
        with open(os.path.join(log_dir, 'splash_err.txt'), 'a', encoding='utf-8') as f:
            f.write('[%s] %s:\n%s\n' % (
                datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                where, traceback.format_exc()))
    except Exception:
        print('[Splash] 不可用 (%s): %r' % (where, exc), file=sys.stderr)


def _system_dark_mode():
    """读注册表判断 Windows 系统 App 是否为深色模式（失败默认深色）。"""
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                           r'Software\Microsoft\Windows\CurrentVersion'
                           r'\Themes\Personalize')
        v, _ = winreg.QueryValueEx(k, 'AppsUseLightTheme')
        winreg.CloseKey(k)
        return not bool(v)
    except Exception:
        return True


def _theme_mode_from_settings():
    """读应用内 UI 主题设置（private/用户设置/user_settings.json 的 zf_theme 键），
    在 theme.js 的 20 种风格表中查该风格的 mode（dark/light）。
    返回 True=深色风格 / False=浅色风格；读不到或解析失败返回 None（回退系统深浅色）。"""
    import json
    import re
    try:
        cfg = os.path.join(_PROJECT_ROOT, 'private', '用户设置', 'user_settings.json')
        with open(cfg, 'r', encoding='utf-8') as f:
            data = json.load(f)
        raw = data.get('zf_theme')
        if isinstance(raw, str):
            raw = json.loads(raw)
        style_id = (raw or {}).get('styleId')
        if not style_id:
            return None
        # 从 theme.js 解析该风格的 mode（格式：{ id: 'xxx', name: '...', mode: 'dark'|'light', ...）
        theme_js = os.path.join(_PROJECT_ROOT, 'public', 'js', 'theme.js')
        with open(theme_js, 'r', encoding='utf-8') as f:
            js = f.read()
        m = re.search(
            r"\{\s*id:\s*['\"]" + re.escape(style_id) + r"['\"][^{}]*?mode:\s*['\"](\w+)['\"]",
            js, re.S)
        if m and m.group(1) in ('dark', 'light'):
            return m.group(1) == 'dark'
    except Exception:
        pass
    return None


def _resolve_dark():
    """优先应用内 UI 主题设置；无则回退系统深浅色（旧逻辑）。"""
    mode = _theme_mode_from_settings()
    if mode is not None:
        return mode
    return _system_dark_mode()


class _Splash:
    def __init__(self):
        self.dark = _resolve_dark()
        self.closed = threading.Event()
        self._want_close = False
        self._t = threading.Thread(target=self._run)  # 非 daemon：防 Tcl 线程清理崩溃
        self._t.start()

    # ---------- 主题配色 ----------
    def _colors(self):
        if self.dark:
            # 黑风格：深底 + 微亮描边 + 蓝紫渐变主色
            return dict(bg='#16181f', fg='#e8eaf2', sub='#9aa0b5',
                        bar_track='#262a38', bar='#4f7cff',
                        bar2='#9b5cff', border='#2c3145', glow='#4f7cff')
        # 白风格：纸白底 + 淡灰描边 + 蓝紫渐变主色
        return dict(bg='#f7f8fc', fg='#22242c', sub='#6b7080',
                    bar_track='#e4e6ee', bar='#4f7cff',
                    bar2='#9b5cff', border='#d9dce6', glow='#4f7cff')

    # ---------- 窗口 ----------
    def _run(self):
        try:
            self.root = tk.Tk()
        except Exception as e:
            _log_splash_error('tk.Tk 初始化（疑似 tcl/tkinter 缺失）', e)
            self.closed.set()
            return
        # 【窗口图标 2026-11-22】Tk 默认图标是 Python 蛇标，会被任务管理器捕获并
        # 缓存到「朱峰智能体无限」应用分组（表现为分组图标一直是 Python），必须显式换掉。
        try:
            self.root.iconbitmap(os.path.join(_PROJECT_ROOT, 'public', 'logo.ico'))
        except Exception:
            pass
        c = self._colors()
        W, H = 400, 220
        r = self.root
        r.overrideredirect(True)          # 无边框
        r.attributes('-topmost', True)    # 置顶
        # 居中
        try:
            sw = r.winfo_screenwidth()
            sh = r.winfo_screenheight()
            x, y = (sw - W) // 2, (sh - H) // 2 - 40
        except Exception:
            x, y = 300, 200
        r.geometry(f'{W}x{H}+{x}+{y}')
        r.configure(bg=c['bg'])

        # logo：优先 tk 原生 PhotoImage（tk>=8.6 直接支持 PNG，不依赖 PIL）；
        # PIL 备选；都失败才退化为文字「朱」。
        self._logo_img = None
        try:
            img = tk.PhotoImage(file=_LOGO)
            try:
                img = img.subsample(3, 3)  # 256→~85px
            except Exception:
                pass
            self._logo_img = img
            tk.Label(r, image=self._logo_img, bg=c['bg']).pack(pady=(28, 6))
        except Exception:
            try:
                from PIL import Image, ImageTk  # 项目自带 PIL
                img = Image.open(_LOGO)
                img.thumbnail((88, 88))
                self._logo_img = ImageTk.PhotoImage(img)
                tk.Label(r, image=self._logo_img, bg=c['bg']).pack(pady=(28, 6))
            except Exception:
                tk.Label(r, text='朱峰', font=('Microsoft YaHei UI', 30, 'bold'),
                         fg=c['bar'], bg=c['bg']).pack(pady=(24, 4))

        tk.Label(r, text='朱峰智能体无限', font=('Microsoft YaHei UI', 15, 'bold'),
                 fg=c['fg'], bg=c['bg']).pack()
        self.status = tk.Label(r, text='正在启动…', font=('Microsoft YaHei UI', 9),
                               fg=c['sub'], bg=c['bg'])
        self.status.pack(pady=(2, 12))

        # 进度条：Canvas 自绘渐变流转
        BW, BH = 300, 6
        self.bar = tk.Canvas(r, width=BW, height=BH, bg=c['bar_track'],
                             highlightthickness=0)
        self.bar.pack()
        self._bw, self._bh = BW, BH
        self._progress = 0.0      # 0~1 渐近进度（逻辑上限 0.92）
        self._phase = 0.0         # 流转光斑相位
        self._running = True
        self._animate()

        # 外描边（细边框增强黑/白两种风格下的层次）
        try:
            r.configure(highlightbackground=c['border'],
                        highlightthickness=1)
        except Exception:
            pass

        # 关闭标志轮询（动画循环内检查，同线程安全）
        self._want_close = False
        r.after(10000, self._auto_close)  # 兜底关闭从 60s 提到 10s（服务就绪即提前关闭，兜底只防极端）
        r.mainloop()

    # ---------- 动画 ----------
    def _animate(self):
        if not self._running:
            return
        # 跨线程关闭请求：轮询标志，在同一 Tk 线程内安全执行关闭序列
        if self._want_close and not self._closing:
            self._closing = True
            self._do_close()
            return
        c = self._colors()
        # 应用跨线程状态文字
        if self._status_text is not None:
            try:
                self.status.config(text=self._status_text)
                self._status_text = None
            except Exception:
                pass
        # 渐近：越接近 0.92 越慢（缓动），模拟真实加载感受
        target = 0.92
        self._progress += (target - self._progress) * 0.015
        self._phase = (self._phase + 0.045) % 1.0
        bw, bh = self._bw, self._bh
        cv = self.bar
        cv.delete('all')
        # 底轨
        cv.create_rectangle(0, 0, bw, bh, fill=c['bar_track'], width=0)
        # 已填充部分（双色渐变近似：主色块+端头光斑）
        fill_w = int(bw * self._progress)
        if fill_w > 0:
            steps = 24
            for i in range(steps):
                t0 = i / steps
                x0 = int(fill_w * t0)
                x1 = int(fill_w * (t0 + 1 / steps))
                # 蓝→紫插值
                col = self._lerp_color(c['bar'], c['bar2'], t0)
                cv.create_rectangle(x0, 0, x1 + 1, bh, fill=col, width=0)
        # 流转光斑（高亮小段在已填充区来回扫，暗示"活着的"加载）
        head = int(fill_w * self._phase)
        hw = 26
        if fill_w > hw:
            x0 = max(0, head - hw)
            x1 = min(fill_w, head)
            cv.create_rectangle(x0, 0, x1, bh, fill='#ffffff', width=0,
                                stipple='gray50')
        if self._running:
            self.root.after(33, self._animate)  # ~30fps

    _closing = False
    _fade = 0

    def _do_close(self):
        """在 Tk 主线程内执行：立即销毁（不做渐隐循环，防动画链断裂导致窗口永远挂着）。

        【2026-11-17 修复】旧版走 _fade=85 → after(55)×N 渐隐；一旦渐隐链中途
        异常且 destroy 兜底也失败，_closing 已置位、动画循环不再被调度，
        窗口将永远显示"启动完成"挂在那里。改为同步 withdraw+destroy，
        稳定优先于视觉过渡。"""
        try:
            self.status.config(text='启动完成')
        except Exception:
            pass
        self._finish_close()
        return
        # （保留原渐隐实现备查）
        try:  # noqa
            c = self._colors()
            self.bar.delete('all')
            self.bar.create_rectangle(0, 0, self._bw, self._bh,
                                      fill=c['bar'], width=0)
        except Exception:
            pass
        self._fade = 85
        self._fade_step()

    def _finish_close(self):
        """同步收尾：withdraw→destroy→清理引用→置 closed。任何一步失败都继续往后走。"""
        try:
            self.root.withdraw()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass
        self._cleanup_refs()
        self.closed.set()

    def _fade_step(self):
        try:
            self._fade -= 30
            if self._fade <= 0:
                self.root.destroy()
                self._cleanup_refs()
                self.closed.set()
                return
            self.root.attributes('-alpha', self._fade / 100.0)
            self.root.after(55, self._fade_step)
        except Exception:
            try:
                self.root.destroy()
            except Exception:
                pass
            self._cleanup_refs()
            self.closed.set()

    def _cleanup_refs(self):
        """在 Tk 线程内释放所有 Tcl 对象引用，防止主线程 GC 跨线程删 Tcl 崩溃。"""
        self.root = None
        self.bar = None
        self.status = None
        self._logo_img = None

    @staticmethod
    def _lerp_color(a, b, t):
        try:
            ar, ag, ab = int(a[1:3], 16), int(a[3:5], 16), int(a[5:7], 16)
            br, bg, bb = int(b[1:3], 16), int(b[3:5], 16), int(b[5:7], 16)
            return '#%02x%02x%02x' % (int(ar + (br - ar) * t),
                                      int(ag + (bg - ag) * t),
                                      int(ab + (bb - ab) * t))
        except Exception:
            return a

    def set_status(self, text):
        """线程安全：仅写变量，由动画循环在 Tk 线程内应用。"""
        self._status_text = text

    _status_text = None

    def _auto_close(self):
        self.finish()

    # ---------- 关闭 ----------
    def finish(self):
        """服务就绪后调用：置关闭标志，由 Tk 线程动画循环执行渐隐销毁。线程安全。"""
        if self.closed.is_set():
            return
        self._want_close = True


def start_splash():
    """启动闪屏（非阻塞）。失败返回 None 并写日志，绝不影响主启动流程。"""
    try:
        s = _Splash()
        return s
    except Exception as e:
        _log_splash_error('start_splash', e)
        return None


# 独立冒烟测试：python splash_window.py
if __name__ == '__main__':
    s = start_splash()
    import time as _t
    _t.sleep(4)
    if s:
        s.set_status('服务已就绪')
        s.finish()
        s._t.join(timeout=3)  # 等 Tk 线程彻底结束再退出进程
    _t.sleep(0.3)
    log.info('SMOKE_OK')
