# -*- coding: utf-8 -*-
import os, time, sys
sys.stdout.reconfigure(encoding='utf-8')
kws = ['CodingPlan', '智谱', 'zf_models_relay', 'glm-5.3-flash']
for d, dirs, files in os.walk('.'):
    dirs[:] = [x for x in dirs if x not in ('node_modules', '.git', 'python', '__pycache__',
               'pip-build-env-1tm4r7i_', 'pip-build-tracker-1_iviqjl', 'pip-build-tracker-60xiu',
               '_trash_public_backup')]
    for f in files:
        p = os.path.join(d, f)
        try:
            if os.path.getsize(p) > 8_000_000: continue
            t = open(p, 'r', encoding='utf-8', errors='ignore').read()
            m = [k for k in kws if k in t]
            if m:
                print(p, os.path.getsize(p), time.strftime('%m-%d %H:%M', time.localtime(os.path.getmtime(p))), m[:2])
        except Exception:
            pass
