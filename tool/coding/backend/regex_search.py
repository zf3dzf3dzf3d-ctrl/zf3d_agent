#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""regex_search - 正则搜索文件内容"""
import os
import re
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'regex_search'

_SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv'}
_TEXT_EXTS = {'.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.hpp',
              '.go', '.rs', '.rb', '.php', '.css', '.scss', '.html', '.htm', '.xml',
              '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.md', '.txt', '.sh',
              '.bat', '.ps1', '.sql', '.vue', '.svelte'}


def _regex_search_file(filepath, pattern, case_insensitive, context_lines, show_groups, max_results):
    matches = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except Exception:
        return matches

    for i, line in enumerate(lines):
        if len(matches) >= max_results:
            break
        m = pattern.search(line)
        if m:
            ctx_start = max(0, i - context_lines)
            ctx_end = min(len(lines), i + context_lines + 1)
            entry = {
                'line': i + 1,
                'match': m.group(0).rstrip('\n\r'),
                'context': [l.rstrip('\n\r') for l in lines[ctx_start:ctx_end]]
            }
            if show_groups and m.groups():
                entry['groups'] = list(m.groups())
            matches.append(entry)
    return matches


def handle(body, ctx):
    try:
        pattern_str = body.get('pattern', '')
        if not pattern_str:
            ctx.send_error('pattern is required')
            return

        paths = body.get('paths')
        if not paths:
            p = body.get('path', '')
            paths = [p] if p else []
        if not paths:
            ctx.send_error('No path specified')
            return

        case_insensitive = body.get('case_insensitive', False)
        max_results = int(body.get('max_results', 50))
        context_lines = int(body.get('context_lines', 2))
        show_groups = body.get('show_groups', True)
        file_type = body.get('file_type', None)

        flags = re.IGNORECASE if case_insensitive else 0
        try:
            pattern = re.compile(pattern_str, flags)
        except re.error as e:
            ctx.send_error('Invalid regex: ' + str(e))
            return

        all_results = []
        total_matches = 0

        for search_path in paths:
            if total_matches >= max_results:
                break
            if os.path.isfile(search_path):
                if file_type and not search_path.endswith(file_type):
                    continue
                matches = _regex_search_file(search_path, pattern, case_insensitive, context_lines, show_groups, max_results - total_matches)
                if matches:
                    all_results.append({'file': search_path, 'matches': matches})
                    total_matches += len(matches)
            elif os.path.isdir(search_path):
                for dirpath, dirnames, filenames in os.walk(search_path):
                    dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith('.')]
                    for fn in sorted(filenames):
                        if total_matches >= max_results:
                            break
                        if file_type and not fn.endswith(file_type):
                            continue
                        if not file_type:
                            ext = os.path.splitext(fn)[1].lower()
                            if ext not in _TEXT_EXTS:
                                continue
                        fp = os.path.join(dirpath, fn)
                        matches = _regex_search_file(fp, pattern, case_insensitive, context_lines, show_groups, max_results - total_matches)
                        if matches:
                            all_results.append({'file': fp, 'matches': matches})
                            total_matches += len(matches)

        ctx.send_json({'ok': True, 'results': all_results, 'total_matches': total_matches})
    except Exception as e:
        ctx.send_error(str(e))
