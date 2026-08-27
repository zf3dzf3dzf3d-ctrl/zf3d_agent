#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""code_outline - 分析代码结构，提取函数/类/方法"""
import os
import re
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'code_outline'

# 语言 → 正则模式
_PATTERNS = {
    '.py': [
        (r'^(\s*)(class)\s+(\w+)', 'class'),
        (r'^(\s*)(def)\s+(\w+)', 'function'),
    ],
    '.js': [
        (r'^(\s*)(class)\s+(\w+)', 'class'),
        (r'^(\s*)(function)\s+(\w+)', 'function'),
        (r'^(\s*)(async\s+function)\s+(\w+)', 'function'),
        (r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(', 'function'),
        (r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?=>', 'function'),
    ],
    '.ts': [
        (r'^(\s*)(class)\s+(\w+)', 'class'),
        (r'^(\s*)(function)\s+(\w+)', 'function'),
        (r'^(\s*)(async\s+function)\s+(\w+)', 'function'),
        (r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(', 'function'),
        (r'^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?=>', 'function'),
        (r'^(\s*)(interface)\s+(\w+)', 'class'),
        (r'^(\s*)(enum)\s+(\w+)', 'class'),
    ],
    '.java': [
        (r'^(\s*)(class)\s+(\w+)', 'class'),
        (r'^(\s*)(interface)\s+(\w+)', 'class'),
        (r'^(\s*)(public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(', 'function'),
    ],
    '.go': [
        (r'^(\s*)(func)\s+(?:\(.*?\)\s+)?(\w+)', 'function'),
        (r'^(\s*)(type)\s+(\w+)\s+(?:struct|interface)', 'class'),
    ],
    '.c': [
        (r'^(\s*)(\w[\w\s\*]+)\s+(\w+)\s*\(', 'function'),
    ],
    '.cpp': [
        (r'^(\s*)(class)\s+(\w+)', 'class'),
        (r'^(\s*)(\w[\w\s\*<>:]+)\s+(\w+)\s*\(', 'function'),
    ],
}


def _outline_file(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    patterns = _PATTERNS.get(ext)
    if not patterns:
        return [], 'Unsupported file type: ' + ext

    outlines = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except Exception as e:
        return [], str(e)

    current_class = None
    for i, line in enumerate(lines, 1):
        for pat, kind in patterns:
            m = re.match(pat, line)
            if m:
                groups = m.groups()
                indent = len(groups[0]) if groups[0] else 0
                if kind == 'class':
                    name = groups[-1]
                    current_class = name if indent == 0 else current_class
                    outlines.append({
                        'type': 'class',
                        'name': name,
                        'line': i,
                        'indent': indent,
                        'parent': None
                    })
                else:
                    name = groups[-1]
                    parent = current_class if indent > 0 and current_class else None
                    out_type = 'method' if parent else 'function'
                    outlines.append({
                        'type': out_type,
                        'name': name,
                        'line': i,
                        'indent': indent,
                        'parent': parent
                    })
                break

    # Build formatted string
    fmt_lines = []
    for o in outlines:
        prefix = '  ' * (o['indent'] // 4)
        if o['type'] == 'class':
            fmt_lines.append('%s%s %s (L%d)' % (prefix, o['type'].title(), o['name'], o['line']))
        else:
            parent_str = (' @ ' + o['parent']) if o['parent'] else ''
            fmt_lines.append('%s%s %s%s (L%d)' % (prefix, o['type'], o['name'], parent_str, o['line']))

    return outlines, '\n'.join(fmt_lines) if fmt_lines else 'No structures found'


def handle(body, ctx):
    try:
        paths = body.get('paths')
        if not paths:
            p = body.get('path', '')
            if not p:
                ctx.send_error('path is required')
                return
            paths = [p]

        if len(paths) == 1:
            outlines, fmt = _outline_file(paths[0])
            if isinstance(fmt, str) and fmt.startswith('Unsupported'):
                ctx.send_json({'ok': False, 'error': fmt})
            else:
                ctx.send_json({'ok': True, 'outlines': outlines, 'formatted': fmt})
        else:
            results = []
            all_outlines = []
            for p in paths:
                outlines, fmt = _outline_file(p)
                results.append({'file': p, 'outlines': outlines, 'formatted': fmt})
                all_outlines.extend(outlines)
            ctx.send_json({'ok': True, 'outlines': all_outlines,
                           'files': results,
                           'formatted': '\n\n'.join(r['formatted'] for r in results)})
    except Exception as e:
        ctx.send_error(str(e))
