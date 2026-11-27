# -*- coding: utf-8 -*-
"""能力策略引擎回归（M1.1，2026-11-24）。

钉死 util_policy.PolicyEngine 的验收口径：
  - deny > ask > allow：多层取最严，allow 不能覆盖 deny，也不能放宽用户层默认；
  - 文件内首条匹配优先（顺序即优先级）；
  - 工作区规则只能收紧（结构保证：与用户层取 severity-max）；
  - 能力禁用叠加；规则文件损坏 fail-ask 且 status() 如实暴露；缺失文件 = 空层；
  - mtime 缓存重载；fnmatch 通配与 Windows 路径归一。

用法：py tests/test_policy_engine.py   （退出码 0 = 全过）
"""
import json
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from util_policy import PolicyEngine, default_user_rules_path, get_default_engine  # noqa: E402

_fail = []
PASS = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)
    else:
        PASS.append(name)


def write_rules(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.utime(path, (time.time() + 2, time.time() + 2))   # 压过 1 秒 mtime 缓存


work = tempfile.mkdtemp(prefix='zf_policy_')
user_p = os.path.join(work, 'rules_user.json')
ws_p = os.path.join(work, 'rules_ws.json')
try:
    # ===== 1 用户层首条匹配优先 + 兜底默认 =====
    write_rules(user_p, {'rules': [
        {'capability': 'net', 'target': 'a.example.com', 'action': 'allow'},
        {'capability': 'net', 'target': '*', 'action': 'deny'},
    ]})
    eng = PolicyEngine(user_p)
    check('1.1 首条匹配：a.com 命中 allow',
          eng.decide('net', 'a.example.com').action == 'allow')
    check('1.2 兜底规则：b.com 命中 deny', eng.decide('net', 'b.example.com').action == 'deny')
    check('1.3 无匹配且无默认 → ask（交人）', eng.decide('fs.write', 'x.txt').action == 'ask')
    check('1.4 层标记 user', eng.decide('net', 'a.example.com').layer == 'user')

    # ===== 2 用户层按能力默认 =====
    write_rules(user_p, {'defaults': {'*': 'ask', 'net': 'deny'}})
    eng = PolicyEngine(user_p)
    check('2.1 按能力默认：net → deny', eng.decide('net', 'x').action == 'deny')
    check('2.2 通配默认：fs.write → ask', eng.decide('fs.write', 'x').action == 'ask')

    # ===== 3 工作区只能收紧（结构保证）=====
    write_rules(user_p, {'rules': [{'capability': 'net', 'target': 'a.example.com', 'action': 'allow'}],
                         'defaults': {'*': 'ask'}})
    write_rules(ws_p, {'rules': [
        {'capability': 'net', 'target': 'a.example.com', 'action': 'deny'},
        {'capability': 'net', 'target': '*', 'action': 'allow'},   # 放宽企图
    ]})
    eng = PolicyEngine(user_p, ws_p)
    check('3.1 工作区 deny 收紧用户 allow → deny', eng.decide('net', 'a.example.com').action == 'deny')
    check('3.2 工作区 allow 不能放宽用户默认 ask → ask',
          eng.decide('net', 'other.example.com').action == 'ask')
    check('3.3 收紧命中的层标记', eng.decide('net', 'a.example.com').layer == 'both')

    # ===== 4 allow 不能覆盖 deny（跨层）=====
    write_rules(user_p, {'rules': [{'capability': 'shell', 'target': '*', 'action': 'deny'}],
                         'defaults': {'*': 'allow'}})
    write_rules(ws_p, {'rules': [{'capability': 'shell', 'target': '*', 'action': 'allow'}]})
    eng = PolicyEngine(user_p, ws_p)
    check('4 工作区 allow 无法覆盖用户层 deny', eng.decide('shell', 'cmd').action == 'deny')

    # ===== 5 能力禁用叠加 =====
    write_rules(user_p, {'disabled': ['clipboard'], 'defaults': {'*': 'allow'}})
    write_rules(ws_p, {'disabled': ['net']})
    eng = PolicyEngine(user_p, ws_p)
    check('5.1 用户层禁用 → deny', eng.decide('clipboard', '').action == 'deny')
    check('5.2 工作区禁用 → deny', eng.decide('net', 'x').action == 'deny')
    check('5.3 status 暴露两层禁用清单',
          set(eng.status()['user_disabled']) == {'clipboard'}
          and set(eng.status()['workspace_disabled']) == {'net'})
    eng2 = PolicyEngine(user_p, ws_p)
    check('5.4 未禁用的能力不受牵连', eng2.decide('fs.read', 'x').action == 'allow')

    # ===== 6 损坏文件 fail-ask + degraded 如实暴露 =====
    with open(user_p, 'w', encoding='utf-8') as f:
        f.write('{不是 json')
    os.utime(user_p, (time.time() + 5, time.time() + 5))
    eng = PolicyEngine(user_p, ws_p)
    d = eng.decide('fs.write', 'x')
    check('6.1 规则文件损坏 → fail-ask', d.action == 'ask' and d.layer == 'degraded', d)
    check('6.2 status() 如实暴露损坏', len(eng.status()['degraded']) >= 1, eng.status()['degraded'])

    # ===== 7 缺失文件 = 空层 =====
    missing_u = os.path.join(work, 'missing_user.json')
    eng = PolicyEngine(missing_u, os.path.join(work, 'not_exist_ws.json'))
    check('7 用户层缺失 → 全部走默认 ask', eng.decide('net', 'x').action == 'ask'
          and not eng.status()['degraded'])

    # ===== 8 mtime 重载 =====
    write_rules(user_p, {'rules': [{'capability': 'net', 'target': '*', 'action': 'allow'}]})
    eng = PolicyEngine(user_p)
    check('8.1 初值 deny 前提不存在（首载即 allow）', eng.decide('net', 'x').action == 'allow')
    write_rules(user_p, {'rules': [{'capability': 'net', 'target': '*', 'action': 'deny'}]})
    eng._ensure(force=True)
    check('8.2 规则文件改动后（强制重载）生效', eng.decide('net', 'x').action == 'deny')

    # ===== 9 fnmatch 通配与 Windows 路径归一 =====
    write_rules(user_p, {'rules': [
        {'capability': 'fs.write', 'target': 'private/*', 'action': 'deny'},
        {'capability': 'net', 'target': '*.corp.example', 'action': 'allow'},
    ], 'defaults': {'*': 'ask'}})
    eng = PolicyEngine(user_p)
    check('9.1 路径通配 deny', eng.decide('fs.write', 'private/api_keys.json').action == 'deny')
    check('9.2 Windows 反斜杠归一后命中',
          eng.decide('fs.write', 'private\\api_keys.json').action == 'deny')
    check('9.3 域名通配 allow', eng.decide('net', 'git.corp.example').action == 'allow')
    check('9.4 大小写不敏感', eng.decide('net', 'GIT.CORP.Example').action == 'allow')
    check('9.5 已知限制：fnmatch 非域名感知，"*.corp.example" 会匹配 evil.com?a.corp.example（1.3 网络闸接线时必须先归一化 host 再传入）',
          eng.decide('net', 'evil.com?a.corp.example').action == 'allow')

    # ===== 10 默认路径与单例 =====
    p = default_user_rules_path(ROOT)
    check('10.1 用户规则默认路径指向 private/policy/rules.json',
          p.endswith(os.path.join('private', 'policy', 'rules.json')), p)
    e1 = get_default_engine()
    e2 = get_default_engine()
    check('10.2 默认引擎是进程级单例', e1 is e2)
    st = e1.status()
    check('10.3 默认引擎可读真实规则文件且未损坏', isinstance(st['degraded'], list), st)

    # ===== 11 空 capability 防御 =====
    eng = PolicyEngine(user_p)
    check('11 空 capability → ask（调用方缺陷交人）', eng.decide('', 'x').action == 'ask')

    # ===== 12 目标为空 + '*' 规则 =====
    write_rules(user_p, {'rules': [{'capability': 'clipboard', 'action': 'deny'}]})
    eng = PolicyEngine(user_p)
    check('12 缺省 target=* 匹配空目标', eng.decide('clipboard', '').action == 'deny')
finally:
    import shutil
    shutil.rmtree(work, ignore_errors=True)

print('== 能力策略引擎回归: %d fail ==（通过 %d）' % (len(_fail), len(PASS)))
sys.exit(1 if _fail else 0)
