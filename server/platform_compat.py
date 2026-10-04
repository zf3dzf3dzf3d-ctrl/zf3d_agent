# -*- coding: utf-8 -*-
"""
platform_compat — 跨平台兼容层（Windows / macOS / Linux）
统一封装平台相关操作：
  - open_path(): 用系统文件管理器/默认程序打开路径
  - play_sound(): 异步播放 wav
  - machine_guid(): 取设备唯一标识
  - screen_size(): 主屏分辨率
  - IS_MAC / IS_WIN / IS_LINUX 平台常量
不改变 Windows 现有行为，仅为 mac/linux 提供等价实现。
"""
import os
import sys
import subprocess

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")


def open_path(path):
    """用系统默认方式打开文件/文件夹"""
    if IS_WIN:
        os.startfile(path)  # noqa
    elif IS_MAC:
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def play_sound(wav_path, async_=True):
    """异步播放 wav 文件；mac 用 afplay（同步子进程，快速短音可接受）"""
    if not os.path.exists(wav_path):
        return
    try:
        if IS_WIN:
            import winsound
            flags = winsound.SND_FILENAME | (winsound.SND_ASYNC if async_ else 0)
            winsound.PlaySound(wav_path, flags)
        elif IS_MAC:
            subprocess.Popen(["afplay", wav_path])
        else:
            # Linux: 尝试 aplay（阻塞短音），失败静默
            subprocess.Popen(["aplay", wav_path],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def machine_guid():
    """返回设备唯一标识字符串（无则返回 None）"""
    try:
        if IS_WIN:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\Microsoft\Cryptography") as k:
                return winreg.QueryValueEx(k, "MachineGuid")[0]
        if IS_MAC:
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                text=True, timeout=5)
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    return line.split('"')[-2]
        if IS_LINUX:
            for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                if os.path.exists(p):
                    return open(p, encoding="utf-8-sig").read().strip()
    except Exception:
        pass
    return None


def py_exe(base_dir=None):
    """返回本项目的 Python 解释器绝对路径（跨平台）。

    优先用自带的 python/python.exe（Windows 嵌入式版）；不存在（如
    Linux/macOS 部署）时回退 sys.executable 或系统 python3。统一入口，
    避免各处硬编码 python.exe。
    """
    if base_dir is None:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    embedded = os.path.join(base_dir, "python", "python.exe")
    if os.path.exists(embedded):
        return embedded
    if IS_WIN:
        # Windows 上没有嵌入式解释器时退回当前解释器
        return sys.executable
    # Linux/macOS：优先项目自带 venv（start.sh 创建），保证与主进程同一解释器
    venv_py = os.path.join(base_dir, ".venv", "bin", "python")
    if os.path.exists(venv_py):
        return venv_py
    cand = "/usr/local/bin/python3" if IS_MAC else "/usr/bin/python3"
    if os.path.exists(cand):
        return cand
    return sys.executable


def screen_size():
    """主屏分辨率 (w, h)，失败返回 (1920, 1080)"""
    try:
        if IS_WIN:
            import ctypes
            user32 = ctypes.windll.user32
            return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        # macOS / Linux 走 tkinter（无需额外依赖）
        import tkinter as tk
        root = tk.Tk()
        root.withdraw()
        w, h = root.winfo_screenwidth(), root.winfo_screenheight()
        root.destroy()
        return w, h
    except Exception:
        return 1920, 1080
