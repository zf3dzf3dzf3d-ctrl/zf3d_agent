#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""step_save - 保存本步：git add -A + commit（带步骤号）+ 写步骤日志。

接收 body:
  {
    path:    项目根目录（默认 ctx.project_dir）
    message: 本步说明（可选，默认自动生成）
  }
流程：
  1. git add -A
  2. git commit -m "step<N>: <message>"
  3. 取最近 commit hash
  4. 在项目根写 .ai_steps.jsonl，追加一行：
     {"step": N, "time": ..., "message": ..., "commit": hash}
     撤销时按 step 号用 git 回退到该步之前的提交。
"""
import os, json, subprocess, time, shlex

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'step_save'

STEPS_FILE = '.ai_steps.jsonl'


def _git(path, cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=path, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '').strip(), (r.stderr or '').strip()


def handle(body, ctx):
    try:
        path = body.get('path', '') or getattr(ctx, 'project_dir', '') or os.getcwd()
        message = (body.get('message', '') or '').strip()

        if not os.path.isdir(os.path.join(path, '.git')):
            ctx.send_error('目标目录不是 git 仓库（缺少 .git）：%s' % path)
            return

        steps = []

        # 0. 读现有步骤日志，算本步步号
        step_no = 1
        log_path = os.path.join(path, STEPS_FILE)
        if os.path.isfile(log_path):
            try:
                with open(log_path, 'r', encoding='utf-8') as f:
                    lines = [l for l in f.read().splitlines() if l.strip()]
                if lines:
                    step_no = json.loads(lines[-1]).get('step', 0) + 1
            except Exception:
                pass

        if not message:
            message = 'step %d @ %s' % (step_no, time.strftime('%Y-%m-%d %H:%M:%S'))

        # 1. git add -A
        code, out, err = _git(path, 'git add -A')
        steps.append({'step': 'git add -A', 'exit_code': code, 'stdout': out, 'stderr': err})

        # 2. git commit
        commit_msg = 'step%d: %s' % (step_no, message)
        code, out, err = _git(path, 'git commit -m ' + shlex.quote(commit_msg))
        combined = (out + err).lower()
        nothing = code != 0 and ('nothing to commit' in combined or 'nothing added to commit' in combined)
        steps.append({'step': 'git commit', 'exit_code': code, 'stdout': out, 'stderr': err})

        # 3. 最近 commit hash
        code, last_commit, err = _git(path, 'git log -1 --oneline')
        steps.append({'step': 'git log -1', 'exit_code': code, 'stdout': last_commit, 'stderr': err})
        commit_hash = last_commit.split(' ')[0] if last_commit else ''

        # 4. 追加步骤日志
        record = {
            'step': step_no,
            'time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'message': message,
            'commit': commit_hash,
            'commit_msg': commit_msg,
            'nothing_to_commit': nothing
        }
        try:
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(record, ensure_ascii=False) + '\n')
        except Exception as exc:
            steps.append({'step': 'write log', 'exit_code': 1, 'stderr': str(exc)})

        ctx.send_json({
            'ok': True,
            'step': step_no,
            'message': message,
            'commit': commit_hash,
            'nothing_to_commit': nothing,
            'log_file': STEPS_FILE,
            'steps': steps
        })
    except Exception as e:
        ctx.send_error(str(e))
