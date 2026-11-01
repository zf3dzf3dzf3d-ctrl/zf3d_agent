# -*- coding: utf-8 -*-
import subprocess, sys
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0'
PY = ROOT + r'\python\python.exe'

def run(args):
    p = subprocess.run([PY] + args, capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=150, cwd=ROOT)
    return p.returncode, (p.stdout or '') + (p.stderr or '')

rc, out = run([r'tests\regression\gate.py', '--drill'])
print('=== DRILL(含--drill) RC=%d' % rc)
print(out[-500:])

rc2, out2 = run([r'tests\regression\patrol.py'])
print('=== PATROL RC=%d' % rc2)
print(out2[-1500:])
