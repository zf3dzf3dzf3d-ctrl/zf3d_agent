# -*- coding: utf-8 -*-
"""临时探测：定位 tools 包中 run_code/write 的 timeout 处理逻辑，用完即删"""
import sys, io, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tools
base = os.path.dirname(os.path.abspath(tools.__file__))
print('TOOLS_PKG:', base)
hits = []
for dp, dn, fn in os.walk(base):
    if '__pycache__' in dp:
        continue
    for f in fn:
        if not f.endswith('.py'):
            continue
        fp = os.path.join(dp, f)
        try:
            t = io.open(fp, encoding='utf-8-sig', errors='ignore').read()
        except Exception:
            continue
        if 'run_code' in t or 'subprocess' in t:
            hits.append(fp)
            ls = t.splitlines()
            for i, l in enumerate(ls, 1):
                low = l.lower()
                if 'timeout' in low and ('popen' in low or 'subprocess' in low or '=' in l):
                    print(os.path.relpath(fp, base) + ':' + str(i) + ': ' + l.strip()[:150])
print('--- files containing run_code/subprocess ---')
for h in hits[:25]:
    print(' -', os.path.relpath(h, base))
