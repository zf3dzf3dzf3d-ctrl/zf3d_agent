# -*- coding: utf-8 -*-
"""拆分正确性审计：
1) 原 do_XXX 顶层 if 分支带 orelse 的情况 —— 若被抽取则 orelse 是否会丢；
2) legacy 生成文件中重复 handler 名 / 重复 path 注册计数。
"""
import ast
import io
import re
import sys
from collections import Counter

from util_log import get_logger

log = get_logger('audit_orelse')
sys.path.insert(0, '.')

CASES = [
    ('routes/api_dispatch_post.py', 'do_POST', 'routes/domain_legacy_post.py'),
    ('routes/api_dispatch_get.py', 'do_GET', 'routes/domain_legacy_get.py'),
]

for src_f, meth, legacy_f in CASES:
    t = ast.parse(io.open(src_f, encoding='utf-8').read())
    cls = [n for n in t.body if isinstance(n, ast.ClassDef)][0]
    fn = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == meth][0]
    # 顶层 if 分支的 orelse 情况
    or_else = 0
    or_else_with_path = 0
    for st in fn.body:
        if isinstance(st, ast.If) and st.orelse:
            or_else += 1
            src = ast.unparse(ast.Module(body=st.orelse, type_ignores=[]))
            if "path ==" in src or "path.startswith" in src or "path in (" in src:
                or_else_with_path += 1
    legacy = io.open(legacy_f, encoding='utf-8').read()
    names = re.findall(r"def (_h_[a-z0-9_]+)\(", legacy)
    dups = {k: v for k, v in Counter(names).items() if v > 1}
    regs = re.findall(r"@route_(?:post|get)\((\([^()]*\)|'[^']*')\)", legacy)
    dup_paths = {k: v for k, v in Counter(regs).items() if v > 1}
    log.info('%s %s: top_if_with_orelse=%d orelse_containing_path_branches=%d' % (src_f, meth, or_else, or_else_with_path))
    log.info('  handlers=%d dup_names=%s dup_registrations=%d %s' % (len(names), list(dups)[:5], sum(v - 1 for v in dup_paths.values()), list(dup_paths.items())[:5]))
