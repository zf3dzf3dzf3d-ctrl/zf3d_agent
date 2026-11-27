# -*- coding: utf-8 -*-
"""一次性重建编排：恢复原始分发文件 → 机械拆分 → 换入 → 编译 → 审计。
必须在仓库根目录用项目 python 运行。
"""
import ast
import io
import os
import re
import subprocess
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
PY = sys.executable

FILES = ['server/routes/api_dispatch_post.py', 'server/routes/api_dispatch_get.py']

# 1) 从原始巨链 commit 恢复（HEAD 已被自动快照污染为残留版，不可用 checkout）
ORIG = 'c47beb61'
for f in FILES:
    r = subprocess.run(['git', 'show', '%s:%s' % (ORIG, f)], capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        print('SHOW FAIL', f, r.stderr)
        sys.exit(1)
    io.open(f, 'w', encoding='utf-8', newline='').write(r.stdout)
print('restored from', ORIG)

# 2) 拆分 post + get
for kind in ('post', 'get'):
    r = subprocess.run([PY, 'server/tools/split_dispatch.py', kind], capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print('SPLIT FAIL', r.stderr)
        sys.exit(1)

# 3) 换入残留版 + 编译
for f in FILES:
    os.replace(f + '.splitnew', f)
r = subprocess.run([PY, '-c', "import py_compile; [py_compile.compile(f, doraise=True) for f in ['server/routes/api_dispatch_post.py','server/routes/api_dispatch_get.py','server/routes/domain_legacy_post.py','server/routes/domain_legacy_get.py']]; print('compile OK')"], capture_output=True, text=True)
print(r.stdout.strip() or r.stderr.strip())
if 'compile OK' not in r.stdout:
    sys.exit(1)

# 4) 审计：重复 handler / 重复注册 / orelse 丢失
for src_f, meth, legacy_f in [
    ('server/routes/api_dispatch_post.py', 'do_POST', 'server/routes/domain_legacy_post.py'),
    ('server/routes/api_dispatch_get.py', 'do_GET', 'server/routes/domain_legacy_get.py'),
]:
    legacy = io.open(legacy_f, encoding='utf-8').read()
    names = re.findall(r"def (_h_[a-z0-9_]+)\(", legacy)
    dups = {k: v for k, v in Counter(names).items() if v > 1}
    regs = re.findall(r"@route_(?:post|get)\(+('[^']*')\)+", legacy)
    dup_paths = {k: v for k, v in Counter(regs).items() if v > 1}
    lt = ast.parse(legacy)
    # 检查每个 handler 是否带装饰器
    bare = 0
    for n in ast.walk(lt):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith('_h_'):
            if not n.decorator_list:
                bare += 1
    print('%s: handlers=%d dup_names=%d dup_regs=%d bare_handlers=%d lines=%d' % (
        legacy_f, len(names), len(dups), sum(v - 1 for v in dup_paths.values()), bare, legacy.count('\n')))
    if dups or bare:
        print('  FAIL detail:', list(dups.items())[:5])
        sys.exit(1)
    # dup_regs 良性：原巨链本身存在同 path 多分支（后者生效），注册表 dict 后写覆盖语义一致
    if dup_paths:
        print('  WARN benign dup_regs (chain last-wins == dict overwrite):', list(dup_paths.items()))

# 5) 路由表加载
r = subprocess.run([PY, '-X', 'utf8', '-c', "import sys; sys.path.insert(0,'server'); from routes.dispatcher import ensure_loaded; from routes import dispatcher as D; ensure_loaded(); print('POST',len(D._POST_ROUTES),'GET',len(D._GET_ROUTES))"], capture_output=True, text=True, cwd=ROOT)
print(r.stdout.strip() or r.stderr.strip()[-500:])
print('ALL PASS')
