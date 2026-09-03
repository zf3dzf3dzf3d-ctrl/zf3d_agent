#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""search_in_files - 在文件内容中搜索关键词"""
import os
import re
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'search_in_files'

_SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv'}
_TEXT_EXTS = {'.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.hpp',
              '.go', '.rs', '.rb', '.php', '.css', '.scss', '.html', '.htm', '.xml',
              '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.md', '.txt', '.sh',
              '.bat', '.ps1', '.sql', '.vue', '.svelte'}


def _search_file(filepath, keyword, is_regex, case_insensitive, context_lines, max_results):
    matches = []
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
    except Exception:
        return matches

    if is_regex:
        flags = re.IGNORECASE if case_insensitive else 0
        try:
            pattern = re.compile(keyword, flags)
        except re.error:
            return matches
        for i, line in enumerate(lines):
            if len(matches) >= max_results:
                break
            if pattern.search(line):
                ctx_start = max(0, i - context_lines)
                ctx_end = min(len(lines), i + context_lines + 1)
                matches.append({
                    'line': i + 1,
                    'content': line.rstrip('\n\r'),
                    'context': [l.rstrip('\n\r') for l in lines[ctx_start:ctx_end]]
                })
    else:
        search_kw = keyword.lower() if case_insensitive else keyword
        for i, line in enumerate(lines):
            if len(matches) >= max_results:
                break
            check = line.lower() if case_insensitive else line
            if search_kw in check:
                ctx_start = max(0, i - context_lines)
                ctx_end = min(len(lines), i + context_lines + 1)
                matches.append({
                    'line': i + 1,
                    'content': line.rstrip('\n\r'),
                    'context': [l.rstrip('\n\r') for l in lines[ctx_start:ctx_end]]
                })
    return matches


def handle(body, ctx):
    try:
        keyword = body.get('keyword', '')
        if not keyword:
            ctx.send_error('keyword is required')
            return

        paths = body.get('paths')
        if not paths:
            # 空 path 降级为项目根目录，避免空参数 400 打断 Agent 循环
            p = body.get('path', '') or ctx.project_dir
            paths = [p] if p else []
        if not paths:
            ctx.send_error('No path specified')
            return

        is_regex = body.get('regex', False)
        case_insensitive = body.get('case_insensitive', False)
        max_results = int(body.get('max_results', 30))
        context_lines = int(body.get('context_lines', 1))
        file_type = body.get('file_type', None)

        all_results = []
        files_searched = 0
        total_matches = 0

        for search_path in paths:
            if os.path.isfile(search_path):
                if file_type and not search_path.endswith(file_type):
                    continue
                files_searched += 1
                matches = _search_file(search_path, keyword, is_regex, case_insensitive, context_lines, max_results - total_matches)
                if matches:
                    all_results.append({'file': search_path, 'matches': matches})
                    total_matches += len(matches)
                    if total_matches >= max_results:
                        break
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
                        files_searched += 1
                        matches = _search_file(fp, keyword, is_regex, case_insensitive, context_lines, max_results - total_matches)
                        if matches:
                            all_results.append({'file': fp, 'matches': matches})
                            total_matches += len(matches)

        ctx.send_json({'ok': True, 'results': all_results, 'total_matches': total_matches, 'files_searched': files_searched})
    except Exception as e:
        ctx.send_error(str(e))
