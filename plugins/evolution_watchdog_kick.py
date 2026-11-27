# -*- coding: utf-8 -*-
"""
evolution_watchdog_kick.py - keeper 槽位专用「踢一脚即退出」包装
（2026-11-26 alpha 自 6.1.0 移植补齐：6.2.0 发布包缺此文件，导致
 evolution_watchdog_keeper 槽位重启后引用悬空无法自愈复活）
位置：plugins/（遵守「一切皆插件」R1 门禁；配套 watchdog 本体在 server/）

职责（每 300s 被槽位调用一次，秒级返回）：
  1. 守护进程活着 → 打印 idle 退出（幂等，不双开）
  2. 守护进程死了 → DETACHED 分离式拉起（父退出不连坐），打印 revived
"""
import os
import subprocess

_DIR = os.path.dirname(os.path.abspath(__file__))
_PY = os.path.normpath(os.path.join(_DIR, '..', 'python', 'python.exe'))
_WATCHDOG = os.path.normpath(os.path.join(_DIR, '..', 'server', 'evolution_watchdog.py'))

CREATE_NO_WINDOW = 0x08000000
DETACHED_PROCESS = 0x00000008

r = subprocess.run([_PY, _WATCHDOG, 'status'], capture_output=True, timeout=30)
out = r.stdout.decode('utf-8', 'replace')
if '"watchdog_pid": 0' in out:
    flags = DETACHED_PROCESS | CREATE_NO_WINDOW
    p = subprocess.Popen([_PY, _WATCHDOG, 'start'], cwd=os.path.dirname(_WATCHDOG),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, creationflags=flags)
    print('revived detached watchdog pid=%s' % p.pid)
else:
    print('idle: watchdog alive -> %s' % out.strip()[:120])
