# -*- coding: utf-8 -*-
"""
ComfyUI 守护探针（区域9-T2，影子模式 v1）
策略（依据策划案 v1.3/v1.4）：
  - 影子模式：只写日志报警，绝不重启进程（重启功能留开关，默认 OFF）
  - 阈值：>40GB 预警；>60GB 记录"建议重启"事件（仍不动作）
  - 每 10 分钟由 schedule 拉起一次；单次运行自退出，无常驻线程、无锁
证据背景：2026-10-30 ComfyUI 内存泄漏致 77GB 死机（原始日志已失，证据降级，见 server/zf-trash/区域9-死机证据/）
"""
import ctypes, ctypes.wintypes as wt, json, os, sys, datetime, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE, "zf-trash", "区域9-死机证据")
LOG_FILE = os.path.join(LOG_DIR, "comfy_probe.log")
STATE_FILE = os.path.join(LOG_DIR, "comfy_probe_state.json")

WARN_BYTES = 40 * 1024**3   # 40GB 预警
CRIT_BYTES = 60 * 1024**3   # 60GB 建议重启（影子模式仅记录）
AUTO_RESTART = False        # 影子模式硬开关，授权前保持 False

class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD), ("PageFaultCount", wt.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]

def find_comfy_processes():
    """枚举进程中命令行含 ComfyUI 的 python 进程，返回 [(pid, private_bytes, name)]"""
    import subprocess
    r = subprocess.run(
        ["wmic", "process", "where", "name like 'python%'", "get",
         "ProcessId,CommandLine", "/format:csv"],
        capture_output=True, timeout=60
    )
    out = r.stdout.decode("gbk", errors="replace")
    procs = []
    for line in out.splitlines():
        line = line.strip()
        if "ComfyUI" not in line or "main.py" not in line and "comfy" not in line.lower():
            if "ComfyUI" not in line:
                continue
        try:
            pid = int(line.rstrip().split(",")[-1])
        except ValueError:
            continue
        private = get_private_bytes(pid)
        if private is not None:
            procs.append((pid, private))
    return procs

def get_private_bytes(pid):
    """读进程私有内存(PrivateUsage)，即任务管理器'提交大小'口径——77GB 死机即此指标"""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        pmc = PROCESS_MEMORY_COUNTERS_EX()
        pmc.cb = ctypes.sizeof(pmc)
        psapi = ctypes.windll.psapi
        if not psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb):
            return None
        return pmc.PrivateUsage
    finally:
        k32.CloseHandle(h)

def append_log(msg):
    os.makedirs(LOG_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {msg}\n")

def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    procs = find_comfy_processes()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    if not procs:
        # ComfyUI 未运行属正常态，写心跳便于晨检确认探针存活
        append_log("HEARTBEAT comfy=not_running")
        return
    for pid, priv in procs:
        gb = priv / 1024**3
        level = "OK"
        if priv >= CRIT_BYTES:
            level = "CRIT(建议重启-影子模式不动作)"
        elif priv >= WARN_BYTES:
            level = "WARN"
        append_log(f"pid={pid} private={gb:.2f}GB level={level}")
        if priv >= WARN_BYTES:
            # 更新状态文件供报警台账/晨检读取
            state = {"last_warn_at": now, "pid": pid, "gb": round(gb, 2),
                     "level": level, "auto_restart": AUTO_RESTART}
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        append_log(f"PROBE_ERROR {type(e).__name__}: {e}")
