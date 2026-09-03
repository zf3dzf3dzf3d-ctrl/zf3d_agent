#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""run - 运行 shell 命令（带安全防护）

安全策略：
  1. 总开关：默认允许，可在 private/port.json 设 "allow_shell": false 全局禁用
  2. 命令黑名单：拦截破坏性/危险命令片段
  3. 超时 300s，输出长度截断
"""
import os
import json
import subprocess
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'run'

# 危险命令黑名单（小写匹配，按词边界粗匹配）
_DANGEROUS_PATTERNS = [
    'rm -rf /', 'rm -rf ~', 'rm -rf *',
    'format ', 'del /f /s /q c:', 'rd /s /q c:',
    'mkfs', 'dd if=', ':(){:|:&};:',
    'reg delete', 'vssadmin delete',
    'curl | sh', 'curl | bash', 'iex (invoke-webrequest', 'iwr | iex',
    'certutil -urlcache', 'bitsadmin /transfer',
    'chmod -r 000 /', 'chown -r',
    '> /dev/sda', 'mkntfs',
]
_DANGEROUS_TOKENS = [
    'net user', 'net localgroup',  # 账户操纵
    'schtasks /create',
    'attrib -s -h',
]


def _shell_allowed():
    """检查 port.json 中的 allow_shell 开关，默认允许"""
    try:
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))))
        p = os.path.join(base, 'private', 'port.json')
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8-sig') as f:
                cfg = json.load(f)
            if isinstance(cfg, dict):
                return cfg.get('allow_shell', True) is True
    except Exception:
        pass
    return True


def _is_dangerous(cmd):
    low = ' ' + cmd.lower().replace('\n', ' ') + ' '
    for pat in _DANGEROUS_PATTERNS:
        if pat in low:
            return pat
    for tok in _DANGEROUS_TOKENS:
        if tok in low:
            return tok
    return None


def _run_one(cmd, cwd):
    bad = _is_dangerous(cmd)
    if bad is not None:
        return {'ok': False, 'blocked': True, 'reason': f'命令包含危险片段 "{bad}"，已被安全策略拦截',
                'stdout': '', 'stderr': '', 'exit_code': -1}
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                              timeout=300, encoding='utf-8', errors='replace',
                              cwd=cwd)
        out = (proc.stdout or '')[:100000]
        err = (proc.stderr or '')[:50000]
        return {'ok': True, 'stdout': out, 'stderr': err,
                'exit_code': proc.returncode}
    except subprocess.TimeoutExpired:
        return {'ok': True, 'stdout': '', 'stderr': 'Timeout (300s)',
                'exit_code': -1, 'timeout': True}
    except Exception as e:
        return {'ok': True, 'stdout': '', 'stderr': str(e), 'exit_code': -1}


def handle(body, ctx):
    if not _shell_allowed():
        ctx.send_json({'ok': False, 'error': 'shell 执行已被禁用（private/port.json 中 allow_shell=false）'})
        return

    codes = body.get('codes')
    if not codes:
        c = body.get('code', '')
        if not c:
            ctx.send_json({'ok': False, 'error': 'No code specified'})
            return
        codes = [{'code': c}]

    if len(codes) == 1:
        cmd = codes[0].get('code', '') if isinstance(codes[0], dict) else str(codes[0])
        r = _run_one(cmd, ctx.project_dir)
        r['cwd'] = ctx.project_dir
        ctx.send_json(r)
        return

    results = []
    for item in codes:
        cmd = item.get('code', '') if isinstance(item, dict) else str(item)
        results.append(_run_one(cmd, ctx.project_dir))
    ctx.send_json({'ok': True, 'multi': True, 'runs': results})
