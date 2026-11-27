# -*- coding: utf-8 -*-
"""路由等价性审计：注册表 ∪ 残留链 path 集合 与基线清单对比。"""
import sys
import ast
import io

from util_log import get_logger

log = get_logger('audit_dispatch')
sys.path.insert(0, '.')
from routes.dispatcher import ensure_loaded          # noqa: E402
from routes import dispatcher as D                   # noqa: E402

ensure_loaded()


def chain_paths(fname, meth):
    t = ast.parse(io.open(fname, encoding='utf-8').read())
    out = set()
    cls = [n for n in t.body if isinstance(n, ast.ClassDef)][0]
    fn = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == meth][0]

    def walk(n):
        if isinstance(n, ast.Compare) and isinstance(n.left, ast.Name) and n.left.id == 'path':
            if isinstance(n.ops[0], ast.Eq) and isinstance(n.comparators[0], ast.Constant):
                out.add(n.comparators[0].value)
            if isinstance(n.ops[0], ast.In):
                for e in getattr(n.comparators[0], 'elts', []):
                    if isinstance(e, ast.Constant):
                        out.add(e.value)
        elif isinstance(n, ast.BoolOp):
            for v in n.values:
                walk(v)

    for st in ast.walk(fn):
        if isinstance(st, ast.If):
            walk(st.test)
    return out


for kind, reg, f, meth, base in [
    ('post', D._POST_ROUTES, 'routes/api_dispatch_post.py', 'do_POST',
     '../docs/重构基线-20261130-post分支清单.txt'),
    ('get', D._GET_ROUTES, 'routes/api_dispatch_get.py', 'do_GET',
     '../docs/重构基线-20261130-get分支清单.txt'),
]:
    base_paths = set()
    import re as _re
    for line in io.open(base, encoding='utf-8', errors='replace'):
        for m in _re.finditer(r"""['\"](/[^'\"]+)['\"]""", line):
            base_paths.add(m.group(1))
    regset = set(reg.keys())
    resid = chain_paths(f, meth)
    union = regset | resid
    log.info('%s registry=%d residual=%d union=%d baseline=%d' % (kind, len(regset), len(resid), len(union), len(base_paths)))
    log.info('%s %s', '  missing_in_new:', sorted(base_paths - union)[:8])
    log.info('%s %s', '  extra_in_new:', sorted(union - base_paths)[:8])
