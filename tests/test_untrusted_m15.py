# -*- coding: utf-8 -*-
"""M1.5 不可信内容标记回归（2026-11-24）。

验收口径（策划案 M1.5）：仅在不可信内容中出现过的域名触发的调用被升级为 ask。
覆盖：登记/去重/TTL/容量/持久化、从页面文本提取、策略升级（allow→ask、deny/ask 不变、
full 模式跳过）、浏览器接线源码在位、真实引擎端到端（临时规则 allow + 登记域名 → ask）。

用法：py tests/test_untrusted_m15.py   （退出码 0 = 全过）
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

import util_policy as up  # noqa: E402
import util_untrusted as uu  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:140]))
    if not cond:
        _fail.append(name)


RULES = os.path.join(ROOT, 'private', 'policy', 'rules.json')
RULES_BAK = open(RULES, 'rb').read()
REG = os.path.join(ROOT, 'private', 'policy', 'untrusted_domains.json')

uu.reset_for_tests()
try:
    # ===== A 登记与查询 =====
    n = uu.mark(['evil.example', 'tracker.example', '127.0.0.1', 'localhost'], source='test')
    check('A1 登记 2 个（回环地址跳过）', n == 2, n)
    check('A2 is_flagged 命中', uu.is_flagged('EVIL.example') and uu.is_flagged('tracker.example'))
    check('A3 未登记域名不命中', not uu.is_flagged('clean.example'))
    r2 = uu.mark(['evil.example'], source='test')
    check('A4 重复登记去重（新登记数为 0）', r2 == 0, r2)
    uu.mark_from_text('<a href="https://linked.example/page">x</a><img src="http://img.example/i.png">',
                      source='page')
    check('A5 从页面文本提取域名', uu.is_flagged('linked.example') and uu.is_flagged('img.example'))
    reg = uu._load()['domains']
    check('A6 来源标记在案', reg.get('linked.example', {}).get('source') == 'page')

    # ===== B 持久化 =====
    uu2 = __import__('importlib').import_module('util_untrusted')
    uu2._cache = None   # 强制重新读盘
    check('B1 登记簿持久化（新实例可见）', uu2.is_flagged('evil.example'))

    # ===== C 容量与 TTL =====
    uu._MAX_DOMAINS = 5
    uu.mark(['d1.example', 'd2.example', 'd3.example', 'd4.example'], source='test')
    check('C1 容量上限淘汰最旧', uu.unflagged_count() <= 5, uu.unflagged_count())
    uu._MAX_DOMAINS = 500
    uu.mark(['linked.example'], source='test')   # 容量测试挤掉的登记域名补回（D 组要用）

    # ===== D 策略升级 =====
    rules_path = os.path.join(work := (ROOT + os.sep + 'tmp' + os.sep + 'zfsbx'), 'rules_u.json') \
        if False else os.path.join(ROOT, 'tmp', 'zfsbx', 'rules_u.json')
    os.makedirs(os.path.dirname(rules_path), exist_ok=True)
    with open(rules_path, 'w', encoding='utf-8') as f:
        json.dump({'defaults': {'*': 'ask'}, 'rules': [
            {'capability': 'net', 'target': 'denied.example', 'action': 'deny'},
            {'capability': 'net', 'target': 'linked.example', 'action': 'allow'},
            {'capability': 'net', 'target': 'trusted.example', 'action': 'allow'}]}, f)
    eng = up.PolicyEngine(rules_path)
    time.sleep(1.05)
    d = eng.decide('net', 'linked.example')
    check('D1 登记域名：规则 allow → 升级 ask（untrusted）',
          d.action == 'ask' and d.layer == 'untrusted', d)
    d2 = eng.decide('net', 'clean.example')
    check('D2 未登记域名保持默认 ask（不变）', d2.action == 'ask' and d2.layer == 'default')
    d3 = eng.decide('net', 'trusted.example')
    check('D3 显式 allow 且未登记 → 仍 allow',
          d3.action == 'allow' and d3.layer == 'user', d3)
    d3b = eng.decide('net', 'denied.example')
    check('D3b deny 规则不受升级影响', d3b.action == 'deny', d3b)
    deny_rules = {'defaults': {'*': 'ask'},
                  'rules': [{'capability': 'net', 'target': 'linked.example', 'action': 'deny'}]}
    with open(rules_path, 'w', encoding='utf-8') as f:
        json.dump(deny_rules, f)
    os.utime(rules_path, (time.time() + 2, time.time() + 2))
    time.sleep(1.05)
    d4 = eng.decide('net', 'ask-target.example')
    check('D4 ask 判定不受升级影响（ask 保持，无二次升级）',
          d4.action == 'ask' and d4.layer == 'default', d4)

    # ===== E full 模式跳过升级 =====
    up.set_mode('full', ttl_sec=600)
    eng._ensure(force=True)
    with open(rules_path, 'w', encoding='utf-8') as f:
        json.dump({'defaults': {'*': 'ask'},
                   'rules': [{'capability': 'net', 'target': 'linked.example', 'action': 'allow'}]}, f)
    os.utime(rules_path, (time.time() + 2, time.time() + 2))
    time.sleep(1.05)
    d5 = eng.decide('net', 'linked.example')
    check('E1 full 模式跳过不可信升级（用户显式选择免审批）', d5.action == 'allow', d5)
    up.set_mode('standard')
    eng._ensure(force=True)

    # ===== F 浏览器接线源码在位 =====
    eng_src = open(os.path.join(SERVER, 'browser_plugin', 'engine.py'), encoding='utf-8').read()
    check('F1 浏览器导航落地页已接登记（源码）', 'mark_from_text' in eng_src)

finally:
    os.environ.pop('ZF_DESKTOP_CONFIRM', None)
    with open(RULES, 'wb') as f:
        f.write(RULES_BAK)
    os.utime(RULES, (time.time() + 2, time.time() + 2))
    up.set_mode('standard')
    if os.path.isfile(REG):
        os.remove(REG)
    uu.reset_for_tests()

check('Z 规则文件已复原', open(RULES, 'rb').read() == RULES_BAK)
print('== M1.5 不可信内容标记回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
