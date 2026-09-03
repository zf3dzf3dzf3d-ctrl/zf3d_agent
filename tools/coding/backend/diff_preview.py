#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diff_preview - 查看git diff变更"""
import os, json, subprocess, time, shlex
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'diff_preview'


def handle(body, ctx):
    """处理diff预览请求：查看未提交的变更"""
    try:
        path = body.get('path', '') or ctx.project_dir
        staged = body.get('staged', False)
        file = body.get('file', '')
        files = body.get('files', None)
        max_lines = body.get('max_lines', 200)

        # 收集要过滤的文件
        target_files = []
        if file:
            target_files.append(file)
        if files:
            target_files.extend(files)

        # 构建 diff 命令
        cmd = 'git diff'
        if staged:
            cmd += ' --cached'
        if target_files:
            cmd += ' -- ' + ' '.join(shlex.quote(f) for f in target_files)

        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=path)

        if r.returncode != 0:
            ctx.send_error(r.stderr.strip() or 'git diff failed')
            return

        diff_output = r.stdout.strip()

        # 获取 diff --stat
        stats_cmd = 'git diff --stat'
        if staged:
            stats_cmd += ' --cached'
        if target_files:
            stats_cmd += ' -- ' + ' '.join(shlex.quote(f) for f in target_files)

        sr = subprocess.run(stats_cmd, shell=True, capture_output=True, text=True, cwd=path)
        stats = sr.stdout.strip()

        # 没有变更时返回简洁响应
        if not diff_output:
            ctx.send_json({'ok': True})
            return

        # 截断到 max_lines 行
        diff_lines = diff_output.split('\n')
        if len(diff_lines) > max_lines:
            diff_output = '\n'.join(diff_lines[:max_lines])
            diff_output += '\n... (truncated, ' + str(len(diff_lines) - max_lines) + ' more lines)'

        ctx.send_json({
            'ok': True,
            'diff': diff_output,
            'staged': staged,
            'file': file,
            'stats': stats
        })
    except Exception as e:
        ctx.send_error(str(e))
