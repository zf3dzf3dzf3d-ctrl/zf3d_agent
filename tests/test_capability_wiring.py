# -*- coding: utf-8 -*-
"""M1.3 能力接线回归（2026-11-24）：fs.write / shell / net 三类接入 PolicyEngine 的端到端验证。

覆盖：
  A check_tool_call 单元语义（deny 即拒 / ask 无票据拒 / ask 票据核销放行 / 票据错参数拒）
  B write 工具端到端（默认 allow 正常写；临时 deny 规则下被策略拒）
  C replace_text 工具端到端（临时 deny 规则下被策略拒）
  D run(shell) 工具端到端（默认 allow 正常执行冒烟）
  E egress_gate net 端到端（临时 deny 域名被拦；恢复后放行；ask 过渡期放行）
  F 行为不变证明：接线前后默认姿势一致（allow 类不折腾）

用法：py tests/test_capability_wiring.py   （退出码 0 = 全过）
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
from util_policy import PolicyEngine, check_tool_call  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:160]))
    if not cond:
        _fail.append(name)


# ===== A check_tool_call 单元语义（临时规则，不碰真实策略）=====
work = os.path.join(ROOT, 'tmp', 'zfsbx', 'wiring_%d' % os.getpid())
os.makedirs(work, exist_ok=True)
u_p = os.path.join(work, 'u.json')
w_p = os.path.join(work, 'w.json')


def write_rules(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.utime(path, (time.time() + 2, time.time() + 2))


write_rules(u_p, {'defaults': {'*': 'ask'}, 'rules': [
    {'capability': 'net', 'target': 'evil.example', 'action': 'deny'},
]})
eng = PolicyEngine(u_p)

ok, reason, _ = check_tool_call(eng, 'net', 'good.example', {'h': 'good'}, {})
check('A1 allow 层：默认 ask → 无票据拒（need_ticket）', not ok and 'need_ticket' in reason, reason)
ok, reason, _ = check_tool_call(eng, 'net', 'evil.example', {'h': 'evil'}, {})
check('A2 deny 即拒', not ok and reason.startswith('policy_deny'), reason)

ut.reset_for_tests()
tk = ut.issue('net', {'h': 'good'}, 'sx', 'cx', ttl=60)['ticket']
body = {'_policy_ticket': tk, '_session_id': 'sx', '_call_id': 'cx'}
ok, reason, _ = check_tool_call(eng, 'net', 'good.example', {'h': 'good'}, body)
check('A3 ask + 有效票据 → 放行且已核销', ok and 'approved' in reason, reason)
ok, reason = ut.consume(tk, 'net', {'h': 'good'}, 'sx', 'cx')
check('A4 票据一次性（核销后再用拒绝）', not ok and reason == 'already_used')
tk2 = ut.issue('net', {'h': 'good'}, 'sx', 'cx', ttl=60)['ticket']
ok, reason, _ = check_tool_call(eng, 'net', 'good.example', {'h': 'OTHER'}, {'_policy_ticket': tk2, '_session_id': 'sx', '_call_id': 'cx'})
check('A5 票据参数不符 → 拒（invalid: params_mismatch）', not ok and 'params_mismatch' in reason, reason)

# ===== B/C/D/E 工具端到端（走真实规则文件，改前改后复原）=====
sys.path.insert(0, os.path.join(SERVER))
RULES = os.path.join(ROOT, 'private', 'policy', 'rules.json')
RULES_BAK = open(RULES, 'rb').read()


def save_rules():
    return open(RULES, 'rb').read()


def load_rules_obj():
    return json.loads(open(RULES, encoding='utf-8-sig').read())


def restore_rules(bak):
    with open(RULES, 'wb') as f:
        f.write(bak)
    os.utime(RULES, (time.time() + 2, time.time() + 2))


class FakeCtx(object):
    def __init__(self):
        self.sent = []
        self.project_dir = ROOT
        self.project_dir_note = ''

    def send_json(self, obj):
        self.sent.append(obj)

    def send_error(self, msg):
        self.sent.append({'ok': False, 'error': msg})


def last_sent(ctx):
    return ctx.sent[-1] if ctx.sent else {}


# --- B write 工具 ---
from tools.coding.backend import write as write_tool  # noqa: E402

target_path = 'tmp/zfsbx/wiring_ok_%d.txt' % os.getpid()
ctx = FakeCtx()
write_tool.handle({'path': target_path, 'content': 'wiring-ok', '_session_id': 'sx', '_call_id': 'bw1'}, ctx)
r = last_sent(ctx)
check('B1 默认 allow：write 正常落盘（行为不变）',
      r.get('ok') is True and os.path.isfile(os.path.join(ROOT, target_path)), r)

rules = load_rules_obj()
rules['rules'] = [{'capability': 'fs.write', 'target': 'tmp/zfsbx/wiring_ok_*',
                          'action': 'deny', 'note': 'E2E 测试（首条匹配优先，须排在兜底前）'}] + rules.get('rules', [])
with open(RULES, 'wb') as f:
    f.write(json.dumps(rules, ensure_ascii=False).encode('utf-8'))
os.utime(RULES, (time.time() + 2, time.time() + 2))
time.sleep(1.2)
ctx2 = FakeCtx()
write_tool.handle({'path': target_path, 'content': 'should-deny', '_session_id': 'sx', '_call_id': 'bw2'}, ctx2)
r2 = last_sent(ctx2)
check('B2 临时 deny 规则 → write 被策略拒', r2.get('ok') is False and 'policy_deny' in str(r2.get('error')), r2)
restore_rules(RULES_BAK)
time.sleep(1.2)

# --- C replace_text 工具 ---
from tools.coding.backend import replace_text as rt_tool  # noqa: E402

rt_file = os.path.join(ROOT, 'tmp', 'zfsbx', 'rt_%d.txt' % os.getpid())
with open(rt_file, 'w', encoding='utf-8') as f:
    f.write('hello world')
rules = load_rules_obj()
rules['rules'] = [{'capability': 'fs.write', 'target': 'tmp/zfsbx/rt_*',
                          'action': 'deny', 'note': 'E2E 测试'}] + rules.get('rules', [])
with open(RULES, 'wb') as f:
    f.write(json.dumps(rules, ensure_ascii=False).encode('utf-8'))
os.utime(RULES, (time.time() + 2, time.time() + 2))
time.sleep(1.2)
ctx3 = FakeCtx()
rt_tool.handle({'path': rt_file, 'old_text': 'hello', 'new_text': 'bye',
                '_session_id': 'sx', '_call_id': 'br1'}, ctx3)
r3 = last_sent(ctx3)
check('C1 临时 deny 规则 → replace 被策略拒', r3.get('ok') is False and 'policy_deny' in str(r3.get('error')), r3)
check('C2 文件内容未被改动（拒绝发生在写入前）', open(rt_file, encoding='utf-8').read() == 'hello world')
restore_rules(RULES_BAK)
time.sleep(1.2)
ctx4 = FakeCtx()
rt_tool.handle({'path': rt_file, 'old_text': 'hello', 'new_text': 'bye',
                '_session_id': 'sx', '_call_id': 'br2'}, ctx4)
r4 = last_sent(ctx4)
check('C3 恢复后 replace 正常（行为不变）', r4.get('ok') is True
      and open(rt_file, encoding='utf-8').read() == 'bye world', r4)

# --- D run(shell) 工具 ---
from tools.coding.backend import run as run_tool  # noqa: E402

ctx5 = FakeCtx()
run_tool.handle({'code': 'echo zfsbx-wiring-smoke', '_session_id': 'sx', '_call_id': 'bd1'}, ctx5)
r5 = last_sent(ctx5)
check('D1 默认 allow：shell 正常执行冒烟（行为不变）',
      r5.get('ok') is True and 'zfsbx-wiring-smoke' in json.dumps(r5, ensure_ascii=False), r5)

# --- E egress_gate net ---
import egress_gate  # noqa: E402

rules = load_rules_obj()
rules['rules'] = [{'capability': 'net', 'target': 'blocked-test.example',
                          'action': 'deny', 'note': 'E2E 测试'}] + rules.get('rules', [])
with open(RULES, 'wb') as f:
    f.write(json.dumps(rules, ensure_ascii=False).encode('utf-8'))
os.utime(RULES, (time.time() + 2, time.time() + 2))
time.sleep(1.2)
res = egress_gate.check('net', 'https://blocked-test.example/x', text='t', actor='policy_test')
check('E1 临时 deny 域名 → egress 拦截', res.get('decision') == 'block' and res.get('level') == 'policy', res.get('reason'))
restore_rules(RULES_BAK)
os.utime(RULES, (time.time() + 2, time.time() + 2))
time.sleep(1.2)
res2 = egress_gate.check('net', 'https://example.com/x', text='t', actor='policy_test')
check('E2 恢复后放行（ask 过渡期 allow 分支）', res2.get('decision') == 'allow', res2.get('reason'))
res3 = egress_gate.check('net', 'https://127.0.0.1:8620/api', text='t', actor='policy_test')
check('E3 本机回环规则 allow → 放行', res3.get('decision') == 'allow', res3.get('reason'))

# ===== F 恢复校验 =====
cur = open(RULES, 'rb').read()
check('F1 规则文件已复原（与测试前逐字节一致）', cur == RULES_BAK)

import shutil  # noqa: E402
shutil.rmtree(work, ignore_errors=True)
try:
    os.remove(os.path.join(ROOT, target_path))
    os.remove(rt_file)
except OSError:
    pass

print('== M1.3 能力接线回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
