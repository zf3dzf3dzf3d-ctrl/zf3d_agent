#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tool_defs_check - 工具定义漂移自检。

单一真源：tools/__init__.py 的后端注册表（tools/*/backend/*.py 的 TOOL_NAME）。
本脚本对比三处定义：
  1. 后端注册表（真源）
  2. 前端 public/js/tools-defs-*.js 中的工具名
  3. （预留）引擎私有 Registry
输出差异报告：
  - backend_only:  后端有、前端没定义（前端无法展示/调用）
  - frontend_only: 前端有定义、后端无实现（调用必失败）
退出码：0=一致，1=有漂移。可挂到 CI 或服务启动时自检。

用法：python tools/tool_defs_check.py [--json]
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'server'))

FRONTEND_DIR = os.path.join(ROOT, 'public', 'js')
# 前端定义格式：  "tool_name": { "type": "function", "function": { "name": "tool_name" ...
_NAME_PAT = re.compile(r'"([a-zA-Z][\w-]{2,60})"\s*:\s*\{\s*"type"\s*:\s*"function"')


def backend_tools():
    from tools import list_tools
    return set(list_tools())


def frontend_tools():
    names = set()
    if not os.path.isdir(FRONTEND_DIR):
        return names
    for fn in sorted(os.listdir(FRONTEND_DIR)):
        if not (fn.startswith('tools-defs-') and fn.endswith('.js')):
            continue
        src = io.open(os.path.join(FRONTEND_DIR, fn), encoding='utf-8', errors='replace').read()
        names.update(_NAME_PAT.findall(src))
    return names


# 蜂群内核级实现（dispatch_swarm.py 提供执行，不经过 backend 注册表），合法豁免
_SWARM_TOOLS = {'read_file', 'write_file', 'run_code', 'list_dir'}


def check():
    b = backend_tools() | _SWARM_TOOLS
    f = frontend_tools()
    report = {
        'backend_count': len(b),
        'frontend_count': len(f),
        'backend_only': sorted(b - f),
        'frontend_only': sorted(f - b),
    }
    report['ok'] = not report['frontend_only']
    return report


def main():
    as_json = '--json' in sys.argv
    r = check()
    if as_json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        print('后端工具数: %d  前端定义数: %d' % (r['backend_count'], r['frontend_count']))
        if r['frontend_only']:
            print('\n[漂移] 前端有定义但后端无实现（调用必失败）:')
            for n in r['frontend_only']:
                print('  - ' + n)
        if r['backend_only']:
            print('\n[提示] 后端有实现但前端未定义（前端无法展示，共 %d 个，前 20 个）:' % len(r['backend_only']))
            for n in r['backend_only'][:20]:
                print('  - ' + n)
        if r['ok']:
            print('\nOK: 无前端漂移。')
    sys.exit(0 if r['ok'] else 1)


if __name__ == '__main__':
    main()
