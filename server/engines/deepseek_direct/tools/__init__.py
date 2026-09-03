#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deepseek_direct/tools - DeepSeek 引擎专属工具集（物理隔离，自研实现）

设计哲学：
1. 极简 schema：deepseek 对 function calling 的 JSON schema 较挑剔，
   全部工具只收扁平 string 参数，不放嵌套对象/枚举
2. 工具数量最少：4 个，覆盖 80% 场景
3. 返回纯文本，无装饰头（deepseek 对格式噪声敏感）
4. 安全墙：写前自动备份 / 危险命令拦截 / 批量与核心文件自检
   （见 engines/common/safety_wall.py，三层防护）
"""

import os
import subprocess

from engines.common.tool_base import Registry, resolve_path, clip_text
from engines.common.safety_wall import (
    backup_before_write, check_shell_command, check_code,
    check_batch_write, core_file_warning,
)

registry = Registry('deepseek_direct')

CLIP = 6000
RUN_TIMEOUT = 30

_STR = {'type': 'string'}


@registry.register(
    'ds_read',
    'Read a file inside the project. Parameter: path.',
    {'type': 'object', 'properties': {'path': _STR}, 'required': ['path']},
)
def ds_read(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return False, 'file not found: %s' % args.get('path')
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        return True, clip_text(f.read(), CLIP)


@registry.register(
    'ds_write',
    'Write a file inside the project (overwrite). Parameters: path, content.',
    {'type': 'object', 'properties': {'path': _STR, 'content': _STR}, 'required': ['path', 'content']},
)
def ds_write(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full:
        return False, 'path not allowed: %s' % args.get('path')
    # 安全墙：写前备份 + 核心文件提示
    backup_before_write(full, tag='ds_write')
    warn = core_file_warning(full)
    os.makedirs(os.path.dirname(full) or '.', exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(args.get('content', ''))
    return True, 'ok: wrote %s%s' % (args.get('path'), warn)


@registry.register(
    'ds_files',
    'List files under a project subdirectory. Parameter: path (use "." for root).',
    {'type': 'object', 'properties': {'path': _STR}, 'required': []},
)
def ds_files(args, ctx):
    base = resolve_path(args.get('path') or '.', ctx.get('project_path'))
    if not base or not os.path.isdir(base):
        return False, 'dir not found: %s' % args.get('path')
    out = []
    for root, dirs, files in os.walk(base):
        rel = os.path.relpath(root, base)
        if rel.count(os.sep) >= 2:
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        for fn in sorted(files)[:60]:
            out.append(os.path.normpath(os.path.join(rel, fn)))
    return True, clip_text('\n'.join(out), CLIP) if out else '(empty)'


@registry.register(
    'ds_grep',
    'Search a keyword in project files. Parameters: keyword, path (dir, default ".").',
    {'type': 'object', 'properties': {'keyword': _STR, 'path': _STR}, 'required': ['keyword']},
)
def ds_grep(args, ctx):
    kw = args.get('keyword') or ''
    if not kw:
        return False, 'keyword is empty'
    base = resolve_path(args.get('path') or '.', ctx.get('project_path'))
    if not base or not os.path.isdir(base):
        return False, 'dir not found: %s' % args.get('path')
    hits = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        for fn in files:
            if len(hits) >= 30:
                break
            fp = os.path.join(root, fn)
            try:
                if os.path.getsize(fp) > 2 * 1024 * 1024:
                    continue
                with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    for i, line in enumerate(f, 1):
                        if kw in line:
                            hits.append('%s:%d: %s' % (os.path.relpath(fp, base), i, line.strip()[:200]))
                            if len(hits) >= 30:
                                break
            except OSError:
                continue
    return True, clip_text('\n'.join(hits), CLIP) if hits else 'no matches'


@registry.register(
    'ds_run',
    'Run a shell command in the project directory. Parameter: code.',
    {'type': 'object', 'properties': {'code': _STR}, 'required': ['code']},
    dangerous=True,
)
def ds_run(args, ctx):
    code = args.get('code', '')
    # 安全墙第二层：危险命令拦截
    deny = check_shell_command(code) or check_code(code)
    if deny:
        return False, deny
    try:
        r = subprocess.run(code, shell=True, capture_output=True,
                           timeout=RUN_TIMEOUT, cwd=ctx.get('project_path') or '.')
    except subprocess.TimeoutExpired:
        return False, 'timeout after %ss' % RUN_TIMEOUT
    out = ((r.stdout or b'') + (r.stderr or b'')).decode('utf-8', 'replace')
    return True, clip_text('exit=%d\n%s' % (r.returncode, out), CLIP)


def get_registry():
    return registry
