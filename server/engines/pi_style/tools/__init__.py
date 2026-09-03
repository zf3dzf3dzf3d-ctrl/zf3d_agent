#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pi_style/tools - pi agent 引擎专属工具集（物理隔离，自研实现）

设计哲学（源自 pi 精髓，非照搬）：
1. 流水线式：每个工具结果都经过「瘦身管道」（clip + 结构化头部），token 可预测
2. 工具少而精：只有 5 个，schema 扁平，模型一眼看懂
3. 返回带 meta 头：第一行永远是 `OK|ERR <meta>`，方便流水线上下游判断
"""

import os
import subprocess

from engines.common.tool_base import Registry, resolve_path, clip_text

registry = Registry('pi_style')

CLIP = 4000
RUN_TIMEOUT = 20


def _ok(meta, body):
    return True, 'OK %s\n%s' % (meta, body)


def _err(meta, body=''):
    return False, 'ERR %s\n%s' % (meta, body)


@registry.register(
    'pi_read',
    'Read file, clipped to pipeline budget. First line is OK/ERR meta header.',
    {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']},
)
def pi_read(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return _err('not_found path=%r' % args.get('path'))
    try:
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            data = f.read()
    except OSError as e:
        return _err('io_error %s' % e)
    lines = data.count('\n') + 1
    return _ok('path=%s bytes=%d lines=%d' % (args.get('path'), len(data), lines),
               clip_text(data, CLIP, '…[pipeline clip: read_lines for ranges]'))


@registry.register(
    'pi_read_lines',
    'Read a line range (cheap pass for the pipeline).',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'}, 'start': {'type': 'integer'}, 'end': {'type': 'integer'}},
        'required': ['path']},
)
def pi_read_lines(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full or not os.path.isfile(full):
        return _err('not_found path=%r' % args.get('path'))
    start = max(1, int(args.get('start') or 1))
    end = int(args.get('end') or start + 200)
    with open(full, 'r', encoding='utf-8', errors='replace') as f:
        lines = f.readlines()
    seg = ''.join(lines[start - 1:end])
    return _ok('lines=%d-%d/%d' % (start, min(end, len(lines)), len(lines)), seg or '(empty range)')


@registry.register(
    'pi_files',
    'List files under a directory. Parameter: path ("." for project root).',
    {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': []},
)
def pi_files(args, ctx):
    base = resolve_path(args.get('path') or '.', ctx.get('project_path'))
    if not base or not os.path.isdir(base):
        return _err('not_found dir=%r' % args.get('path'))
    try:
        entries = sorted(os.listdir(base))
    except OSError as e:
        return _err('io_error %s' % e)
    lines = [('dir  ' + e) if os.path.isdir(os.path.join(base, e)) else ('file ' + e)
             for e in entries[:200]]
    return _ok('dir=%s entries=%d' % (base, len(entries)), '\n'.join(lines))


@registry.register(
    'pi_write',
    'Write file directly (pi trusts the model; result is a structured receipt, backup .bak).',
    {'type': 'object', 'properties': {
        'path': {'type': 'string'}, 'content': {'type': 'string'}}, 'required': ['path', 'content']},
)
def pi_write(args, ctx):
    full = resolve_path(args.get('path'), ctx.get('project_path'))
    if not full:
        return _err('path_not_allowed %r' % args.get('path'))
    existed = os.path.isfile(full)
    if existed:
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            old = f.read()
        with open(full + '.bak', 'w', encoding='utf-8') as f:
            f.write(old)
    os.makedirs(os.path.dirname(full) or '.', exist_ok=True)
    content = args.get('content', '')
    with open(full, 'w', encoding='utf-8') as f:
        f.write(content)
    return _ok('wrote path=%s bytes=%d replaced=%s' % (args.get('path'), len(content), existed), '')


@registry.register(
    'pi_grep',
    'Search a keyword in project files, returns matched lines with file:line. Pipeline-friendly.',
    {'type': 'object', 'properties': {
        'keyword': {'type': 'string'}, 'glob': {'type': 'string'}}, 'required': ['keyword']},
)
def pi_grep(args, ctx):
    import glob as _glob
    base = ctx.get('project_path') or '.'
    kw = args.get('keyword', '')
    if not kw:
        return _err('empty keyword')
    pattern = args.get('glob') or '**/*.*'
    hits = []
    try:
        files = _glob.glob(os.path.join(base, pattern), recursive=True)
    except Exception:
        files = []
    for fp in files[:600]:
        if not os.path.isfile(fp):
            continue
        if os.path.basename(fp).startswith('.') or '__pycache__' in fp or 'node_modules' in fp:
            continue
        try:
            if os.path.getsize(fp) > 800 * 1024:
                continue
            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                for i, ln in enumerate(f, 1):
                    if kw in ln:
                        hits.append('%s:%d: %s' % (os.path.relpath(fp, base), i, ln.rstrip()[:200]))
                        if len(hits) >= 80:
                            break
        except OSError:
            continue
        if len(hits) >= 80:
            break
    if not hits:
        return _err('no_hits kw=%r' % kw)
    return _ok('hits=%d' % len(hits), '\n'.join(hits))


@registry.register(
    'pi_run',
    'Run shell command with pipeline timeout; output passes through the clip budget.',
    {'type': 'object', 'properties': {'code': {'type': 'string'}}, 'required': ['code']},
    dangerous=True,
)
def pi_run(args, ctx):
    import subprocess
    try:
        r = subprocess.run(args.get('code', ''), shell=True, capture_output=True,
                           timeout=RUN_TIMEOUT, cwd=ctx.get('project_path') or '.')
    except subprocess.TimeoutExpired:
        return _err('timeout %ds' % RUN_TIMEOUT)
    out = ((r.stdout or b'') + (r.stderr or b'')).decode('utf-8', 'replace')
    return _ok('exit=%d' % r.returncode, clip_text(out, CLIP, '…[pipeline clip]'))


def get_registry():
    return registry
