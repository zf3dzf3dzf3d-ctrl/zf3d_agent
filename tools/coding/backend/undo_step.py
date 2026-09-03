#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""undo_step - 撤销本步：根据 private/agent_steps/steps.jsonl 找到最后一个未撤销的步骤并安全回退。
安全策略：工作区脏 → 先 stash 保护；目标提交为 HEAD → reset --hard；后续已有新提交 → git revert 反向提交（绝不硬重置抹掉后续历史）。

接收 body:
  { path?: 项目路径（默认 ctx.project_dir）, step?: 要撤销的步骤号（默认最近一个） }
"""
import os
import json
import subprocess
import time

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'undo_step'

STEPS_FILE = os.path.join('private', 'agent_steps', 'steps.jsonl')


def _steps_path(project_dir):
    return os.path.join(project_dir, STEPS_FILE)


def _git(path, cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=path)
    return {
        'cmd': cmd,
        'exit_code': r.returncode,
        'stdout': r.stdout.strip(),
        'stderr': r.stderr.strip()
    }


def _load_records(project_dir):
    p = _steps_path(project_dir)
    records = []
    if os.path.isfile(p):
        try:
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        if isinstance(rec, dict):
                            records.append(rec)
                    except Exception:
                        continue
        except Exception:
            pass
    return records


def _save_records(project_dir, records):
    p = _steps_path(project_dir)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def handle(body, ctx):
    """撤销本步：回退到最后一个未撤销步骤的提交。"""
    try:
        path = body.get('path', '') or ctx.project_dir
        if not path or not os.path.isdir(path):
            ctx.send_error('项目路径不存在: ' + str(path))
            return

        records = _load_records(path)
        if not records:
            ctx.send_error('没有步骤日志可撤销（private/agent_steps/steps.jsonl 不存在或为空）')
            return

        # 找目标步骤：指定 step 号，或最后一个未撤销且非空提交的记录
        step_no = body.get('step')
        target = None
        target_idx = -1
        if isinstance(step_no, int):
            for i, rec in enumerate(records):
                if rec.get('step') == step_no:
                    target, target_idx = rec, i
                    break
            if target is None:
                ctx.send_error('找不到步骤号 %s' % step_no)
                return
        else:
            for i in range(len(records) - 1, -1, -1):
                rec = records[i]
                if rec.get('undone'):
                    continue
                if rec.get('nothing_to_commit'):
                    continue
                if not rec.get('commit'):
                    continue
                target, target_idx = rec, i
                break

        if target is None:
            ctx.send_error('没有可撤销的步骤（所有步骤已撤销或没有有效提交）')
            return

        commit = target['commit']
        # 确认该 commit 仍在当前分支历史里（中间可能被手动 reset 过）
        chk = _git(path, 'git merge-base --is-ancestor %s HEAD' % commit)
        if chk['exit_code'] != 0:
            target['undone'] = True
            target['undone_time'] = time.strftime('%Y-%m-%d %H:%M:%S')
            target['undone_note'] = 'commit 已不在当前分支历史，仅标记撤销'
            _save_records(path, records)
            ctx.send_error('该步骤的提交 %s 已不在当前分支历史中（可能被手动回退过），已标记为已撤销' % commit)
            return

        # 安全回退策略（不再无条件 reset --hard）：
        # 1) 工作区有未提交改动 → 先 stash 保护现场（含未跟踪文件）
        # 2) 目标提交是 HEAD → reset --hard 仅丢弃该步，不伤历史
        # 3) 目标提交不是 HEAD（后面已有新提交）→ git revert 生成反向提交，
        #    绝不硬重置抹掉后续提交
        results = []
        dirty = _git(path, 'git status --porcelain')
        if dirty['stdout']:
            results.append(_git(path, 'git stash push --include-untracked -m "undo_step-auto-stash-%s"' % commit))

        head_chk = _git(path, 'git log -1 --pretty=format:%h')
        head_now_hash = head_chk['stdout']
        full_head = _git(path, 'git rev-parse %s' % commit)
        is_head = full_head['exit_code'] == 0 and head_now_hash and head_now_hash == commit

        if is_head:
            results.append(_git(path, 'git reset --hard %s~1' % commit))
        else:
            rv = _git(path, 'git revert --no-edit %s' % commit)
            if rv['exit_code'] != 0:
                # revert 冲突（如后续提交改了同一位置）：中止本次 revert，
                # 保留冲突现场原状（--abort 恢复到 revert 前），如实报错，
                # 绝不留下冲突标记文件假装成功
                _git(path, 'git revert --abort')
                rv['stderr'] = (rv['stderr'] + '\n[undo_step] revert 发生冲突（后续提交与被撤销提交改动了同一文件），'
                                '已自动 abort，工作区恢复原状。请改用交互方式处理或先撤销后续步骤。').strip()
            results.append(rv)

        ok = results[-1]['exit_code'] == 0
        # 标记记录为已撤销（仅真正成功时标记；失败保留可重试）
        if ok:
            target['undone'] = True
            target['undone_time'] = time.strftime('%Y-%m-%d %H:%M:%S')
            target['undone_mode'] = 'reset' if is_head else 'revert'
        else:
            target['undone_failed_time'] = time.strftime('%Y-%m-%d %H:%M:%S')
        _save_records(path, records)

        # 取回退后的 HEAD
        r = subprocess.run('git log -1 --pretty=format:%h', shell=True,
                           capture_output=True, text=True, cwd=path)
        head = r.stdout.strip() if r.returncode == 0 else ''

        ctx.send_json({
            'ok': ok,
            'undone_step': target.get('step'),
            'undone_commit': commit,
            'undone_message': target.get('message', ''),
            'head_now': head,
            'steps': results,
            'output': (results[-1]['stdout'] + '\n' + results[-1]['stderr']).strip()
        })
    except Exception as e:
        ctx.send_error(str(e))
