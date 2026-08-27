#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""git_log - 查看git提交历史"""
import os, json, subprocess, time, shlex
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'git_log'


def handle(body, ctx):
    """处理git log请求：查看提交历史"""
    try:
        path = body.get('path', '') or ctx.project_dir
        count = body.get('count', 20)
        author = body.get('author', '')
        oneline = body.get('oneline', True)
        file = body.get('file', '')
        files = body.get('files', None)

        # 构建命令
        cmd = 'git log -' + str(count)
        if oneline:
            cmd += ' --oneline'
        else:
            cmd += ' --format=%h|%an|%ad|%s --date=short'
        if author:
            cmd += ' --author=' + shlex.quote(author)

        # 文件过滤
        target_files = []
        if file:
            target_files.append(file)
        if files:
            target_files.extend(files)
        if target_files:
            cmd += ' -- ' + ' '.join(shlex.quote(f) for f in target_files)

        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=path)

        commits = []
        formatted_lines = []

        if r.returncode == 0 and r.stdout.strip():
            for line in r.stdout.strip().split('\n'):
                line = line.strip()
                if not line:
                    continue
                if oneline:
                    # --oneline 格式: "abc1234 commit message"
                    parts = line.split(' ', 1)
                    commits.append({
                        'hash': parts[0],
                        'author': '',
                        'date': '',
                        'message': parts[1] if len(parts) > 1 else ''
                    })
                    formatted_lines.append(line)
                else:
                    # 自定义格式: "hash|author|date|message"
                    parts = line.split('|', 3)
                    if len(parts) >= 4:
                        commits.append({
                            'hash': parts[0],
                            'author': parts[1],
                            'date': parts[2],
                            'message': parts[3]
                        })
                        formatted_lines.append(
                            parts[0] + ' | ' + parts[1] + ' | ' + parts[2] + ' | ' + parts[3]
                        )

        formatted = '\n'.join(formatted_lines)

        ctx.send_json({
            'ok': True,
            'commits': commits,
            'formatted': formatted
        })
    except Exception as e:
        ctx.send_error(str(e))
