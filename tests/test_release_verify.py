# -*- coding: utf-8 -*-
"""发布包签名校验（Ed25519 清单签名，2026-11-24）。

背景：更新器的 SHA-256 校验只能证明“包与校验和一致”。校验和与包若出自同一个被攻陷的渠道，
一致性毫无意义。签名把信任锚换成一把离线保存的私钥：客户端用钉死的公钥验签，再逐个文件核对清单。

钉死的契约（密钥对在测试里现场生成，私钥从不落盘到仓库）：
  A 合格的签名包                       → 通过，文件数正确
  B 篡改包内文件 / 增删文件             → 拒绝（逐项）
  C 清单被改写（哪怕只改版本号）        → 拒绝：签名覆盖清单的全部字节
  D 用别的私钥签 / 公钥不对            → 拒绝
  E 清单含路径穿越或绝对路径条目        → 拒绝
  F 只缺签名或只缺清单                  → 拒绝
  G 未签名包：require_signature 关 → 通过并注明；开 → 拒绝
  H 带签名但不合格：无论开关 → 拒绝
  I 客户端公钥未配置 → 带签名的包拒绝（不降级放行）
  J 排除项（__pycache__ / *.pyc / private 等）不计入清单，也不触发“未登记文件”
  K 清单字节规范化：同一包两次生成的清单逐字节相同
  L 更新器接入点：三种开关状态下返回值符合口径
  M 发布工具：私钥放在仓库内时拒绝签发/生成（防私钥入库）

用法：py tests/test_release_verify.py   （退出码 0 = 全过）
"""
import base64
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

import util_release_verify as rv  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def keypair():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.generate()
    seed = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(seed).decode(), base64.b64encode(pub).decode()


PRIV, PUB = keypair()
PRIV2, _PUB2 = keypair()
tmp = tempfile.mkdtemp(prefix='zf_relsig_')
N = [0]


def make_pkg(files=None, sign=True, key=PRIV, version='6.0.1'):
    """造一个发布包目录并（可选）签名。返回包目录路径。"""
    N[0] += 1
    pkg = os.path.join(tmp, 'pkg_%d' % N[0])
    os.makedirs(os.path.join(pkg, 'server'))
    os.makedirs(os.path.join(pkg, 'public', 'js'))
    for rel, body in {'server/server.py': 'print("v")\n', 'public/index.html': '<html>hi</html>\n',
                      'public/js/app.js': 'console.log(1)\n'}.items():
        with open(os.path.join(pkg, rel), 'w', encoding='utf-8') as f:
            f.write(body)
    for rel, body in (files or {}).items():
        d = os.path.dirname(os.path.join(pkg, rel))
        if d:
            os.makedirs(d, exist_ok=True)
        with open(os.path.join(pkg, rel), 'wb') as f:
            f.write(body if isinstance(body, bytes) else body.encode('utf-8'))
    if sign:
        m = rv.build_manifest(pkg, version)
        with open(os.path.join(pkg, rv.MANIFEST_NAME), 'wb') as f:
            f.write(m)
        with open(os.path.join(pkg, rv.SIGNATURE_NAME), 'w', encoding='ascii') as f:
            f.write(rv.sign_manifest(m, key) + '\n')
    return pkg


def verify(pkg, **kw):
    return rv.verify_release(pkg, public_key_b64=kw.pop('public_key_b64', PUB), **kw)


# ===== A =====
pkg = make_pkg()
ok, reason, n = verify(pkg)
check('A 合格的签名包 → 通过，文件数正确', ok and n == 3, (ok, reason, n))

# ===== B =====
p = make_pkg()
open(os.path.join(p, 'server/server.py'), 'a', encoding='utf-8').write('print("evil")\n')
ok, reason, _n = verify(p)
check('B1 包内文件被篡改 → 拒绝', not ok and '不符' in reason, reason)

p = make_pkg()
open(os.path.join(p, 'server', 'backdoor.py'), 'w').write('x=1\n')
ok, reason, _n = verify(p)
check('B2 包内多出一个未登记文件 → 拒绝', not ok and '未登记' in reason and 'backdoor.py' in reason, reason)

p = make_pkg()
os.remove(os.path.join(p, 'public/js/app.js'))
ok, reason, _n = verify(p)
check('B3 包内少了一个清单登记的文件 → 拒绝', not ok and '缺失' in reason, reason)

# ===== C =====
p = make_pkg()
mp = os.path.join(p, rv.MANIFEST_NAME)
doc = json.loads(open(mp, 'rb').read().decode('utf-8'))
doc['version'] = '9.9.9'                      # 只改版本号，文件列表一字不动
open(mp, 'wb').write(json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'))
ok, reason, _n = verify(p)
check('C1 清单被改写（只改版本号）→ 拒绝：签名覆盖清单全部字节', not ok and '签名' in reason, reason)

p = make_pkg()
mp = os.path.join(p, rv.MANIFEST_NAME)
doc = json.loads(open(mp, 'rb').read().decode('utf-8'))
doc['files'][0]['sha256'] = '0' * 64           # 改一个哈希，试图为篡改背书
open(mp, 'wb').write(json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'))
ok, reason, _n = verify(p)
check('C2 清单里的哈希被改写 → 拒绝', not ok and '签名' in reason, reason)

# ===== D =====
p = make_pkg(key=PRIV2)
ok, reason, _n = verify(p, public_key_b64=PUB)
check('D1 用别的私钥签署 → 拒绝', not ok, reason)
p = make_pkg()
ok, reason, _n = verify(p, public_key_b64=_PUB2)
check('D2 客户端公钥不对 → 拒绝', not ok, reason)

# ===== E =====
p = make_pkg()
m = rv.build_manifest(p, '6.0.1')
doc = json.loads(m.decode('utf-8'))
doc['files'].append({'path': '../../../Windows/System32/evil.dll', 'sha256': 'a' * 64, 'size': 1})
m2 = json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
open(os.path.join(p, rv.MANIFEST_NAME), 'wb').write(m2)
open(os.path.join(p, rv.SIGNATURE_NAME), 'w', encoding='ascii').write(rv.sign_manifest(m2, PRIV))
ok, reason, _n = verify(p)
check('E1 清单含路径穿越条目（即使签名合法）→ 拒绝', not ok and '非法' in reason, reason)

for bad in ('/etc/passwd', 'C:/Windows/x.dll', 'server\\..\\x.py', 'server//x.py', 'server/./x.py', ''):
    check('E2 非法路径被识别：%r' % bad, rv._safe_rel(bad) is None)
check('E3 合法路径放行', rv._safe_rel('server/routes/x.py') == 'server/routes/x.py')

# ===== F =====
p = make_pkg()
os.remove(os.path.join(p, rv.SIGNATURE_NAME))
ok, reason, _n = verify(p)
check('F1 只有清单没有签名 → 拒绝', not ok and '不完整' in reason, reason)
p = make_pkg()
os.remove(os.path.join(p, rv.MANIFEST_NAME))
ok, reason, _n = verify(p)
check('F2 只有签名没有清单 → 拒绝', not ok and '不完整' in reason, reason)

# ===== G =====
p = make_pkg(sign=False)
ok, reason, n = verify(p)
check('G1 未签名包 · require_signature 关 → 通过并注明未签名', ok and reason == '未签名', (ok, reason))
ok, reason, _n = verify(p, required=True)
check('G2 未签名包 · require_signature 开 → 拒绝', not ok and '未签名' in reason, reason)

# ===== H =====
p = make_pkg()
open(os.path.join(p, 'server/server.py'), 'a').write('evil\n')
for req in (False, True):
    ok, reason, _n = verify(p, required=req)
    check('H 带签名但不合格 · require_signature=%s → 拒绝' % req, not ok, reason)

# ===== I =====
p = make_pkg()
ok, reason, _n = rv.verify_release(p, public_key_b64='')
check('I 客户端公钥未配置 → 带签名的包拒绝（不降级放行）', not ok and '公钥' in reason, reason)
ok, reason, _n = rv.verify_release(make_pkg(sign=False), public_key_b64='')
check('I2 公钥未配置但包未签名、开关关闭 → 维持过渡态放行', ok and reason == '未签名', reason)

# ===== J =====
p = make_pkg()
os.makedirs(os.path.join(p, 'server/__pycache__'))
open(os.path.join(p, 'server/__pycache__/x.pyc'), 'wb').write(b'\x00\x01')
open(os.path.join(p, 'server/old.py.bak'), 'w').write('x')
os.makedirs(os.path.join(p, 'private'))
open(os.path.join(p, 'private/api_keys.json'), 'w').write('{}')
ok, reason, n = verify(p)
check('J 排除项不计入清单，也不触发“未登记文件”', ok and n == 3, (ok, reason, n))
check('J2 排除项不出现在清单生成里',
      not any('__pycache__' in r or r.endswith('.bak') or r.startswith('private/') for r in rv.iter_package_files(p)))

# ===== K =====
p = make_pkg()
m1 = rv.build_manifest(p, '6.0.1', built_at='2026-11-24T00:00:00')
m2 = rv.build_manifest(p, '6.0.1', built_at='2026-11-24T00:00:00')
check('K 同一包两次生成的清单逐字节相同（规范化 JSON、文件有序）', m1 == m2)

# ===== L 更新器接入点 =====
import update_checker  # noqa: E402

class _Dummy(object):
    pass


def run_hook(pkg, require_signature):
    """以维护者“已把公钥钉进客户端”的状态调用更新器的校验入口（测试期间临时替换钉死的公钥）。"""
    d = _Dummy()
    d.require_signature = require_signature
    saved_key = rv.RELEASE_PUBLIC_KEY
    rv.RELEASE_PUBLIC_KEY = PUB
    try:
        return update_checker.UpdateChecker._verify_release_signature(d, pkg)
    finally:
        rv.RELEASE_PUBLIC_KEY = saved_key


err, note = run_hook(make_pkg(), False)
check('L1 更新器：签名合格、开关关 → 放行、无说明', err is None and note is None, (err, note))
err, note = run_hook(make_pkg(), True)
check('L2 更新器：签名合格、开关开 → 放行', err is None, (err, note))
err, note = run_hook(make_pkg(sign=False), False)
check('L3 更新器：未签名、开关关 → 放行并返回“未签名”说明（调用方记警告）', err is None and note == '未签名', (err, note))
err, note = run_hook(make_pkg(sign=False), True)
check('L4 更新器：未签名、开关开 → 拒绝', bool(err), (err, note))
p = make_pkg()
open(os.path.join(p, 'public/index.html'), 'a').write('<script>evil</script>')
err, note = run_hook(p, False)
check('L5 更新器：签名包被篡改、开关关 → 仍然拒绝', bool(err), err)

# ===== M 发布工具的防线 =====
import importlib.util  # noqa: E402
from pathlib import Path  # noqa: E402


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name, str(Path(ROOT) / 'tools' / 'release' / (name + '.py')))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


saved = sys.argv
sys.argv = ['keygen.py', '--out', os.path.join(ROOT, 'tmp', 'zf_test_key_should_not_exist')]
import io  # noqa: E402
import contextlib  # noqa: E402
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc_keygen = load_tool('keygen').main()
check('M1 keygen：私钥路径在仓库内 → 拒绝生成', rc_keygen == 2 and not os.path.exists(os.path.join(ROOT, 'tmp', 'zf_test_key_should_not_exist')),
      out.getvalue().strip()[:80])

keyfile = os.path.join(tmp, 'release_key.txt')
open(keyfile, 'w').write(PRIV)
inside_key = os.path.join(ROOT, 'tmp', 'zf_test_key_inside.txt')
open(inside_key, 'w').write(PRIV)
pkg = make_pkg(sign=False)
sys.argv = ['sign_release.py', pkg, '--key', inside_key, '--version', '6.0.1']
with contextlib.redirect_stdout(io.StringIO()):
    rc_sign_inside = load_tool('sign_release').main()
check('M2 sign_release：私钥在仓库内 → 拒绝签署，包内不产生清单与签名',
      rc_sign_inside == 2 and not os.path.exists(os.path.join(pkg, rv.MANIFEST_NAME)))
sys.argv = ['sign_release.py', pkg, '--key', keyfile, '--version', '6.0.1']
with contextlib.redirect_stdout(io.StringIO()):
    rc_sign = load_tool('sign_release').main()
ok, reason, n = verify(pkg)
check('M3 sign_release：正常签署 → 工具自检通过，独立校验也通过', rc_sign == 0 and ok and n == 3, (rc_sign, ok, reason))
os.remove(inside_key)
sys.argv = saved

shutil.rmtree(tmp, ignore_errors=True)
print('== 发布包签名校验回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
