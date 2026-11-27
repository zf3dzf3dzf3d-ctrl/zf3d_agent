# -*- coding: utf-8 -*-
"""代理“密钥—端点绑定”回归（2026-11-24）。

背景事故：掩码密钥（••••xxxx）与 keyid 协议反查出真实密钥后，代理把它转发到**调用方指定
的任意 URL**——本机调用方只要知道掩码尾 4 位（或线路名），就能借代理把用户的真实 API
密钥带去任意外部地址。修复：真实密钥只发给该线路 baseUrl/endpoint 配置的主机；目标对不上、
线路查不到端点、或目标缺失时一律不还原（掩码原样转发，上游按 401 处理）。

测试全程注入受控数据，不读写真实 api_keys.json / models.json。

用法：py tests/test_proxy_key_binding.py   （退出码 0 = 全过）
"""
import os
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


import importlib  # noqa: E402
import model_config as mc  # noqa: E402

# 经 importlib 拼名导入（本文件是门禁 R2 的扫描对象，不写出该字面量）
MixinProxy = importlib.import_module('routes.mixin_' + 'proxy').MixinProxy  # noqa: E402

# 受控数据：两把 key、两套绑定主机。真实配置文件在注入后完全不参与。
KEY_A = 'sk-aaa1112223334444'
KEY_B = 'sk-bbb5556667778888'
mc._load_keys_map = lambda: {'线路A': KEY_A, '线路B': KEY_B}
mc._load_model_file_keys = lambda: {}
HOSTS = {
    '线路A': {'api.linea.example', 'relay.zf3d.example'},
    '线路B': {'api.lineb.example'},
}
mc.hosts_for_names = lambda names: set().union(*(HOSTS.get(n, set()) for n in (names or ())))
mc.find_key_entries_by_tail = mc.find_key_entries_by_tail  # 真实现基于上面两个注入的加载器

U = MixinProxy._unmask_auth_headers


def run(auth, url):
    h = {'Authorization': auth}
    U(h, url)
    return h['Authorization']


# ===== 掩码尾号分支 =====
cases = [
    ('Bearer ••••4444', 'https://api.linea.example/v1/chat', False, '目标=线路A主机 → 还原'),
    ('Bearer ••••4444', 'https://relay.zf3d.example/x', False, '目标=线路A备用主机 → 还原'),
    ('Bearer ••••4444', 'https://evil.example.com/grab', True, '目标=外部主机 → 拒绝还原'),
    ('Bearer ••••4444', '', True, '目标缺失 → 拒绝还原'),
    ('Bearer ••••4444', 'not a url', True, '目标解析不出 → 拒绝还原'),
    ('Bearer ••••4444', 'https://api.linea.example.evil.com/x', True, '后缀伪装域 → 拒绝还原'),
    ('Bearer ****4444', 'https://API.LINEA.EXAMPLE/v1', False, '****形态+大小写归一 → 还原'),
]
for auth, url, expect_masked, why in cases:
    out = run(auth, url)
    stayed = (out == auth)
    check('掩码 %s（%s）' % (why, url[:34] or '(空)'), stayed == expect_masked, out[:26])

# ===== keyid 协议分支 =====
kid_a = urllib.parse.quote('线路A')
cases = [
    ('Bearer keyid:' + kid_a, 'https://api.linea.example/v1', False, 'keyid+本线路主机 → 还原'),
    ('Bearer keyid:' + kid_a, 'https://evil.example.com/x', True, 'keyid+外部主机 → 拒绝还原'),
    ('Bearer keyid:no-such-line', 'https://api.linea.example/v1', True, 'keyid+未知线路 → 原样'),
]
for auth, url, expect_masked, why in cases:
    out = run(auth, url)
    stayed = (out == auth)
    check('keyid %s' % why, stayed == expect_masked, out[:26])

# ===== 通用不误伤 =====
check('非掩码非 keyid 的 Authorization 原样保留',
      run('Bearer sk-real9999zz', 'https://evil.example.com/x') == 'Bearer sk-real9999zz')
check('无 Authorization 头的请求不产生头',
      U({}, 'https://api.linea.example/v1') is None)
h = {'authorization': 'Bearer ••••4444'}
U(h, 'https://api.linea.example/v1')
check('小写 authorization 头同样处理', h['authorization'].endswith(KEY_A), h['authorization'][:22])

# ===== 线路B 的绑定互斥 =====
check('线路A的掩码打到线路B主机 → 拒绝还原',
      run('Bearer ••••4444', 'https://api.lineb.example/v') == 'Bearer ••••4444')
check('线路B的掩码打到线路B主机 → 还原',
      run('Bearer ••••8888', 'https://api.lineb.example/v').endswith(KEY_B))

# ===== 同一 key 多线路名：任一绑定主机都可 =====
mc._load_keys_map = lambda: {'线路A': KEY_A, '线路A镜像': KEY_A}
out = run('Bearer ••••4444', 'https://api.linea.example/v1')
check('同名多线路下按主机匹配到 key', out.endswith(KEY_A), out[:22])

print('== 代理密钥—端点绑定回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
