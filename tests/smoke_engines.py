# -*- coding: utf-8 -*-
"""冒烟测试：验证每个引擎能加载到自己的专属工具 schema，并实跑一个只读工具。

用法（项目根目录）:
    python\\python.exe tests\\smoke_engines.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, os.path.join(ROOT, 'server', 'engines'))

import engines_loader  # noqa: E402

# 引擎 -> (期望最小工具数, 只读工具名, 工具参数)
READONLY_PROBES = {
    'claude_code_style': (7, 'Glob', {'pattern': 'server/*.py'}),
    'codex_style':       (10, 'codex_list_dir', {'path': 'server'}),
    'deepseek_direct':   (4, 'ds_files', {'path': 'server'}),
    'hermes_style':      (7, None, None),      # h_ 系列按实际名探测
    'openclaw_style':    (3, None, None),
    'pi_style':          (5, None, None),
}


def schemas_of(eid):
    mod = engines_loader.get_module(eid)
    if mod is None or not hasattr(mod, 'get_tool_schemas'):
        return None
    try:
        return mod.get_tool_schemas()
    except Exception as e:
        print('  [warn] get_tool_schemas(%s) failed: %s' % (eid, e))
        return None


def schema_names(schemas):
    names = []
    for s in schemas or []:
        if isinstance(s, dict):
            fn = s.get('function') or s
            names.append(fn.get('name') or s.get('name') or '?')
    return names


def try_probe(eid, probe_name, args):
    """实跑一个只读工具；找不到探测工具名时尝试首个 h_/o_/pi_ 只读工具。"""
    mod = engines_loader.get_module(eid)
    names = schema_names(schemas_of(eid))
    target = probe_name
    if target not in names:
        for n in names:
            if n.startswith(('h_read', 'o_', 'pi_read')):
                target = n
                break
    if not target or target not in names:
        return 'SKIP(无只读探测工具: %s)' % (names[:5],)
    try:
        r = mod.execute_tool_calls([{'name': target, 'arguments': args or {}}], {})
        ok = r is not None
        return 'OK(%s)' % target if ok else 'FAIL(返回None)'
    except Exception as e:
        return 'FAIL(%s: %s)' % (target, e)


def main():
    engines_loader.load_engines()
    results = []
    all_pass = True
    for eid, (min_tools, probe, args) in READONLY_PROBES.items():
        schemas = schemas_of(eid)
        n = len(schemas) if schemas else 0
        ok_n = n >= min_tools
        probe_res = try_probe(eid, probe, args) if ok_n else 'SKIP(schema不足)'
        ok = ok_n and not probe_res.startswith('FAIL')
        all_pass = all_pass and ok
        results.append((eid, n, min_tools, probe_res, ok))
    print()
    print('=' * 62)
    for eid, n, mn, pr, ok in results:
        print(' %-20s tools=%2d (期望>=%d) 探测: %-40s %s'
              % (eid, n, mn, pr, 'PASS' if ok else 'FAIL'))
    print('=' * 62)
    print('SMOKE:', 'ALL PASS' if all_pass else 'FAILED')
    sys.exit(0 if all_pass else 1)


if __name__ == '__main__':
    main()
