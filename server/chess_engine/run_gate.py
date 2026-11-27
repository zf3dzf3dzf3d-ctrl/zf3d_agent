# -*- coding: utf-8 -*-
"""run_gate.py — 以 subprocess 方式跑 100 局闸门并回显（绕开 shell 中文路径问题）"""
import subprocess, os
from util_log import get_logger

log = get_logger('run_gate')
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
py = os.path.join(root, 'python', 'python.exe')
script = os.path.join(root, 'server', 'chess_engine', 'selfplay_gate.py')
r = subprocess.run([py, '-X', 'utf8', script, '100'],
                   capture_output=True, text=True, encoding='utf-8', errors='replace',
                   cwd=root, timeout=1500)
log.info('%s %s', 'RC', r.returncode)
log.info(r.stdout)
if r.stderr:
    log.info('%s %s', 'ERR:', r.stderr[-2000:])
