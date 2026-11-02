# -*- coding: utf-8 -*-
# 负向测试：PATHS 注入假路径后 check_paths 必须产生 FAIL（用后即删）
import importlib.util
spec = importlib.util.spec_from_file_location(
    'doctor', r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\scripts\doctor.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.PATHS['测试假路径'] = r'F:\不存在的路径\假.md'
m.check_paths()
fails = [i for i in m.issues if i[0] == 'FAIL']
print('NEG_TEST_FAIL_COUNT=', len(fails))
print(fails[-1][1], '->', fails[-1][2][:80])
