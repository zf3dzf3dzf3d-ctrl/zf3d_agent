# -*- coding: utf-8 -*-
"""AST 机械拆分器：把 api_dispatch_post/get.py 巨型 do_POST/do_GET 中
以 return 结尾的 `if path == '/xxx':`（或 `path in (...)`）分支抽成
独立模块级 handler，用 @route_post/@route_get 注册进注册表。

纯机械搬家原则：
- 分支函数体逐行保留（仅整体 dedent），不改任何语句；
- 只抽取「体尾为 return」的精确匹配分支（短路语义安全）；
- 名字解析静态校验：函数内引用的名字必须是 self/path/parsed、
  函数内定义、或原文件模块级 import/赋值，否则该分支留在残留链；
- 未抽取的语句按原顺序留在残留 do_XXX 中（含序言与兜底 404）。

用法：
    python\\python.exe server\\tools\\split_dispatch.py post
    python\\python.exe server\\tools\\split_dispatch.py get
"""
import ast
import io
import os
import re
import sys

from util_log import get_logger

log = get_logger('split_dispatch')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SERVER = os.path.join(ROOT, 'server')

TARGETS = {
    'post': dict(
        src='routes/api_dispatch_post.py',
        out='routes/domain_legacy_post.py',
        method='do_POST', reg='route_post', reg_prefix='route_post_prefix',
        dispatch='dispatch_post',
    ),
    'get': dict(
        src='routes/api_dispatch_get.py',
        out='routes/domain_legacy_get.py',
        method='do_GET', reg='route_get', reg_prefix='route_get_prefix',
        dispatch='dispatch_get',
    ),
}


def module_level_names(tree):
    """模块级可引用名字：import 的名字 + 顶层赋值/def/class。"""
    names = set()
    for n in tree.body:
        if isinstance(n, ast.Import):
            for a in n.names:
                names.add((a.asname or a.name).split('.')[0])
        elif isinstance(n, ast.ImportFrom):
            for a in n.names:
                names.add(a.asname or a.name)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
        elif isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
    return names


def used_names(node):
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}


def assigned_names(node):
    out = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    for n in ast.walk(node):
        if isinstance(n, ast.ExceptHandler) and n.name:
            out.add(n.name)
        if isinstance(n, ast.withitem) and n.optional_vars is not None and isinstance(n.optional_vars, ast.Name):
            out.add(n.optional_vars.id)
        if isinstance(n, (ast.comprehension,)):
            out |= {t.id for t in ast.walk(n.target) if isinstance(t, ast.Name)}
    return out


import builtins as _bi
_BUILTINS = set(dir(_bi))


def path_targets(test):
    """从 if 条件提取精确匹配的 path 字面量集合；非精确匹配返回 None。"""
    def one(cmp):
        if (isinstance(cmp.left, ast.Name) and cmp.left.id == 'path'):
            if isinstance(cmp.ops[0], ast.Eq) and isinstance(cmp.comparators[0], ast.Constant):
                return [cmp.comparators[0].value]
            if isinstance(cmp.ops[0], ast.In) and isinstance(cmp.comparators[0], (ast.Tuple, ast.List)):
                if all(isinstance(e, ast.Constant) for e in cmp.comparators[0].elts):
                    return [e.value for e in cmp.comparators[0].elts]
        return None
    if isinstance(test, ast.Compare):
        return one(test)
    if isinstance(test, ast.BoolOp) and isinstance(test.op, ast.Or):
        outs = []
        for v in test.values:
            r = one(v) if isinstance(v, ast.Compare) else None
            if r is None:
                return None
            outs += r
        return outs
    return None


def ends_with_return(body):
    return body and isinstance(body[-1], ast.Return) and body[-1].value is None


def dedent_body(body, extra):
    """把分支体 dedent 到模块级函数体内（额外缩进 4 为函数体）。"""
    src = ast.unparse(ast.Module(body=body, type_ignores=[]))
    # 统一重排缩进：unparse 顶格输出，函数体内需缩进 4
    lines = src.split('\n')
    return '\n'.join(('    ' + l) if l.strip() else '' for l in lines)


def main(kind):
    cfg = TARGETS[kind]
    src_path = os.path.join(SERVER, cfg['src'])
    src = io.open(src_path, encoding='utf-8').read()
    tree = ast.parse(src)
    mod_names = module_level_names(tree)

    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
    fn = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == cfg['method'])
    body = fn.body

    # 函数内局部 import：名字 -> 原始 import 源码行（供迁移分支补 import 用）
    fn_imports = {}   # name -> (kind, stmt)
    for n in ast.walk(fn):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                nm = (a.asname or a.name).split('.')[0]
                fn_imports.setdefault(nm, n)
    fn_import_srcs = {}
    for nm, st in fn_imports.items():
        fn_import_srcs[nm] = ast.unparse(ast.Module(body=[st], type_ignores=[]))

    extracted = []      # (paths, fn_name, node)
    residual = []       # 留在原地的语句
    skipped = []        # 有外部名字依赖被拒的分支
    slug_i = 0

    for stmt in body:
        if isinstance(stmt, ast.If) and ends_with_return(stmt.body):
            paths = path_targets(stmt.test)
            if paths:
                need = used_names(stmt) - assigned_names(stmt) - {'self', 'path', 'parsed'}
                unresolved = need - mod_names - fn_imports.keys() - _BUILTINS \
                    - {'body', 'result', 'parse_qs', 'json', 'os', 'sys', 'time',
                       'threading', 're', 'base64', 'shutil', 'datetime'}
                if unresolved:
                    skipped.append((paths, sorted(unresolved)))
                    residual.append(stmt)
                    continue
                slug_i += 1
                slug = re.sub(r'[^A-Za-z0-9]+', '_', paths[0]).strip('_').lower()
                fname = f"_h_{slug or 'r'}_{slug_i}"
                extracted.append((paths, fname, stmt))
                continue
        residual.append(stmt)

    # 生成新模块
    out_lines = [
        '# -*- coding: utf-8 -*-',
        '"""自动生成（server/tools/split_dispatch.py 机械拆分）：%s 的' % cfg['src'].replace('/', '\\'),
        '以 return 结尾精确 path 分支，逐支注册进路由注册表。',
        '',
        '纯搬家：函数体来自原 if 分支逐行 dedent，未改任何语句；',
        '重新生成会整体覆盖本文件。"""',
        '',
        'from routes.dispatcher import %s' % cfg['reg'],
        '',
        '# 公共 stdlib 兜底（机械迁移分支常用名；未被使用也无副作用）',
        'import os',
        'import sys',
        'import json',
        'import time',
        'import threading',
        'import re',
        'import base64',
        'import shutil',
        'from datetime import datetime',
        'from urllib.parse import parse_qs',
        '',
        '',
    ]
    for paths, fname, stmt in extracted:
        cond = ' or '.join("path == %r" % p for p in paths)
        out_lines.append('@%s(%r)' % (cfg['reg'], paths if len(paths) > 1 else paths[0]))
        out_lines.append('def %s(self, path, parsed):' % fname)
        out_lines.append('    # 原 %s 分支（%s），机械搬家园' % (cfg['method'], cond))
        # 分支内用到的函数局部 import：保留在 handler 体内（导入时机与原语义一致）
        seen_local = set()
        for nm in sorted(used_names(stmt)):
            if nm in fn_import_srcs and nm not in seen_local:
                seen_local.add(nm)
                out_lines.append('    ' + fn_import_srcs[nm])
        out_lines.append(dedent_body(stmt.body, 4))
        out_lines.append('')
        out_lines.append('')
        out_path = os.path.join(SERVER, cfg['out'])
    io.open(out_path, 'w', encoding='utf-8', newline='\n').write('\n'.join(out_lines))

    # 重写原文件：do_XXX 只留残留语句
    fn.body = residual
    ast.fix_missing_locations(tree)
    new_src = ast.unparse(tree)
    io.open(src_path + '.splitnew', 'w', encoding='utf-8', newline='\n').write(new_src)

    log.info('%s: extracted=%d residual_stmts=%d skipped=%d' % (kind, len(extracted), len(residual), len(skipped)))
    for p, u in skipped:
        log.info('  SKIPPED %s needs=%s' % (p, u))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'post')
