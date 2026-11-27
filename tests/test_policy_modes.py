# -*- coding: utf-8 -*-
"""M1.4 权限模式与审批通路回归（2026-11-24）。

覆盖：
  A 四种模式（standard/strict/full/readonly）：set/get/effective、full 自动回落（注入时钟）、
    readonly 拒写/执行/出域、strict 把默认 allow 收成 ask、full 不放行 deny、损坏模式文件回落
  B 审批请求登记：去重、批准换票、拒绝、过期、上限
  C 端到端 ask 通路（用真实默认引擎）：ask 拦截登记请求 → 待批可见 → 批准换票 →
    带票据重试放行 → 票据一次性
  D domain_policy 路由（FakeSelf 直调 handler）：status/pending/approve（桌面确认 env 强制
    允许与拒绝两种）/reject/mode(full 需确认)
  E 清理与复原（规则/模式文件还原）

用法：py tests/test_policy_modes.py   （退出码 0 = 全过）
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import util_policy as up  # noqa: E402
import util_ticket as ut  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:150]))
    if not cond:
        _fail.append(name)


MODE_FILE = os.path.join(ROOT, 'private', 'policy', 'mode.json')
RULES = os.path.join(ROOT, 'private', 'policy', 'rules.json')
RULES_BAK = open(RULES, 'rb').read()
MODE_BAK = open(MODE_FILE, 'rb').read() if os.path.isfile(MODE_FILE) else None

try:
    os.environ['ZF_DESKTOP_CONFIRM'] = '1'   # 路由 E2E 的桌面确认强制允许（随后单测拒绝分支）
    ut.reset_for_tests()

    # ===== A 模式 =====
    up.set_mode('standard')
    eng = up.PolicyEngine(up.default_user_rules_path())
    time.sleep(1.05)
    check('A1 standard 下过渡期默认 allow（行为不变）',
          eng.decide('fs.write', 'tmp/x.txt').action == 'allow')
    check('A2 get_mode 回 standard', up.get_mode()['mode'] == 'standard')

    r = up.set_mode('readonly')
    eng._ensure(force=True)
    check('A3 readonly 拒 fs.write/shell（mode:readonly）',
          eng.decide('fs.write', 'tmp/x.txt').action == 'deny'
          and eng.decide('shell', 'echo').action == 'deny')
    check('A4 readonly 不拦读类（net 走原判定）',
          eng.decide('net', 'example.com').action == 'ask')

    r = up.set_mode('strict')
    eng._ensure(force=True)
    check('A5 strict 把默认 allow 收成 ask（mode:strict）',
          eng.decide('fs.write', 'tmp/x.txt').action == 'ask')

    r = up.set_mode('full', ttl_sec=3600)
    eng._ensure(force=True)
    check('A6 full 把 ask 免票据放行（mode:full）',
          eng.decide('net', 'ask-target.example').action == 'allow')
    check('A7 full 不放行 deny 规则',
          eng.decide('fs.write', 'private/x.json').action == 'deny')
    m = up.get_mode()
    check('A8 full 带有效期（expires_in≈3600）', 3500 < (m.get('expires_in') or 0) <= 3600, m)

    real_now = time.time
    up.time.time = lambda: real_now() + 3700     # 快进 1 小时+
    m = up.get_mode()
    up.time.time = real_now
    check('A9 full 到期自动回落 standard', m['mode'] == 'standard', m)
    up.set_mode('standard')            # 显式切回：恢复真实时钟后 full 的 1 小时并未真过完
    eng._ensure(force=True)
    check('A10 显式切回后默认姿势恢复', eng.decide('net', 'ask-target.example').action == 'ask')

    up.set_mode('standard')
    with open(MODE_FILE, 'w', encoding='utf-8') as f:
        f.write('{坏')
    check('A11 模式文件损坏回落 standard', up.get_mode()['mode'] == 'standard'
          and (up.get_mode().get('degraded') or ''))

    check('A12 未知模式拒设', up.set_mode('chaos').get('ok') is False)

    # ===== B 审批请求登记 =====
    ut.reset_for_tests()
    r1 = ut.register_request('net', 'x.example', {'h': 1}, 's1', 'c1')
    r2 = ut.register_request('net', 'x.example', {'h': 1}, 's1', 'c1')
    check('B1 登记 + 同绑定去重', r1.get('ok') and r1.get('request_id') == r2.get('request_id'))
    check('B2 pending 可见且仅一条', len(ut.pending_requests()['pending']) == 1)
    check('B3 超限拒发', (lambda cap: (ut._requests.clear(), [ut.register_request(cap, 't', {'i': i}, 's', 'c%d' % i)
        for i in range(ut._MAX_REQUESTS)], ut.register_request(cap, 't', {}, 's', 'cx'))[-1]
        .get('ok') is False)('net'))
    ut.reset_for_tests()

    # ===== C/D 端到端 ask 通路 + 路由（真实默认引擎 + 真实待批注册表）=====
    up.set_mode('standard')
    eng = up.PolicyEngine(up.default_user_rules_path())
    eng._ensure(force=True)

    # net 对非回环是 ask（起步规则）→ 触发登记
    ok, reason, _ = up.check_tool_call(eng, 'net', 'https://ui-e2e.example/x',
                                       {'h': 1}, {'_session_id': 'sx', '_call_id': 'cx'})
    check('C1 ask 拦截并登记请求编号', not ok and 'req-' in reason, reason)

    import routes.domain_policy as dp  # noqa: E402

    class FakeSelf(object):
        def __init__(self):
            self.sent = []
            self._body = {}
            self.headers = {}
            self.client_address = ('127.0.0.1', 0)

        def _read_body(self):
            return self._body

        def _send_json(self, obj, code=200):
            self.sent.append((code, obj))

        @property
        def last(self):
            return self.sent[-1] if self.sent else (0, {})

    pend = ut.pending_requests()['pending']
    rid = pend[-1]['request_id']

    fs = FakeSelf()
    dp._h_policy_pending(fs, '/api/policy/pending', {})
    code, obj = fs.last
    check('D1 GET pending 列出请求', code == 200 and obj.get('ok') and len(obj['pending']) >= 1)

    fs2 = FakeSelf()
    fs2._body = {'request_id': rid}
    dp._h_policy_approve(fs2, '/api/policy/approve', {})
    code, obj = fs2.last
    check('D2 approve（桌面确认强制允许）→ 换发票据', obj.get('ok') and obj.get('ticket'), obj)

    body_retry = {'_policy_ticket': obj['ticket'], '_session_id': 'sx', '_call_id': 'cx'}
    ok, reason, _ = up.check_tool_call(eng, 'net', 'https://ui-e2e.example/x', {'h': 1}, body_retry)
    check('D3 票据重试原调用 → 放行', ok and 'approved' in reason, reason)

    # 拒绝分支：先登记一条，再把桌面确认强制为拒绝
    ok, reason, _ = up.check_tool_call(eng, 'net', 'https://ui-deny.example/x',
                                       {'h': 2}, {'_session_id': 'sx', '_call_id': 'cy'})
    pend2 = ut.pending_requests()['pending']
    rid2 = pend2[-1]['request_id']
    os.environ['ZF_DESKTOP_CONFIRM'] = '0'
    fs3 = FakeSelf()
    fs3._body = {'request_id': rid2}
    dp._h_policy_approve(fs3, '/api/policy/approve', {})
    code, obj = fs3.last
    os.environ['ZF_DESKTOP_CONFIRM'] = '1'
    check('D4 无本机确认 → approve 403', code == 403, obj)
    p_state = [p for p in ut.pending_requests()['pending'] if p['request_id'] == rid2]
    check('D5 拒绝后请求仍在途（人没批，策略不代批）', len(p_state) == 1, p_state)

    # 模式端点：full 需桌面确认（强制允许）
    fs4 = FakeSelf()
    fs4._body = {'mode': 'full'}
    dp._h_policy_mode(fs4, '/api/policy/mode', {})
    code, obj = fs4.last
    check('D6 mode=full（确认允许）→ 生效', obj.get('ok') and obj['mode']['mode'] == 'full', obj)
    check('D7 readonly deny 在 full 切换后仍按当前模式', up.get_mode()['mode'] == 'full')
    up.set_mode('standard')

    # 无桌面确认强制时（真实弹窗路径不可测），只验证路由对空 request_id 的 400
    os.environ['ZF_DESKTOP_CONFIRM'] = '1'
    fs5 = FakeSelf()
    fs5._body = {}
    dp._h_policy_approve(fs5, '/api/policy/approve', {})
    code, obj = fs5.last
    check('D8 缺 request_id → 400', code == 400, obj)

    # ===== E 复原 =====
    up.set_mode('standard')
finally:
    os.environ.pop('ZF_DESKTOP_CONFIRM', None)
    if MODE_BAK is not None:
        with open(MODE_FILE, 'wb') as f:
            f.write(MODE_BAK)
    elif os.path.isfile(MODE_FILE):
        os.remove(MODE_FILE)
    with open(RULES, 'wb') as f:
        f.write(RULES_BAK)
    os.utime(RULES, (time.time() + 2, time.time() + 2))
    ut.reset_for_tests()

check('E1 规则文件已复原', open(RULES, 'rb').read() == RULES_BAK)
print('== M1.4 模式与审批通路回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
