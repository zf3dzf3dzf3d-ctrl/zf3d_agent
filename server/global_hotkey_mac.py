# -*- coding: utf-8 -*-
"""
全局呼出器 — macOS 版
基于 Quartz EventTap（依赖 pyobjc，`pip3 install pyobjc-framework-Quartz`），
或 AppKit RegisterEventHotKey 快捷方案。热键：Cmd+`（Command+反引号），
与 Windows 版 Ctrl+~ 语义一致。
接口与 global_hotkey.py 保持一致：
  start(callback) -> daemon 线程
  stop()
无 pyobjc 或非 mac 环境时安全降级为 no-op（不报错）。
"""
import sys
import threading

IS_MAC = sys.platform == "darwin"

listener = None          # Quartz tap 线程句柄
_running = False
_lock = threading.Lock()


def _run_eventtap(callback):
    """EventTap 主循环：监听 Cmd+` keyDown"""
    try:
        import Quartz
        from Foundation import NSRunLoop, NSDate
    except ImportError:
        print("[global_hotkey_mac] 未安装 pyobjc，全局热键不可用。"
              "请运行: pip3 install pyobjc-framework-Quartz")
        return

    KEY_BACKTICK = 0x32  # kVK_ANSI_Grave

    def _tap_proxy(proxy, etype, event, refcon):
        try:
            if etype == Quartz.kCGEventKeyDown:
                flags = Quartz.CGEventGetFlags(event)
                cmd = flags & Quartz.kCGEventFlagMaskCommand
                keycode = Quartz.CGEventGetIntegerValueField(
                    event, Quartz.kCGKeyboardEventKeycode)
                if cmd and keycode == KEY_BACKTICK:
                    # 吞掉事件并触发回调
                    threading.Thread(target=callback, daemon=True).start()
                    return None
        except Exception:
            pass
        return event

    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap,
        Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionDefault,   # 可修改/吞事件，需辅助功能权限
        Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown),
        _tap_proxy,
        None,
    )
    if tap is None:
        print("[global_hotkey_mac] EventTap 创建失败：请在 "
              "系统设置 → 隐私与安全性 → 辅助功能 中授权终端/本应用。")
        return

    source = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    rl = Quartz.CFRunLoopGetCurrent()
    Quartz.CFRunLoopAddSource(rl, source, Quartz.kCFRunLoopCommonModes)
    Quartz.CGEventTapEnable(tap, True)

    # 阻塞运行
    while True:
        NSRunLoop.currentRunLoop().runMode_beforeDate_(
            "kCFRunLoopDefaultMode", NSDate.distantFuture())


def start(callback):
    """启动全局热键监听（daemon 线程）。非 mac 或重复调用安全返回。"""
    global listener, _running
    if not IS_MAC:
        return False
    with _lock:
        if _running:
            return True
        listener = threading.Thread(
            target=_run_eventtap, args=(callback,), daemon=True)
        listener.start()
        _running = True
        return True


def stop():
    """停止监听（EventTap 随 daemon 线程结束）"""
    global _running
    with _lock:
        _running = False


if __name__ == "__main__":
    def _on_hotkey():
        print("热键触发！Cmd+`")
    print("按 Cmd+` 测试，Ctrl+C 退出")
    start(_on_hotkey)
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        stop()
