# -*- coding: utf-8 -*-
"""无头智能体哨兵：巡检无头 worker 进程 + 产出目录计数，写状态文件供面板/查看。"""
import os, glob, io

STATE = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\headless_status.txt"
OUT_ROOT = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output"

def count_imgs(pattern):
    return len(glob.glob(os.path.join(OUT_ROOT, pattern)))

lines = []
worker_count = 0
try:
    import subprocess
    r = subprocess.run(
        ['wmic', 'process', 'where', "name like 'python%'",
         'get', 'processid,commandline'],
        capture_output=True, text=True, timeout=25,
        encoding='gbk', errors='replace')
    for ln in (r.stdout or '').splitlines():
        low = ln.lower()
        if ('headless' in low or 'worker' in low or 'gen_' in low) and 'sentinel' not in low:
            worker_count += 1
            lines.append('WORKER: ' + ln.strip()[:160])
except Exception as e:
    lines.append('proc-scan err: %s' % e)

dirs = [
    ('5.7宣传片_像素风80', count_imgs('5.7宣传片_像素风80' + chr(92) + '*.png')),
    ('5.7宣传片_像素风专项', count_imgs('5.7宣传片_像素风专项' + chr(92) + '*.png')),
    ('5.7宣传片_风格竞赛', count_imgs('5.7宣传片_风格竞赛' + chr(92) + '*' + chr(92) + '*.png')),
    ('5.7宣传片_甜妹扩展', count_imgs('5.7宣传片_甜妹扩展' + chr(92) + '*.png')),
    ('5.7宣传片_多风格', count_imgs('5.7宣传片_多风格' + chr(92) + '*.png')),
    ('5.7宣传片_甜妹', count_imgs('5.7宣传片_甜妹' + chr(92) + '*.png')),
]
night_log = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\night10_log.txt"
for tag, lp in [('NIGHT10', night_log),
                ('PIXEL80', r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\pixel40_log.txt")]:
    if os.path.exists(lp):
        with io.open(lp, encoding='utf-8', errors='replace') as f:
            tail = [l for l in f.read().splitlines() if l.strip()][-3:]
        lines += [tag + '_LOG: ' + t for t in tail]
for d, n in dirs:
    lines.append('DIR %s = %d png' % (d, n))

status = 'RUNNING' if worker_count > 0 else 'IDLE'
lines.insert(0, '[%s] headless workers=%d' % (status, worker_count))
with io.open(STATE, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines) + '\n')
print('\n'.join(lines))
