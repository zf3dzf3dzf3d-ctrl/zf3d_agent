# -*- coding: utf-8 -*-
import sys, io, traceback
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\server')
print('step1')
try:
    import butler_store
    print('step2 imported')
    print('team:', [m.get('name') for m in butler_store.get_team()])
    r = butler_store.record_from_text('test 3 tasks 8 hours', role='健康师')
    print('record:', r)
    print('SMOKE_OK')
except Exception:
    traceback.print_exc()
print('done')
