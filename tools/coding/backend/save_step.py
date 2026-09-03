#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""save_step - 保存本步：git add -A + commit + 追加步骤日志。

接收 body:
  { message?: str, path?: str, step_no?: int }
日志文件：private/step_log.md（隐私区，不入 git），按时间倒序追加一条记录：
  ## [step_no] 时间  提交哈希
  提交信息 + 变更摘要
"""
import os
import subprocess
import time
import shlex

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'save_step'


def _git(path, cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=path)
    return r.returncode, (r.stdout or '').strip(), (r.stderr or '').strip()


def handle(body, ctx):
    """保存本步：git提交 + 写入步骤日志"""
    try:
        path = body.get('path', '') or ctx.project_dir
        message = body.get('message', '')
        step_no = body.get('step_no', '')

        if not path or not os.path.isdir(path):
            ctx.send_error('项目路径不存在: ' + str(path))
            return

        steps = []

        # 1. git add -A
        code, out, err = _git(path, 'git add -A')
        steps.append({'step': 'git add -A', 'exit_code': code, 'stdout': out, 'stderr': err})

        # 2. git commit
        if not message:
            message = 'step: 保存本步 @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
        code, out, err = _git(path, 'git commit -m ' + shlex.quote(message))
        nothing_to_commit = False
        combined = (out + err).lower()
        if code != 0 and ('nothing to commit' in combined or 'nothing added to commit' in combined):
            nothing_to_commit = True
        steps.append({'step': 'git commit', 'exit_code': code, 'stdout': out, 'stderr': err})

        # 3. 取最近提交哈希 + 变更摘要
        _, last_commit, _ = _git(path, 'git log -1 --oneline')
        _, status, _ = _git(path, 'git status --short')

        # 4. 追加步骤日志 private/step_log.md（隐私区）
        log_path = os.path.join(path, 'private', 'step_log.md')
        try:
            stamp = time.strftime('%Y-%m-%d %H:%M:%S')
            entry = '\n## [{step}] {stamp}\n- 提交: {commit}\n- 信息: {msg}\n{status_part}\n'.format(
                step=step_no if step_no != '' else '-',
                stamp=stamp,
                commit=last_commit or '(无新提交)',
                msg=message,
                status_part=('- 变更:\n```\n' + status + '\n```') if status else '- 变更: (无)'
            )
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(entry)
            log_ok = True
        except Exception as log_exc:
            log_ok = False
            last_commit += ' | 日志写入失败: ' + str(log_exc)

        ctx.send_json({
            'ok': True,
            'message': message,
            'nothing_to_commit': nothing_to_commit,
            'last_commit': last_commit,
            'status': status,
            'log_path': log_path if log_ok else '',
            'steps': steps
        })
    except Exception as e:
        ctx.send_error(str(e))
