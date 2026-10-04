#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""git_save - git add -A + commit + 可选push

【2026-09-22 改造】git 子进程调用全部改走 git_async：
- 强制超时（本地 30s / push 等网络操作 120s），不再无限阻塞；
- 整个流程包在子线程里执行（run_in_thread），push 卡网络时也不拖死 HTTP 线程；
- 写命令经进程级锁串行化，避免并发 index.lock 冲突。
"""
import os, json, time, shlex
from tools.coding.backend.base import ToolContext
from tools.coding.backend import git_async

TOOL_NAME = 'git_save'


def _repo_guard_error(path, project_dir):
    """项目根防线：以用户选择的项目根目录(project_dir)为边界。
    - 提交路径必须位于项目根之内；
    - 实际仓库根(toplevel)也必须位于项目根之内（等于项目根或其子目录），
      防止把外层/其他项目的仓库一起提交。
    异常时 fail-closed：拒绝提交。"""
    try:
        p = os.path.abspath(path).lower().rstrip('\\/')
        pd = os.path.abspath(project_dir or '').lower().rstrip('\\/')
        if not pd or not (p == pd or p.startswith(pd + '\\') or p.startswith(pd + '/')):
            return '拒绝提交：提交路径 %s 不在用户项目根目录 %s 之内。' % (path, project_dir)
        if not os.path.isdir(os.path.join(path, '.git')):
            r = git_async.run('git rev-parse --show-toplevel', cwd=path)
            top = (r.stdout or '').strip()
            if not top:
                return '目标目录不是 git 仓库，且找不到所属仓库根：%s' % path
        else:
            top = os.path.abspath(path)
        top_l = os.path.abspath(top).lower().rstrip('\\/')
        if not (top_l == pd or top_l.startswith(pd + '\\') or top_l.startswith(pd + '/')):
            return ('拒绝提交：实际仓库根 %s 在用户项目根目录 %s 之外'
                    '（可能是其他项目的仓库），为避免混提交已中止。' % (top, project_dir))
        return None
    except Exception as e:
        return '仓库防线校验异常，已拒绝提交（fail-closed）：%s' % e


def _do_save(path, message, push):
    """实际执行 add/commit/push/log/status，返回 (steps, nothing_to_commit, last_commit, status)。"""
    steps = []

    # 1. git add -A
    r = git_async.run('git add -A', cwd=path)
    steps.append({'step': 'git add -A', 'exit_code': r.returncode,
                  'stdout': r.stdout.strip(), 'stderr': r.stderr.strip()})

    # 2. git commit
    if not message:
        message = 'auto: git save @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
    commit_cmd = 'git commit -m ' + shlex.quote(message)
    r = git_async.run(commit_cmd, cwd=path)
    steps.append({'step': 'git commit', 'exit_code': r.returncode,
                  'stdout': r.stdout.strip(), 'stderr': r.stderr.strip()})

    nothing_to_commit = False
    combined = (r.stdout + r.stderr).lower()
    if r.returncode != 0 and ('nothing to commit' in combined or 'nothing added to commit' in combined):
        nothing_to_commit = True

    # 3. git push（可选，网络操作走长超时）
    if push and not nothing_to_commit:
        r = git_async.run('git push', cwd=path, net=True)
        steps.append({'step': 'git push', 'exit_code': r.returncode,
                      'stdout': r.stdout.strip(), 'stderr': r.stderr.strip()})

    # 4. git log
    r = git_async.run('git log -1 --oneline', cwd=path)
    last_commit = r.stdout.strip()
    steps.append({'step': 'git log -1 --oneline', 'exit_code': r.returncode,
                  'stdout': last_commit, 'stderr': r.stderr.strip()})

    # 5. git status --short
    r = git_async.run('git status --short', cwd=path)
    status = r.stdout.strip()
    steps.append({'step': 'git status --short', 'exit_code': r.returncode,
                  'stdout': status, 'stderr': r.stderr.strip()})

    return steps, nothing_to_commit, last_commit, status


def handle(body, ctx):
    """处理git保存请求：add -A + commit + 可选push（子线程执行，带超时）"""
    try:
        message = body.get('message', '')
        path = body.get('path', '') or ctx.project_dir
        push = body.get('push', False)

        guard = _repo_guard_error(path, ctx.project_dir)
        if guard:
            ctx.send_error(guard)
            return

        ok, result = git_async.run_in_thread(_do_save, args=(path, message, push))
        if not ok:
            ctx.send_json({'ok': False, 'error': result, 'timeout': True})
            return

        steps, nothing_to_commit, last_commit, status = result
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
