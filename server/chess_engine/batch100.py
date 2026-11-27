# -*- coding: utf-8 -*-
"""batch100.py — 串跑三批(offset 25/50/75)各25局，与已PASS的种子0-24批凑满100局唯一种子"""
import subprocess
from util_log import get_logger

log = get_logger('batch100')
py = r'python\python.exe'
script = r'server\chess_engine\selfplay_gate.py'
allpass = True
for o in (25, 50, 75):
    r = subprocess.run([py, '-X', 'utf8', script, '25', str(o)],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    log.info('=== batch offset %d RC %d ===' % (o, r.returncode))
    log.info(r.stdout)
    if r.stderr:
        log.info('%s %s', 'ERR:', r.stderr[-500:])
    if 'PASS' not in r.stdout:
        allpass = False
log.info('%s %s', 'TOTAL100:', 'ALL PASS' if allpass else 'SOME FAIL')
