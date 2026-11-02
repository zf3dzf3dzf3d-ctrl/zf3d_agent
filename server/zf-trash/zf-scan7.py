# -*- coding: utf-8 -*-
import os, time, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
pats = [
    'private/backups/**/*', 'private/file_protect_snapshots/**/*',
    'zf-trash/**/*models*', '_trash*/**/*models*', 'public/config/*',
    '**/.models_tmp_*',
]
seen = set()
for pat in pats:
    for b in glob.glob(pat, recursive=True):
        if b in seen or not os.path.isfile(b):
            continue
        seen.add(b)
        try:
            t = open(b, 'r', encoding='utf-8', errors='ignore').read(400)
        except Exception:
            continue
        score = '"models"' in t or 'CodingPlan' in t or '本地mimo' in t or '火山方舟' in t
        st = os.stat(b)
        print(('*** ' if score else '    ') + b, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
