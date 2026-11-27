# -*- coding: utf-8 -*-
"""明文显钥二次验证（2026-11-24）。

背景：GET /api/models/reveal-key?tail=xxxx 凭 4 位尾号即返回解密后的完整密钥，而本机回环请求免
token——智能体自己执行的 shell 命令就能把全部密钥取走。而且同一段代码有两份：路由模块里一份、
route.legacy-get 插件里一份（插件后注册，实际生效的是插件那份）。

修复：明文显钥改为 POST + “查看密钥密码”；密码首设/修改走电脑上的原生窗口（独立子进程）；
scrypt 存储、错 5 次锁 5 分钟、验证通过签发 5 分钟会话、成功显钥写审计。

钉死的契约（原生窗口全程打桩，不真的弹窗）：
  A 密码设置：长度校验；已设置过不得悄悄覆盖
  B 验证与会话：未设置 / 密码错 / 密码对；会话 Cookie 校验；注销
  C 防爆破：连错 5 次锁定；锁定期内密码正确也拒绝；锁过期恢复；成功一次清零
  D 换密码后旧会话作废
  E 原生窗口：同一时刻只开一个、30 秒冷却；拉不起来时如实返回
  F 路由：实际生效的 GET 路由不返回 key；POST 的五种状态；会话期内免密；缺 tail 拒绝
  G 审计：验证失败与成功显钥都留痕
  H 源码约束：前端用 POST 且不再把尾号拼进 URL；输入框支持密码模式；两份旧副本都不再查密钥

用法：py tests/test_key_reveal.py   （退出码 0 = 全过）
"""
import ast
import json
import os
import shutil
import sys
import tempfile

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


tmp = tempfile.mkdtemp(prefix='zf_keyreveal_')
import util_key_reveal as kr  # noqa: E402

kr.STORE_FILE = os.path.join(tmp, 'key_reveal.json')
kr.FAIL_FILE = os.path.join(tmp, 'key_reveal_fail.json')
_events = []
kr.log_event = lambda action, detail='': _events.append((action, str(detail)))
import model_config  # noqa: E402

_real_lookup = model_config.find_key_by_tail
model_config.find_key_by_tail = lambda tail: ('sk-REAL-KEY-VALUE-' + tail) if tail == 'abcd' else None

GOOD = 'correct-horse-42'

# ===== A =====
check('A1 未设置时 is_configured 为 False', kr.is_configured() is False)
check('A2 太短的密码被拒', kr.set_password('123').get('ok') is False)
check('A3 全空格的密码被拒', kr.set_password('      ').get('ok') is False)
check('A4 超长的密码被拒', kr.set_password('x' * (kr.MAX_LEN + 1)).get('ok') is False)
check('A5 合法密码设置成功，且只存哈希不存明文', kr.set_password(GOOD).get('ok') is True
      and GOOD not in open(kr.STORE_FILE, encoding='utf-8').read())
check('A6 已设置后 is_configured 为 True', kr.is_configured() is True)
check('A7 已设置过：不带 replace 不能覆盖（防悄悄换密码）', kr.set_password('another-pass-1').get('ok') is False
      and kr.verify_password(GOOD))

# ===== B =====
check('B1 密码错误：拒绝并计数', kr.verify('wrong-pass-1', '127.0.0.1')[0].get('fails') == 1)
res, token = kr.verify(GOOD, '127.0.0.1')
check('B2 密码正确：通过并签发会话 token', res.get('ok') is True and token)
check('B3 会话 Cookie 有效', kr.check_token('other=x; ' + kr.cookie_header(token)) is True)
check('B4 伪造 / 空 Cookie 无效', kr.check_token(kr.COOKIE_NAME + '=forged') is False and kr.check_token('') is False)
kr.revoke()
check('B5 注销后会话失效', kr.check_token(kr.cookie_header(token)) is False)

# ===== C =====
for i in range(kr.FAIL_LIMIT):
    res, token = kr.verify('bad-pass-%d' % i, '127.0.0.1')
check('C1 连错 %d 次后锁定，给出剩余秒数' % kr.FAIL_LIMIT,
      res.get('err') == 'locked' and res.get('retryAfter', 0) > 0 and token is None, res)
res, token = kr.verify(GOOD, '127.0.0.1')
check('C2 锁定期内密码正确也拒绝', res.get('err') == 'locked' and token is None, res)
check('C3 check_bruteforce 给出剩余秒数', isinstance(kr.check_bruteforce(), int))
with open(kr.FAIL_FILE, 'w', encoding='utf-8') as f:
    json.dump({'n': 0, 'lockUntil': 0}, f)
res, token = kr.verify(GOOD, '127.0.0.1')
check('C4 锁过期后恢复，密码正确即通过', res.get('ok') is True and token is not None)
for i in range(3):
    kr.verify('bad-pass-%d' % i, '127.0.0.1')
kr.verify(GOOD, '127.0.0.1')
check('C5 成功一次即清零失败计数（之后的错误从 1 重新数）',
      kr.verify('bad-pass-9', '127.0.0.1')[0].get('fails') == 1)

# ===== D =====
res, token = kr.verify(GOOD, '127.0.0.1')
kr.set_password('brand-new-pass-7', replace=True)
check('D1 换密码后旧会话作废', kr.check_token(kr.cookie_header(token)) is False)
check('D2 换密码后旧密码失效、新密码有效', not kr.verify_password(GOOD) and kr.verify_password('brand-new-pass-7'))
kr.set_password(GOOD, replace=True)

# ===== E =====
class _FakeProc(object):
    def poll(self):
        return 0


class _DeadPopen(object):
    calls = 0

    def __call__(self, cmd, **kw):
        _DeadPopen.calls += 1
        return _FakeProc()


class _BrokenPopen(object):
    def __call__(self, cmd, **kw):
        raise OSError('no display')


_saved_popen = kr.subprocess.Popen
try:
    kr.subprocess.Popen = _DeadPopen()
    kr._dialog_proc = None
    kr._dialog_started_at = 0.0
    r1 = kr.start_dialog()
    cmd = None
    check('E1 首次调用：真的去拉起原生窗口（已设置 → 修改模式）',
          r1.get('started') is True and r1.get('mode') == 'change' and _DeadPopen.calls == 1, r1)
    r2 = kr.start_dialog()
    check('E2 30 秒冷却期内再调用：不重复弹窗', r2.get('started') is False and _DeadPopen.calls == 1, r2)
    kr.subprocess.Popen = _BrokenPopen()
    kr._dialog_started_at = 0.0
    r3 = kr.start_dialog()
    check('E3 拉不起窗口时如实返回失败，不谎报已弹出', r3.get('ok') is False and 'error' in r3, r3)
finally:
    kr.subprocess.Popen = _saved_popen
    kr._dialog_proc = None
    kr._dialog_started_at = 0.0

# ===== F 路由 =====
import routes.dispatcher as dsp  # noqa: E402

dsp.ensure_loaded()
check('F1 POST /api/models/reveal-key 已注册', '/api/models/reveal-key' in dsp._POST_ROUTES)
check('F2 POST /api/models/reveal-key/setup 已注册', '/api/models/reveal-key/setup' in dsp._POST_ROUTES)


class FakeHandler(object):
    def __init__(self, body=None, cookie=''):
        self._body = body if body is not None else {}
        self.headers = {'Cookie': cookie}
        self.client_address = ('127.0.0.1', 0)
        self.sent = None

    def _read_body(self):
        return self._body

    def _send_json(self, data, code=200, extra_headers=None):
        self.sent = (data, code, extra_headers)


get_fn = dsp._GET_ROUTES.get('/api/models/reveal-key')
check('F3 实际生效的 GET 路由存在', callable(get_fn))
h = FakeHandler()
get_fn(h, '/api/models/reveal-key', None)
data, code, _x = h.sent
check('F4 GET ?tail= 不再返回 key，只回引导信息（尾号攻击链关闭）',
      'key' not in data and data.get('ok') is False and data.get('need_password') is True and code == 405, (data, code))

post_fn = dsp._POST_ROUTES['/api/models/reveal-key']
_saved_dialog = kr.start_dialog
_dialog_calls = []
kr.start_dialog = lambda: (_dialog_calls.append(1), {'ok': True, 'started': True, 'mode': 'setup'})[1]
try:
    # 未设置密码
    with open(kr.STORE_FILE, 'w', encoding='utf-8') as f:
        json.dump({}, f)
    h = FakeHandler({'tail': 'abcd'})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F5 未设置密码：返回 need_setup 并触发原生窗口；绝不返回 key',
          data.get('need_setup') is True and 'key' not in data and code == 403 and len(_dialog_calls) == 1, (data, code))
    # 已设置密码
    kr.set_password(GOOD, replace=True)
    h = FakeHandler({'tail': 'abcd'})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F6 已设置但未带密码：返回 need_password；不返回 key', data.get('need_password') is True and 'key' not in data and code == 403, (data, code))
    h = FakeHandler({'tail': 'abcd', 'password': 'nope-nope'})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F7 密码错误：403，不返回 key', data.get('err') == 'wrong_password' and 'key' not in data and code == 403, (data, code))
    h = FakeHandler({'tail': 'abcd', 'password': GOOD})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, extra = h.sent
    cookie = (extra or [('', '')])[0][1]
    check('F8 密码正确：返回 key，并下发 HttpOnly / SameSite=Strict 会话 Cookie',
          data.get('ok') is True and data.get('key') == 'sk-REAL-KEY-VALUE-abcd' and code == 200
          and cookie.startswith(kr.COOKIE_NAME + '=') and 'HttpOnly' in cookie and 'SameSite=Strict' in cookie, (code, bool(cookie)))
    h = FakeHandler({'tail': 'abcd'}, cookie=cookie.split(';')[0])
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F9 会话期内免密，且不再下发新 Cookie', data.get('ok') is True and code == 200 and _x is None, (code, _x))
    h = FakeHandler({'tail': 'zzzz', 'password': GOOD})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F10 尾号查不到：404，不返回 key', code == 404 and 'key' not in data, (code, data))
    h = FakeHandler({'tail': 'ab cd; drop', 'password': GOOD})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F11 非法 tail：400', code == 400, (code, data))
    h = FakeHandler({'password': GOOD})
    post_fn(h, '/api/models/reveal-key', None)
    data, code, _x = h.sent
    check('F12 缺 tail：400', code == 400, (code, data))
    setup_fn = dsp._POST_ROUTES['/api/models/reveal-key/setup']
    n = len(_dialog_calls)
    h = FakeHandler({})
    setup_fn(h, '/api/models/reveal-key/setup', None)
    check('F13 setup 接口只负责把窗口叫出来，不接受任何密码', h.sent[0].get('started') is True and len(_dialog_calls) == n + 1, h.sent[0])
finally:
    kr.start_dialog = _saved_dialog

# ===== G 审计 =====
kinds = [a for a, _d in _events]
check('G1 验证失败与成功、设置密码、成功显钥都留了审计', all(k in kinds for k in ('verify_fail', 'verify_ok', 'password_set', 'reveal')), sorted(set(kinds)))
reveals = [d for a, d in _events if a == 'reveal']
check('G2 显钥审计只记尾号与来源，不记明文密钥', reveals and all('sk-REAL' not in d and 'abcd' in d for d in reveals), reveals[:1])

# ===== H 源码约束 =====
def src(rel):
    return open(os.path.join(ROOT, rel), encoding='utf-8', errors='replace').read()


mcr = src('public/js/model-config-rewrite.js')
check('H1 前端取密钥改用 POST', "fetch('/api/models/reveal-key', {" in mcr and "method: 'POST'" in mcr)
check('H2 前端不再把尾号拼进 URL', 'reveal-key?tail=' not in mcr and 'reveal-key?' not in mcr)
check('H3 前端用密码模式的输入框收密码', 'password: true' in mcr and 'ConfirmDialog.prompt' in mcr)
cd = src('public/js/confirm-dialog.js')
check('H4 输入对话框支持密码模式', "opts.password ? 'password' : 'text'" in cd)
def _handler_code(text, marker):
    """取 marker 之后、下一个路由之前的处理函数代码（去掉注释行），用于比较两份副本是否一致。"""
    seg = text.split(marker)[1].split('\n@route_get')[0]
    return '\n'.join(l.rstrip() for l in seg.splitlines() if l.strip() and not l.strip().startswith('#'))


for rel in ('server/routes/domain_legacy_get.py', 'plugins/route.legacy-get/legacy_get_routes.py'):
    check('H5 %s 的 GET 显钥路由不再查密钥' % rel.split('/')[-1],
          'find_key_by_tail' not in _handler_code(src(rel), "@route_get('/api/models/reveal-key')"))
check('H6 两份 GET 显钥副本的代码完全一致（插件覆盖路由模块，只改一处等于没改）',
      _handler_code(src('server/routes/domain_legacy_get.py'), "@route_get('/api/models/reveal-key')")
      == _handler_code(src('plugins/route.legacy-get/legacy_get_routes.py'), "@route_get('/api/models/reveal-key')"))
dlg = src('server/util_key_reveal_dialog.py')
ast.parse(dlg)
check('H7 原生窗口脚本语法正确，且修改密码要先验当前密码', '--mode' in dlg and 'verify_password(cur_var.get())' in dlg)

model_config.find_key_by_tail = _real_lookup
shutil.rmtree(tmp, ignore_errors=True)

print('== 明文显钥二次验证回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
