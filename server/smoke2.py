# -*- coding: utf-8 -*-
import sys, traceback
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\server')
out = []
try:
    import butler_store as b
    out.append('team=%d' % len(b.get_team()))
    r = b.record_from_text('test 3 tasks 8 hours', role='健康师')
    out.append('rec=' + repr(r))
    out.append('sum=' + repr(b.summary(role='健康师')))
    out.append('SMOKE_OK')
except Exception:
    out.append('ERR:\n' + traceback.format_exc())
open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\smoke_result.txt', 'w', encoding='utf-8').write('\n'.join(out))
