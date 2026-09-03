#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""git_save - git add -A + commit + 可选push"""
import os, json, subprocess, time, shlex
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'git_save'


def handle(body, ctx):
    """处理git保存请求：add -A + commit + 可选push"""
    try:
        message = body.get('message', '')
        path = body.get('path', '') or ctx.project_dir
        push = body.get('push', False)

        steps = []

        # 1. git add -A
        r = subprocess.run('git add -A', shell=True, capture_output=True, text=True, cwd=path)
        steps.append({
            'step': 'git add -A',
            'exit_code': r.returncode,
            'stdout': r.stdout.strip(),
            'stderr': r.stderr.strip()
        })

        # 2. git commit（无 message 时自动生成）
        if not message:
            message = 'auto: git save @ ' + time.strftime('%Y-%m-%d %H:%M:%S')

        commit_cmd = 'git commit -m ' + shlex.quote(message)
        r = subprocess.run(commit_cmd, shell=True, capture_output=True, text=True, cwd=path)
        steps.append({
            'step': 'git commit',
            'exit_code': r.returncode,
            'stdout': r.stdout.strip(),
            'stderr': r.stderr.strip()
        })

        nothing_to_commit = False
        combined = (r.stdout + r.stderr).lower()
        if r.returncode != 0 and ('nothing to commit' in combined or 'nothing added to commit' in combined):
            nothing_to_commit = True

        # 3. git push（可选，且没有 nothing_to_commit 时才 push）
        if push and not nothing_to_commit:
            r = subprocess.run('git push', shell=True, capture_output=True, text=True, cwd=path)
            steps.append({
                'step': 'git push',
                'exit_code': r.returncode,
                'stdout': r.stdout.strip(),
                'stderr': r.stderr.strip()
            })

        # 4. git log -1 --oneline（获取最近提交）
        r = subprocess.run('git log -1 --oneline', shell=True, capture_output=True, text=True, cwd=path)
        last_commit = r.stdout.strip()
        steps.append({
            'step': 'git log -1 --oneline',
            'exit_code': r.returncode,
            'stdout': last_commit,
            'stderr': r.stderr.strip()
        })

        # 5. git status --short（获取变更摘要）
        r = subprocess.run('git status --short', shell=True, capture_output=True, text=True, cwd=path)
        status = r.stdout.strip()
        steps.append({
            'step': 'git status --short',
            'exit_code': r.returncode,
            'stdout': status,
            'stderr': r.stderr.strip()
        })

        ctx.send_json({
            'ok': True,
            'message': message,
            'nothing_to_commit': nothing_to_commit,
            'last_commit': last_commit,
            'status': status,
            'steps': steps
        })
    except Exception as e:
        ctx.send_error(str(e))
