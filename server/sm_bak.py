# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\server')
import butler_store as b
out = []
out.append('team=%d' % len(b.get_team()))
r = b.record_from_text('test 3 tasks 8 hours', role='健康师')
out.append('rec=' + repr(r))
out.append('sum=' + repr(b.summary(role='健康师')))
open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\smoke_result.txt', 'w', encoding='utf-8').write('\n'.join(out))
