#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run - 运行 shell 命令"""
import subprocess
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'run'


def handle(body, ctx):
    codes = body.get('codes')
    if not codes:
        c = body.get('code', '')
        if not c:
            ctx.send_json({'ok': False, 'error': 'No code specified'})
            return
        codes = [{'code': c}]

    if len(codes) == 1:
        cmd = codes[0].get('code', '') if isinstance(codes[0], dict) else str(codes[0])
        try:
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                                  timeout=300, encoding='utf-8', errors='replace',
                                  cwd=ctx.project_dir)
            ctx.send_json({'ok': True, 'stdout': proc.stdout, 'stderr': proc.stderr,
                           'exit_code': proc.returncode, 'cwd': ctx.project_dir})
        except subprocess.TimeoutExpired:
            ctx.send_json({'ok': True, 'stdout': '', 'stderr': 'Timeout (300s)',
                           'exit_code': -1, 'timeout': True})
        except Exception as e:
            ctx.send_json({'ok': True, 'stdout': '', 'stderr': str(e),
                           'exit_code': -1})
        return

    results = []
    for item in codes:
        cmd = item.get('code', '') if isinstance(item, dict) else str(item)
        try:
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                                  timeout=300, encoding='utf-8', errors='replace',
                                  cwd=ctx.project_dir)
            results.append({'stdout': proc.stdout, 'stderr': proc.stderr,
                            'exit_code': proc.returncode})
        except subprocess.TimeoutExpired:
            results.append({'stdout': '', 'stderr': 'Timeout (300s)',
                            'exit_code': -1, 'timeout': True})
        except Exception as e:
            results.append({'stdout': '', 'stderr': str(e), 'exit_code': -1})
    ctx.send_json({'ok': True, 'multi': True, 'runs': results})
