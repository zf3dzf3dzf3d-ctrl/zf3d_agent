# -*- coding: utf-8 -*-
"""全端口巡检：告警任何非回环绑定的 python 监听进程（防 8801 裸 http.server 类旁路复发）。
安全排查收口（2026-11）固化项，由 schedule 定期任务调用。只告警不杀进程。"""
import subprocess
import sys

from util_log import get_logger

log = get_logger('port_patrol')
sys.stdout.reconfigure(encoding="utf-8")

def main():
    out = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        capture_output=True, timeout=30
    ).stdout.decode("gbk", errors="replace")
    suspicious = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[3].upper() == "LISTENING":
            addr = parts[1]
            ip = addr.rsplit(":", 1)[0]
            if ip in ("127.0.0.1", "[::1]"):
                continue
            suspicious.append((addr, parts[4]))
    alerts = []
    for addr, pid in suspicious:
        try:
            p = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "Name,CommandLine", "/format:list"],
                capture_output=True, timeout=15
            ).stdout.decode("gbk", errors="replace")
        except Exception:
            p = ""
        low = p.lower()
        if "python" in low:
            alerts.append(f"[告警] python 进程对外监听 {addr} pid={pid}")

    if alerts:
        msg = "\n".join(alerts)
        log.info(msg)
        with open("server/logs/port_patrol_alert.log", "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    else:
        log.info("巡检通过：无 python 类进程对外(非回环)监听。")

if __name__ == "__main__":
    main()
