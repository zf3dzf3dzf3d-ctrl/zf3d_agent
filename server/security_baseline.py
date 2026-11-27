# -*- coding: utf-8 -*-
"""security_baseline.py - 断言式安全基线巡检（2026-10-25 评估整改配套）。

用法: python security_baseline.py   退出码 0=全绿, 1=有红线。
红线=整改不算完成。纳入 selftest 体系，防安全整改静默回退。
每条断言对应评估报告的一个 P0/P1 缺陷，注释里标了来源。
"""
import os
import sys

from util_log import get_logger

log = get_logger('security_baseline')
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


# ---- 外部隔离：host 必须保持 127.0.0.1 回环（2026-11-20 收口待办：提级告警） ----
@check('运行时 host 必须为 127.0.0.1（private/port.json + config.py 双查，防手改重开暴露面）')
def _():
    import json as _json
    reasons = []
    # 1) 运行时真源 private/port.json
    try:
        with open(os.path.join(ROOT, 'private', 'port.json'), 'r', encoding='utf-8-sig') as f:
            pj = _json.load(f)
        h = str(pj.get('host', ''))
        if h and h not in ('127.0.0.1', 'localhost', '::1'):
            reasons.append('private/port.json host=%s 非回环' % h)
    except FileNotFoundError:
        reasons.append('private/port.json 缺失')
    except Exception as e:
        reasons.append('private/port.json 读取异常 %r' % e)
    # 2) 配置默认值 config.py
    try:
        cfg = read('server', 'config.py')
        import re as _re
        m = _re.search(r"host\s*=\s*['\"]([^'\"]+)['\"]", cfg)
        if m and m.group(1) not in ('127.0.0.1', 'localhost', '::1'):
            reasons.append('config.py host=%s 非回环' % m.group(1))
    except Exception as e:
        reasons.append('config.py 读取异常 %r' % e)
    assert not reasons, '；'.join(reasons)




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


# ---- P0-4【2026-11-23 整改】GET 分发顺序：token 校验必须先于 dispatch_get ----
# 背景：原 do_GET 把 check_request_token 放在 dispatch_get / 巨型 if-elif 链之后，
# 注册表 200+ 条 @route_get 路由（含 /api/models/reveal-key 明文显钥）全部免 token。
@check('api_dispatch_get.do_GET 的 token 校验先于 dispatch_get（注册表路由不得免 token）')
def _():
    src = read('server', 'routes', 'api_dispatch_get.py')
    i_tok = src.find('check_request_token')
    i_dsp = src.find('if dispatch_get(self, path, parsed)')
    assert i_tok != -1 and i_dsp != -1, 'do_GET 缺少 token 校验或 dispatch_get 调用'
    assert i_tok < i_dsp, 'do_GET 的 token 校验在 dispatch_get 之后（免 token 回归）'


# ---- P0-5【2026-11-23 整改】静态响应种 zf_auth Cookie 必须经过回环/已验 token 判定 ----
# 背景：原先静态响应无条件下发 token Cookie，任何能访问服务的请求方抓一条静态
# 响应即得 token，token 形同白送；叠加免 token GET 链即整站失守。
@check('mixin_static.py 种 zf_auth Cookie 必须传 handler 判定（不得无条件下发 token）')
def _():
    src = read('server', 'routes', 'mixin_static.py')
    assert 'auth_cookie_header()' not in src, '静态响应仍无条件下发 token Cookie（未传 handler）'
    assert 'auth_cookie_header(self)' in src, '静态响应未接入回环/已验 token 判定'
    sec = read('server', 'security.py')
    assert 'should_issue_auth_cookie' in sec, 'security.py 缺 Cookie 下发判定函数'


@check('ai_proxy.py 有跨站浏览器请求检测（before_request）')
def _():
    src = read('ai_proxy.py')
    assert 'before_request' in src, 'ai_proxy 缺跨站浏览器请求检测'
    assert 'Sec-Fetch-Site' in src and 'Origin' in src, '跨站检测逻辑不完整'


def main():
    failed = 0
    for name, fn in CHECKS:
        try:
            fn()
            log.info('[PASS] %s' % name)
        except AssertionError as e:
            failed += 1
            log.info('[FAIL] %s\n       -> %s' % (name, e))
        except Exception as e:
            failed += 1
            log.info('[ERR ] %s\n       -> %r' % (name, e))
    total = len(CHECKS)
    log.info('\n安全基线: %d/%d 通过' % (total - failed, total))
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
