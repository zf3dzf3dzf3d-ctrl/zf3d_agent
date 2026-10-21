#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""git_save_step - 保存本步：git add -A + commit + 记录步骤日志。

为「撤销本步」提供依据：每次保存都会在项目 private/agent_steps/steps.jsonl 里追加一条
  {step, message, commit, time}
undo_step 工具根据 step 号找到对应 commit，执行 git revert/reset 完成零成本撤销。

接收 body:
  { path?: 项目路径（默认 ctx.project_dir）, message?: 提交说明, step?: 步骤号（不传自动递增） }
"""
import os
import json
import subprocess
from tools.coding.backend import git_async
import time
import shlex

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'git_save_step'

STEPS_DIR = os.path.join('private', 'agent_steps')
STEPS_FILE = 'steps.jsonl'


def _steps_path(project_dir):
    return os.path.join(project_dir, STEPS_DIR, STEPS_FILE)


def _next_step(project_dir):
    """读取步骤日志，返回下一个步骤号（从1开始）。"""
    p = _steps_path(project_dir)
    last = 0
    if os.path.isfile(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        if isinstance(rec, dict) and isinstance(rec.get('step'), int):
                            last = max(last, rec['step'])
                    except Exception:
                        continue
        except Exception:
            pass
    return last + 1


def _git(path, cmd):
    r = git_async.run(cmd, cwd=path)
    return {
        'step': cmd,
        'exit_code': r.returncode,
        'stdout': r.stdout.strip(),
        'stderr': r.stderr.strip()
    }


# ---------------------------------------------------------------------------
# 【2026-09-10 延迟合并提交】写工具执行期只暂存不提交，把本轮改动文件记入
# pending_changes.json；本轮回答结束（self_check finish 终点快照）时一次性
# commit。一轮对话改 100 个文件也只产出 1 个 git 提交。
# ---------------------------------------------------------------------------

PENDING_FILE = 'pending_changes.json'


def _pending_path(project_dir, chat_id=''):
    """pending 清单路径。

    【2026-09-20 并发隔离】按 chatId 分文件：pending_changes.<safeChatId>.json。
    多对话并发写同一项目时各记各的，互不吞并。chat_id 为空时退回旧的共享
    文件 pending_changes.json（兼容旧数据/旧调用方）。
    """
    safe = ''.join(c if c.isalnum() or c in '-_' else '_' for c in str(chat_id or ''))[:40]
    if safe:
        return os.path.join(project_dir, STEPS_DIR, 'pending_changes.%s.json' % safe)
    return os.path.join(project_dir, STEPS_DIR, PENDING_FILE)


def pending_append(project_dir, paths, chat_id=''):
    """追加本对话待提交文件名（去重保序）。失败静默。"""
    try:
        names = []
        p = _pending_path(project_dir, chat_id)
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    names = [n for n in json.load(f) if isinstance(n, str)]
            except Exception:
                names = []
        for n in paths:
            if n and n not in names:
                names.append(n)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(names, f, ensure_ascii=False, indent=0)
        if os.path.getsize(p) == 0 and names:
            raise RuntimeError('pending_append wrote empty, names=%r p=%r' % (names, p))
    except Exception as _e:
        try:
            with open(os.path.join(project_dir, STEPS_DIR, 'pending_error.log'), 'a', encoding='utf-8') as ef:
                ef.write('pending_append fail: %r\n' % _e)
        except Exception:
            pass


def pending_take(project_dir, chat_id=''):
    """取走并清空本对话的 pending 清单，返回文件名列表。

    【2026-09-20 并发隔离】优先取 chatId 专属文件；若为空再尝试旧共享
    文件 pending_changes.json（服务升级时残留的旧轮次清单，避免丢账）。
    """
    names = []
    p = _pending_path(project_dir, chat_id)
    if os.path.isfile(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                names = [n for n in json.load(f) if isinstance(n, str)]
        except Exception:
            names = []
        try:
            os.remove(p)
        except Exception:
            pass
    if not names and chat_id:
        # 兼容：升级前旧共享清单里可能存着上一轮的账
        legacy = os.path.join(project_dir, STEPS_DIR, PENDING_FILE)
        if os.path.isfile(legacy):
            try:
                with open(legacy, 'r', encoding='utf-8') as f:
                    names = [n for n in json.load(f) if isinstance(n, str)]
            except Exception:
                names = []
            try:
                os.remove(legacy)
            except Exception:
                pass
    return names


def handle(body, ctx):
    """处理保存本步请求：git add -A + commit + 写步骤日志。"""
    try:
        path = body.get('path', '') or ctx.project_dir
        message = body.get('message', '')

        # 项目根防线：以用户项目根目录为边界，异常时拒绝提交（fail-closed）
        try:
            import sys as _sys
            _pd = os.path.abspath(ctx.project_dir or '').lower().rstrip('\\/')
            _p = os.path.abspath(path).lower().rstrip('\\/')
            if not _pd or not (_p == _pd or _p.startswith(_pd + '\\') or _p.startswith(_pd + '/')):
                ctx.send_error('拒绝提交：提交路径 %s 不在用户项目根目录 %s 之内。' % (path, ctx.project_dir))
                return
            if not os.path.isdir(os.path.join(path, '.git')):
                r = git_async.run('git rev-parse --show-toplevel', cwd=path)
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

        if not path or not os.path.isdir(path):
            ctx.send_error('项目路径不存在: ' + str(path))
            return

        steps = []
        # 1. git add -A
        steps.append(_git(path, 'git add -A'))

        # 2. commit
        if not message:
            message = 'step save @ ' + time.strftime('%Y-%m-%d %H:%M:%S')
        step_no = body.get('step')
        if not isinstance(step_no, int):
            step_no = _next_step(path)
        commit_message = '[step %d] %s' % (step_no, message)

        safe_msg = commit_message.replace('"', '\\"')
        steps.append(_git(path, 'git commit -m "%s"' % safe_msg))

        # 【2026-09-20 并发隔离】记录本步骤所属对话 chatId，撤销时按对话过滤
        chat_id = str(body.get('chatId') or '')

        combined = (steps[-1]['stdout'] + steps[-1]['stderr']).lower()
        nothing_to_commit = steps[-1]['exit_code'] != 0 and (
            'nothing to commit' in combined or 'nothing added to commit' in combined)

        # 3. 取最近提交 hash（无论是否 nothing_to_commit 都取当前 HEAD）
        r = git_async.run('git log -1 --pretty=format:%h', cwd=path)
        commit_hash = r.stdout.strip()
        if r.returncode != 0:
            commit_hash = ''

        # 4. 写步骤日志（nothing_to_commit 也记录，避免步骤号跳号）
        log_path = _steps_path(path)
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        record = {
            'step': step_no,
            'message': message,
            'commit': commit_hash,
            'nothing_to_commit': nothing_to_commit,
            'chatId': chat_id,
            'time': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

        ctx.send_json({
            'ok': True,
            'step': step_no,
            'message': commit_message,
            'commit': commit_hash,
            'nothing_to_commit': nothing_to_commit,
            'log_file': log_path,
            'steps': steps
        })
    except Exception as e:
        ctx.send_error(str(e))
