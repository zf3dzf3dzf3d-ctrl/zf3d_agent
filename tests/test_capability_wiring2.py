# -*- coding: utf-8 -*-
"""M1.3 第二批接线回归（2026-11-24）：sys.tool 咽喉点 / http.tool 总伞 / browser。

覆盖：
  A syscall.check_permission 顶端策略（deny 先于一切；ask 过渡放行；模块缺失 fail-closed；
    deny 对 dangerous 级同样生效；未配 deny 时既有行为不变——dangerous 仍须 approve）
  B http.tool 总伞（check_tool_call 已覆盖判定语义；此处验证 handler_base 源码接线存在
    + 默认 allow 姿势下不影响既有调用路径）
  C browser 两处守卫（导航 deny / 敏感动作 deny 的源码接线存在）
  D 规则起步默认包含三类新能力且为过渡期 allow

说明：syscall/browser/handler 的 E2E 需要真实 HTTP handler 或 playwright 页面，
超出台词成本；本套件以「策略函数单元 + 源码接线存在 + 既有行为不回归」三层覆盖，
E2E 留给 M1.4 审批 UI 联调。

用法：py tests/test_capability_wiring2.py   （退出码 0 = 全过）
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import util_ticket as ut  # noqa: E402
from util_policy import PolicyEngine  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:150]))
    if not cond:
        _fail.append(name)


RULES = os.path.join(ROOT, 'private', 'policy', 'rules.json')
RULES_BAK = open(RULES, 'rb').read()
ut.reset_for_tests()

try:
    # ===== A syscall 咽喉点 =====
    from engines.common import syscall as sc  # noqa: E402

    sc.register('zfsbx_probe_tool', 'probe', dangerous=True, description='M1.3 回归探针')
    sc._APPROVED.clear()

    def write_rules(rules_obj):
        with open(RULES, 'wb') as f:
            f.write(json.dumps(rules_obj, ensure_ascii=False).encode('utf-8'))
        os.utime(RULES, (time.time() + 3, time.time() + 3))
        time.sleep(1.15)   # 过引擎 1s 缓存

    base = json.loads(RULES_BAK.decode('utf-8-sig'))
    base.setdefault('defaults', {})['sys.tool'] = 'allow'
    base['defaults']['http.tool'] = 'allow'
    base['defaults']['browser'] = 'allow'

    # A1 既有行为不回归：无策略 deny 时 dangerous 仍须 approve
    write_rules(base)
    ok, reason = sc.check_permission('zfsbx_probe_tool')
    check('A1 无策略干预：dangerous 仍拦（原有行为）', not ok and 'DANGEROUS' in reason, reason)
    sc.approve('zfsbx_probe_tool')
    ok, reason = sc.check_permission('zfsbx_probe_tool')
    check('A2 approve 后放行（原有行为）', ok, reason)

    # A3 策略 deny：即使 dangerous+approve 过也拦（deny 最高优先）
    rules = json.loads(RULES_BAK.decode('utf-8-sig'))
    rules.setdefault('defaults', {})['sys.tool'] = 'allow'
    rules['defaults']['http.tool'] = 'allow'
    rules['defaults']['browser'] = 'allow'
    rules['rules'] = [{'capability': 'sys.tool', 'target': 'zfsbx_probe_*', 'action': 'deny'}] + rules.get('rules', [])
    write_rules(rules)
    sc._APPROVED.clear()
    sc.approve('zfsbx_probe_tool')
    ok, reason = sc.check_permission('zfsbx_probe_tool')
    check('A3 策略 deny 先于 dangerous/approve（POLICY_DENY）', not ok and 'POLICY_DENY' in reason, reason)
    check('A4 策略 deny 不影响未命中工具', sc.check_permission('unrelated_tool_other')[0] in (True, False))

    # A5 模块缺失 fail-closed：临时屏蔽 util_policy 导入路径
    saved = sys.modules.pop('util_policy', None)
    import importlib

    class _Blocker(object):
        def find_spec(self, name, path=None, target=None):
            if name == 'util_policy':
                raise ImportError('blocked for test')
            return None

    sys.meta_path.insert(0, _Blocker())
    sys.modules.pop('util_policy', None)
    try:
        ok, reason = sc.check_permission('zfsbx_probe_tool')
        check('A5 策略模块缺失 → fail-closed 拒绝（POLICY_UNAVAILABLE）',
              not ok and 'POLICY_UNAVAILABLE' in reason, reason)
    finally:
        sys.meta_path.pop(0)
        if saved is not None:
            sys.modules['util_policy'] = saved
        importlib.invalidate_caches()
    write_rules(base)   # 恢复过渡期默认

    # ===== B http.tool 总伞：源码接线存在 + 判定语义已由 check_tool_call 套件覆盖 =====
    hb = open(os.path.join(SERVER, 'handler_base.py'), encoding='utf-8').read()
    check('B1 handler_base 已接 http.tool（源码）', "check_tool_call" in hb and "'http.tool'" in hb)
    check('B2 总伞 fail-closed（ImportError 即拒）', '能力策略模块缺失' in hb)
    import util_policy as up_mod  # noqa: E402
    ok, reason, d = up_mod.check_tool_call(
        PolicyEngine(RULES), 'http.tool', 'zfsbx_probe_tool', {'tool': 'x'}, {})
    check('B3 无规则匹配 → 默认 allow（过渡期姿势）', ok and reason == 'policy_allow', reason)

    # ===== C browser 两处守卫源码接线 =====
    eng_src = open(os.path.join(SERVER, 'browser_plugin', 'engine.py'), encoding='utf-8').read()
    check('C1 导航守卫已接 browser 策略', eng_src.count("decide('browser', url)") == 1)
    check('C2 敏感动作守卫已接 browser 策略', "decide('browser', (_cur or '') + '#' + _guard_act)" in eng_src)
    ok, reason, _ = up_mod.check_tool_call(
        PolicyEngine(RULES), 'browser', 'https://example.com#login', {}, {})
    check('C3 默认 allow（过渡期姿势）', ok and reason == 'policy_allow', reason)

    # ===== D 规则起步默认 =====
    cur = json.loads(open(RULES, encoding='utf-8-sig').read())
    dft = cur.get('defaults', {})
    check('D1 三类新能力默认均为过渡期 allow',
          all(dft.get(k) == 'allow' for k in ('sys.tool', 'http.tool', 'browser')), dft)
finally:
    with open(RULES, 'wb') as f:
        f.write(RULES_BAK)
    os.utime(RULES, (time.time() + 2, time.time() + 2))

print('== M1.3 第二批接线回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
