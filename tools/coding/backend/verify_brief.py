#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify_brief - 客观验证素材包：收集 git 改动前后对比 + 步骤日志 + 最近提交。

为「客观验证」按钮服务：新开对话验证时，把本素材包注入提示词，
让验证模型无需重新跑工具即可快速客观评价结果并定位 bug。

接收 body:
  { path?: 项目路径（默认 ctx.project_dir）, steps?: 收集最近N个步骤（默认3） }

返回:
  { ok, path, last_commit, diff_stat, diff_text, files, steps_log }
"""
import os
import json
import subprocess

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'verify_brief'

STEPS_FILE = os.path.join('private', 'agent_steps', 'steps.jsonl')

DIFF_MAX_CHARS = 20000   # diff 正文上限，超出截断
STAT_MAX_CHARS = 4000


def _git(path, args):
    r = subprocess.run('git ' + args, shell=True, capture_output=True, text=True,
                       cwd=path, creationflags=subprocess.CREATE_NO_WINDOW,
                       encoding='utf-8', errors='replace')
    return r


def handle(body, ctx):
    try:
        path = body.get('path', '') or ctx.project_dir
        if not path or not os.path.isdir(path):
            ctx.send_error('项目路径不存在: ' + str(path))
            return

        # 1. 最近提交
        r = _git(path, 'log -1 --pretty=format:%h %ad %s --date=format:"%Y-%m-%d %H:%M"')
        last_commit = r.stdout.strip() if r.returncode == 0 else ''

        # 2. diff 统计（与上一次提交对比；若无提交则对比空树）
        has_commit = _git(path, 'rev-parse HEAD').returncode == 0
        diff_stat = ''
        diff_text = ''
        files = []
        if has_commit:
            r = _git(path, 'diff HEAD --stat')
            diff_stat = (r.stdout or '').strip()[:STAT_MAX_CHARS]
            r2 = _git(path, 'diff HEAD -U2')
            diff_text = (r2.stdout or '').strip()
            r3 = _git(path, 'diff HEAD --name-status')
            files = [l.strip() for l in (r3.stdout or '').splitlines() if l.strip()]
        else:
            diff_stat = '（仓库还没有任何提交）'
        if len(diff_text) > DIFF_MAX_CHARS:
            diff_text = diff_text[:DIFF_MAX_CHARS] + '\n...（diff 过长已截断，可用工具按文件查看）'

        # 3. 步骤日志（最近 N 条）
        try:
            n_steps = int(body.get('steps', 3) or 3)
        except Exception:
            n_steps = 3
        steps_log = []
        p = os.path.join(path, STEPS_FILE)
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    lines = [l.strip() for l in f if l.strip()]
                for line in lines[-n_steps:]:
                    try:
                        steps_log.append(json.loads(line))
                    except Exception:
                        continue
            except Exception:
                pass

        ctx.send_json({
            'ok': True,
            'path': path,
            'last_commit': last_commit,
            'files': files,
            'diff_stat': diff_stat,
            'diff_text': diff_text,
            'steps_log': steps_log
        })
    except Exception as e:
        ctx.send_error(str(e))
