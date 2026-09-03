#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""timeline - 时间线浏览器：多维回溯查询入口。

聚合三个数据源，按时间排成一条时间线：
  1. steps.jsonl 账本（step / auto-checkpoint 记录，含 commit）
  2. 根目录快照 zip（snapshot_*.zip）
  3. git log 提交历史

支持：
  { action?: 'list'(默认) / 'detail' / 'rollback',
    step?: int       (rollback/detail: 账本步骤号)
    commit?: str     (rollback: 回滚到某提交，等价 undo_step)
    limit?: int      (list: 返回条数，默认 50)
    path?: str }

rollback 说明：
  - 按 step → 委托 undo_step（安全回退：stash/revert，绝不硬重置）
  - 按 commit → 直接调 undo_step 语义：revert 该提交
"""
import os
import json
import glob
import subprocess
import re

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'timeline'

STEPS_FILE = os.path.join('private', 'agent_steps', 'steps.jsonl')


def _git(path, cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, cwd=path)
    return r.returncode, (r.stdout or b'').decode('utf-8', 'replace').strip(), \
        (r.stderr or b'').decode('utf-8', 'replace').strip()


def _load_records(project_dir):
    p = os.path.join(project_dir, STEPS_FILE)
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


def _snapshots(project_dir):
    """根目录 snapshot_*.zip 列表（含大小与 mtime）。"""
    out = []
    for fp in glob.glob(os.path.join(project_dir, 'snapshot_*.zip')):
        try:
            st = os.stat(fp)
            out.append({
                'type': 'snapshot',
                'name': os.path.basename(fp),
                'time': st.st_mtime,
                'size_mb': round(st.st_size / 1048576.0, 1)
            })
        except Exception:
            pass
    return out


def _git_log(project_dir, limit=50):
    code, out, _ = _git(project_dir,
                        'git log --pretty=format:%%h|%%at|%%s -n %d' % limit)
    items = []
    if code == 0:
        for line in out.splitlines():
            parts = line.split('|', 2)
            if len(parts) == 3:
                try:
                    items.append({
                        'type': 'commit',
                        'commit': parts[0],
                        'time': float(parts[1]),
                        'message': parts[2][:120]
                    })
                except Exception:
                    pass
    return items


def _fmt(ts):
    try:
        import time as _t
        return _t.strftime('%Y-%m-%d %H:%M:%S', _t.localtime(float(ts)))
    except Exception:
        return str(ts)


def _timeline_list(project_dir, limit):
    limit = int(limit or 50)
    items = []
    for rec in _load_records(project_dir):
        items.append({
            'type': 'ledger-step',
            'step': rec.get('step'),
            'time': rec.get('time', ''),
            'time_str': rec.get('time', ''),
            'commit': rec.get('commit', ''),
            'message': rec.get('message', ''),
            'auto': bool(rec.get('auto')),
            'undone': bool(rec.get('undone'))
        })
    items.extend(_snapshots(project_dir))
    for c in _git_log(project_dir, limit):
        c['time_str'] = _fmt(c.pop('time'))
        items.append(c)
    # 快照 mtime 每次读取都会变化（如压缩/整理），若其 time_str 为空会导致签名抖动——统一补齐
    for it in items:
        if it.get('type') == 'snapshot' and not it.get('time_str'):
            it['time_str'] = _fmt(it.get('time', 0))
            it.pop('time', None)
    # 账本时间本身是字符串时间，快照/提交是秒级；统一按字符串排序近似即可（账本在最前）
    ledger = [i for i in items if i['type'] == 'ledger-step']
    others = sorted([i for i in items if i['type'] != 'ledger-step'],
                    key=lambda x: x.get('time_str', ''), reverse=True)[:limit]
    ledger = ledger[-limit:]
    return {'ok': True, 'ledger_count': len(ledger),
            'others_count': len(others), 'timeline': ledger + others,
            'hint': 'ledger 为账本记录（前段，按时间正序）；timeline 后段为快照+git 提交（按时间倒序）。'}


def _detail(project_dir, step_no):
    for rec in _load_records(project_dir):
        if rec.get('step') == step_no:
            detail = dict(rec)
            code, out, _ = _git(project_dir,
                                'git show --stat --oneline -1 %s' % rec.get('commit', ''))
            detail['show'] = out[:3000] if code == 0 else 'commit 不可见（可能已被撤销/清理）'
            return {'ok': True, 'detail': detail}
    return {'ok': False, 'error': '找不到步骤号 %s' % step_no}


def _rollback(body, ctx):
    """回滚：优先 step → 委托 undo_step；或 commit → revert。"""
    project_dir = body.get('path', '') or ctx.project_dir
    if body.get('step') is not None:
        import tools.coding.backend.undo_step as us
        # undo_step 只支持撤销"最后一个未撤销步骤"，指定 step 时也只
        # 处理最近一个；这里透传 step 参数，由 undo_step 自己定位。
        us.handle({'path': project_dir, 'step': body.get('step')}, ctx)
        return
    commit = body.get('commit')
    if not commit or not re.match(r'^[0-9a-fA-F]{7,40}$', commit):
        ctx.send_error('rollback 需要 step(int) 或 commit(哈希) 参数')
        return
    # 工作区脏先 stash 保护现场
    _git(project_dir, 'git stash -u')
    code, out, err = _git(project_dir, 'git revert --no-edit %s' % commit)
    ctx.send_json({'ok': code == 0, 'commit': commit,
                   'output': (out + '\n' + err).strip()[:2000]})


def handle(body, ctx):
    try:
        project_dir = body.get('path', '') or ctx.project_dir
        if not project_dir or not os.path.isdir(project_dir):
            ctx.send_error('项目路径不存在: ' + str(project_dir))
            return
        action = body.get('action', 'list')
        if action == 'list':
            ctx.send_json(_timeline_list(project_dir, body.get('limit', 50)))
        elif action == 'detail':
            if not isinstance(body.get('step'), int):
                ctx.send_error('detail 需要 step(int) 参数')
                return
            ctx.send_json(_detail(project_dir, body['step']))
        elif action == 'rollback':
            _rollback(body, ctx)
        else:
            ctx.send_error('未知 action: %s（支持 list/detail/rollback）' % action)
    except Exception as e:
        ctx.send_error(str(e))
