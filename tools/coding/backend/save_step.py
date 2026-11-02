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
from tools.coding.backend import git_async
import time
import shlex

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'save_step'


def _git(path, cmd):
    r = git_async.run(cmd, cwd=path)
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
        # 项目根防线：以用户项目根目录为边界，异常时拒绝提交（fail-closed）
        try:
            from tools.coding.backend import git_async as _ga
            _pd = os.path.abspath(ctx.project_dir or '').lower().rstrip('\\/')
            _p = os.path.abspath(path).lower().rstrip('\\/')
            if not _pd or not (_p == _pd or _p.startswith(_pd + '\\') or _p.startswith(_pd + '/')):
                ctx.send_error('拒绝提交：提交路径 %s 不在用户项目根目录 %s 之内。' % (path, ctx.project_dir))
                return
            if not os.path.isdir(os.path.join(path, '.git')):
                r = _ga.run('git rev-parse --show-toplevel', cwd=path)
                _top = (r.stdout or '').strip()
                if not _top:
                    ctx.send_error('目标目录不是 git 仓库，且找不到所属仓库根：%s' % path)
                    return
            else:
                _top = os.path.abspath(path)
            _top_l = os.path.abspath(_top).lower().rstrip('\\/')
            if not (_top_l == _pd or _top_l.startswith(_pd + '\\') or _top_l.startswith(_pd + '/')):
                ctx.send_error('拒绝提交：实际仓库根 %s 在用户项目根目录 %s 之外（可能是其他项目的仓库），已中止。' % (_top, ctx.project_dir))
                return
        except Exception as _e:
            ctx.send_error('仓库防线校验异常，已拒绝提交（fail-closed）：%s' % _e)
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
