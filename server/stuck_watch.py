# -*- coding: utf-8 -*-
"""stuck_watch：卡死自动取证看门狗（P2.2，防复发机制）。

背景：2026-10-26 对话池自死锁，日志完全静默，十几个会话盲修一天；
zcode 用 py-spy dump 一次定位。本看门狗把「抓栈」从人肉纪律变成机械兜底：
后台线程周期性检查运行中请求，发现 >STUCK_SECONDS 零进度的卡死请求时，
自动对服务进程执行 py-spy dump，落盘到 server/data/stuck_stacks/。

设计约束：
- 限频：同一卡死对象 1 分钟内不重复 dump；全局限频同样 1 分钟 1 次。
- 只存栈帧：dump 结果为 py-spy 文本栈，不含消息体/密钥。
- 依赖 py-spy：未安装时看门狗静默停用，不影响业务。
- 由 server 主进程 import 时自动启动（daemon 线程，异常不外抛）。
"""
import os
import time
import threading
import subprocess

# Windows 下禁止子进程弹出控制台窗口（静默取证，py-spy 调用不闪黑框）
_SUBPROC_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

STUCK_SECONDS = 90          # 超过此秒数无进度视为卡死
DUMP_COOLDOWN = 60          # 同一对象/全局限频（秒）
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "stuck_stacks")

# 注册卡死观察对象的回调由对话池等模块调用：
#   stuck_watch.watch(key)         请求开始/有进度时刷新
#   stuck_watch.unwatch(key)      请求结束后注销
_watch = {}
_lock = threading.Lock()
_last_global_dump = 0.0
_started = False


def watch(key, meta=""):
    """登记/刷新一个请求的活跃时间。key 任意可哈希，meta 为描述文字。"""
    with _lock:
        _watch[key] = [time.time(), meta]


def unwatch(key):
    with _lock:
        _watch.pop(key, None)


_PYSPY_CANDIDATES = [
    r"C:\Users\Administrator\AppData\Local\Programs\Python\Python311\Scripts\py-spy.exe",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "python", "Scripts", "py-spy.exe"),
]


def _pyspy_exe():
    """定位 py-spy：先 PATH，再已知候选路径。找不到返回 None。"""
    try:
        import shutil
        p = shutil.which("py-spy")
        if p:
            return p
    except Exception:
        pass
    for c in _PYSPY_CANDIDATES:
        if os.path.isfile(c):
            return c
    return None


def _dump(reason_key, meta, stuck_s):
    global _last_global_dump
    out = os.path.join(OUT_DIR, "stuck_%s_%s.txt" % (
        time.strftime("%Y%m%d_%H%M%S"),
        str(reason_key).replace("/", "_").replace("\\", "_")[:40] or "proc"))
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
        exe = _pyspy_exe()  # 每次取证时现取，避免启动后 py-spy 变动
        with open(out, "w", encoding="utf-8", errors="replace") as f:
            f.write("# stuck_watch 自动取证 %s | 卡死对象=%s meta=%s 卡了%.0fs\n"
                    % (time.strftime("%Y-%m-%d %H:%M:%S"), reason_key, meta, stuck_s))
            f.flush()
            subprocess.run([exe, "dump", "--pid", str(os.getpid())],
                           stdout=f, stderr=f, timeout=30,
                           creationflags=_SUBPROC_FLAGS)
        # 只保留最近 20 份取证，防磁盘膨胀
        files = sorted(f for f in os.listdir(OUT_DIR) if f.startswith("stuck_"))
        for old in files[:-20]:
            try:
                os.remove(os.path.join(OUT_DIR, old))
            except OSError:
                pass
        print("[stuck_watch] 卡死取证已落盘: %s (%.0fs)" % (out, stuck_s))
    except Exception as e:
        print("[stuck_watch] 取证失败(不影响业务): %s" % e)


def _loop():
    global _last_global_dump
    while True:
        time.sleep(15)
        now = time.time()
        with _lock:
            stuck = [(k, v[1], now - v[0]) for k, v in _watch.items()
                     if now - v[0] > STUCK_SECONDS]
        if not stuck or now - _last_global_dump < DUMP_COOLDOWN:
            continue
        _last_global_dump = now
        key, meta, s = stuck[0]
        threading.Thread(target=_dump, args=(key, meta, s), daemon=True).start()


def start():
    """启动看门狗（幂等，py-spy 不可用时静默停用）。"""
    global _started
    if _started:
        return
    exe = _pyspy_exe()
    if not exe:
        print("[stuck_watch] 未检测到 py-spy，卡死自动取证停用（pip install py-spy 后重启生效）")
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="stuck-watch").start()
    print("[stuck_watch] 卡死自动取证已启动（>%ds 无进度自动 py-spy dump，限频 %ds，工具=%s）"
          % (STUCK_SECONDS, DUMP_COOLDOWN, exe))
