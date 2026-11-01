# -*- coding: utf-8 -*-
"""security_baseline.py - 断言式安全基线巡检（2026-10-25 评估整改配套）。

用法: python security_baseline.py   退出码 0=全绿, 1=有红线。
红线=整改不算完成。纳入 selftest 体系，防安全整改静默回退。
每条断言对应评估报告的一个 P0/P1 缺陷，注释里标了来源。
"""
import os
import sys

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SERVER_DIR)

CHECKS = []


def check(name):
    def deco(fn):
        CHECKS.append((name, fn))
        return fn
    return deco


def read(*parts):
    with open(os.path.join(ROOT, *parts), 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()


# ---- P0-1 密码库：禁止 XOR 降级混淆加密（vault.py） ----
@check('vault.py 无 XOR+base64 降级加密路径（"X:" 前缀不得存在）')
def _():
    src = read('server', 'vault.py')
    assert "'X:'" not in src and '"X:"' not in src, 'vault.py 仍存在 X: XOR 降级路径'


@check('vault.py 缺 cryptography 库时必须报错而非静默降级')
def _():
    src = read('server', 'vault.py')
    assert 'raise RuntimeError' in src or 'raise ImportError' in src, \
        '_enc 缺库时应 raise，不得静默降级'


# ---- P0-1 密码库：get 接口回环限制 + 脱敏（routes/mixin_vault.py） ----
@check('/api/vault/get 仅限 127.0.0.1 回环访问')
def _():
    src = read('server', 'routes', 'mixin_vault.py')
    assert '127.0.0.1' in src, 'vault get 接口未限制回环'


@check('/api/vault/get 非回环响应必须脱敏（末四位）')
def _():
    src = read('server', 'routes', 'mixin_vault.py')
    assert 'mask_password' in src, 'vault get 响应未做脱敏'


# ---- P0-3 认证：空 token 不得恒放行；禁 URL ?token= 回落（security.py） ----
@check('security.py 空 AUTH_TOKEN 不得恒放行（须自动生成并持久化）')
def _():
    src = read('server', 'security.py')
    assert 'if not AUTH_TOKEN:\n        return True' not in src, \
        '空 token 仍恒放行'
    assert 'token_urlsafe' in src, '缺少空 token 自动生成逻辑'


@check('security.py 已删除 URL ?token= 回落（防 token 进日志/历史）')
def _():
    src = read('server', 'security.py')
    assert "q.get('token')" not in src, '?token= URL 回落仍存在'


# ---- P0-2 手机端：禁止 trust-all TLS 与硬编码 IP（ZFNet.kt） ----
@check('ZFNet.kt 无 trust-all TrustManager')
def _():
    src = read('手机版', 'app', 'src', 'main', 'java', 'com', 'zhufeng',
               'agent', 'mobile', 'ZFNet.kt')
    assert 'trustAll' not in src and 'X509TrustManager' not in src, 'trust-all 仍存在'


@check('ZFNet.kt 无 HostnameVerifier 放行')
def _():
    src = read('手机版', 'app', 'src', 'main', 'java', 'com', 'zhufeng',
               'agent', 'mobile', 'ZFNet.kt')
    assert 'HostnameVerifier' not in src, 'HostnameVerifier 放行仍存在'


@check('ZFNet.kt 无硬编码 IP 兜底')
def _():
    src = read('手机版', 'app', 'src', 'main', 'java', 'com', 'zhufeng',
               'agent', 'mobile', 'ZFNet.kt')
    assert '8.138.95.7' not in src and 'HOST_FALLBACK' not in src, '硬编码 IP 兜底仍存在'


@check('手机版 README.md 不得指引 host 改 0.0.0.0（P0-3 指引半边）')
def _():
    src = read('手机版', 'README.md')
    # 禁止"指引性"写法（如：host 改 0.0.0.0）；警示语境（不要写 0.0.0.0）允许
    import re
    assert not re.search(r'(?<!不要写 )0\.0\.0\.0', src.replace('不要写 0.0.0.0', '')), \
        'README 仍指引 0.0.0.0，需改为局域网 IP + 提醒改回'


@check('mixin_vault.py 脱敏顺序正确（先算掩码再清空明文）')
def _():
    src = read('server', 'routes', 'mixin_vault.py')
    i_mask = src.find("mask_password(r.get('password'))")
    i_clear = src.find("r['password'] = ''")
    assert i_mask != -1 and i_clear != -1, '脱敏逻辑缺失'
    assert i_mask < i_clear, '脱敏顺序错误：掩码必须在清空明文之前计算'


@check('security.py token 生成有跨进程防竞态（文件锁+双检）')
def _():
    src = read('server', 'security.py')
    assert 'msvcrt.locking' in src, '缺跨进程文件锁，多进程会各自生成不同 token 互覆'
    assert '_load_auth_token()' in src.split('def _generate_auth_token')[1].split('def ')[0], \
        '生成函数内缺双检回读'


def main():
    failed = 0
    for name, fn in CHECKS:
        try:
            fn()
            print('[PASS] %s' % name)
        except AssertionError as e:
            failed += 1
            print('[FAIL] %s\n       -> %s' % (name, e))
        except Exception as e:
            failed += 1
            print('[ERR ] %s\n       -> %r' % (name, e))
    total = len(CHECKS)
    print('\n安全基线: %d/%d 通过' % (total - failed, total))
    sys.exit(1 if failed else 0)


def run_baseline():
    """供 selftest 调用的入口（返回 True=全绿）。"""
    for name, fn in CHECKS:
        try:
            fn()
        except Exception:
            return False
    return True


if __name__ == '__main__':
    main()


if __name__ == '__main__':
    main()
