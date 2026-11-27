# -*- coding: utf-8 -*-
"""审批票据回归（M1.2，2026-11-24）。

钉死策划案 M1.2 的验收口径：
  - 换参数后票据失效（params_mismatch）；
  - 跨会话失效（session_mismatch）；
  - 重放失效（一次性：already_used）；
  以及：超时失效、撤销、换能力/换调用 ID 失效、参数哈希规范化、并发核销原子性、
  在途上限防灌水、审计不阻断。

用法：py tests/test_approve_ticket.py   （退出码 0 = 全过）
"""
import sys
import threading

ROOT = os_dir = __import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
SERVER = ROOT + '\\server'
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import util_ticket as ut  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


ut.reset_for_tests()

# ===== 1 签发的基本校验 =====
check('1.1 空 capability 拒发', ut.issue('', {}, 's1', 'c1').get('ok') is False)
check('1.2 缺 session 拒发', ut.issue('shell', {}, '', 'c1').get('ok') is False)
check('1.3 缺 call 拒发', ut.issue('shell', {}, 's1', '').get('ok') is False)
r = ut.issue('shell', {'cmd': 'git push'}, 's1', 'c1')
check('1.4 正常签发', r.get('ok') is True and (r.get('ticket') or '').startswith('tk-'), r)
check('1.5 ttl 钳制到上限', ut.issue('shell', {}, 's1', 'c9', ttl=999999).get('expires_in') == ut.TTL_MAX)

# ===== 2 三条验收主线的“失效”面 =====
tk = ut.issue('shell', {'cmd': 'git push'}, 's1', 'c1')['ticket']
ok, reason = ut.consume(tk, 'shell', {'cmd': 'git push'}, 's1', 'c1')
check('2.1 原样核销放行', ok and reason == 'ok')
ok, reason = ut.consume(tk, 'shell', {'cmd': 'git push'}, 's1', 'c1')
check('2.2 重放失效：一次性（already_used）', not ok and reason == 'already_used')

tk2 = ut.issue('shell', {'cmd': 'git push'}, 's1', 'c2')['ticket']
ok, reason = ut.consume(tk2, 'shell', {'cmd': 'git push'}, 's2', 'c2')
check('2.3 跨会话失效（session_mismatch）', not ok and reason == 'session_mismatch')
ok, reason = ut.consume(tk2, 'shell', {'cmd': 'git pull'}, 's1', 'c2')
check('2.4 换参数失效（params_mismatch）——批 A 不能执行 B',
      not ok and reason == 'params_mismatch')
ok, reason = ut.consume(tk2, 'shell', {'cmd': 'git push'}, 's1', 'cX')
check('2.5 换调用 ID 失效（call_mismatch）', not ok and reason == 'call_mismatch')
ok, reason = ut.consume(tk2, 'fs.write', {'cmd': 'git push'}, 's1', 'c2')
check('2.6 换能力失效（capability_mismatch）', not ok and reason == 'capability_mismatch')
ok, reason = ut.consume('tk-forged-000', 'shell', {}, 's1', 'c1')
check('2.7 伪造票据拒绝', not ok and reason == 'no_such_ticket')
ok, reason = ut.consume(tk2, 'shell', {'cmd': 'git push'}, 's1', 'c2')
check('2.8 未动过的票据仍可正常核销', ok and reason == 'ok')

# ===== 3 参数哈希规范化 =====
h1 = ut.params_hash({'a': 1, 'b': 2})
h2 = ut.params_hash({'b': 2, 'a': 1})
check('3.1 同参数不同键序 = 同哈希', h1 == h2)
check('3.2 不同参数不同哈希', h1 != ut.params_hash({'a': 1, 'b': 3}))
check('3.3 字符串参数按原文', ut.params_hash('git push') == ut.params_hash('git push')
      and ut.params_hash('git push') != ut.params_hash('git pull'))

# ===== 4 超时失效（注入时钟）=====
tk3 = ut.issue('net', {'host': 'x'}, 's1', 'c3', ttl=10)['ticket']
real_now = ut._now
ut._now = lambda: real_now() + 601                      # 时间快进过有效期
ok, reason = ut.consume(tk3, 'net', {'host': 'x'}, 's1', 'c3')
check('4 超时失效（expired）', not ok and reason == 'expired')
ut._now = real_now

# ===== 5 撤销 =====
tk4 = ut.issue('shell', {}, 's1', 'c4')['ticket']
check('5.1 撤销成功', ut.revoke(tk4).get('ok') is True)
ok, reason = ut.consume(tk4, 'shell', {}, 's1', 'c4')
check('5.2 撤销后核销拒绝（revoked）', not ok and reason == 'revoked')

# ===== 6 会话级作废 + 在途列表 =====
t_a = ut.issue('net', {}, 'sA', 'ca')['ticket']
t_b = ut.issue('net', {}, 'sB', 'cb')['ticket']
pend = ut.pending_for_session('sA')['pending']
check('6.1 在途列表只含本会话', len(pend) == 1 and pend[0]['ticket'] == t_a)
n = ut.revoke_session('sA')
check('6.2 会话级作废只清本会话', n == 1)
ok, _ = ut.consume(t_a, 'net', {}, 'sA', 'ca')
ok_b, _ = ut.consume(t_b, 'net', {}, 'sB', 'cb')
check('6.3 被作废的拒绝、他会的完好', not ok and ok_b)

# ===== 7 并发核销原子性：同票据两线程同时消费，只能成功一次 =====
tk5 = ut.issue('spawn', {'x': 1}, 's1', 'c5')['ticket']
results = []
barrier = threading.Barrier(2)


def _race():
    barrier.wait()
    results.append(ut.consume(tk5, 'spawn', {'x': 1}, 's1', 'c5'))


ths = [threading.Thread(target=_race) for _ in range(2)]
for th in ths:
    th.start()
for th in ths:
    th.join()
wins = sum(1 for ok, _ in results if ok)
check('7 并发双核销只成功一次', wins == 1, results)

# ===== 8 在途上限防灌水 =====
ut.reset_for_tests()
ut.MAX_PENDING = 5
granted = 0
for i in range(8):
    r = ut.issue('net', {'i': i}, 's1', 'c%d' % i)
    if r.get('ok'):
        granted += 1
check('8 在途上限拒发（500→测试设 5，8 发 5 中）', granted == 5, granted)
ut.MAX_PENDING = 500

# ===== 9 peek 不核销 =====
tk6 = ut.issue('net', {'host': 'y'}, 's1', 'c6')['ticket']
pk = ut.peek(tk6)
check('9 peek 可见状态且不核销', pk.get('ok') and not pk.get('used')
      and ut.consume(tk6, 'net', {'host': 'y'}, 's1', 'c6')[0])

# ===== 10 每次签发/核销都进了审计（audit_chain 可用性自证，不读私有日志内容）=====
try:
    import audit_chain
    audit_ok = hasattr(audit_chain, 'record')
except ImportError:
    audit_ok = False
check('10 审计链模块可用（票据动作均应留痕）', audit_ok)

print('== 审批票据回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
