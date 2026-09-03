#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""write - Write text files with bounded automatic backups."""

import os

from tools.coding.backend._backup import create_backup
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'write'


def _auto_checkpoint(results):
    """写操作成功后自动 git checkpoint（旁路，失败静默）。

    复用 git_save_step 的核心逻辑：add -A + commit + steps.jsonl 记账，
    消息带 auto 标记。nothing_to_commit 不写日志（避免每次空提交刷步骤号）。
    """
    try:
        ok_paths = [r['path'] for r in (results or []) if r.get('path') and 'error' not in r]
        if not ok_paths:
            return
        import subprocess
        import time as _time
        project_dir = None
        try:
            from config import BASE_DIR
            project_dir = BASE_DIR
        except Exception:
            from tools.coding.backend._changelog import BASE_DIR
            project_dir = BASE_DIR
        if not project_dir or not os.path.isdir(project_dir):
            return
        def _g(cmd):
            return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=project_dir)
        _g('git add -A')
        msg = '[auto-checkpoint] write %d file(s) @ %s' % (len(ok_paths), _time.strftime('%Y-%m-%d %H:%M:%S'))
        safe = msg.replace('"', '\\"')
        r = _g('git commit -m "%s"' % safe)
        combined = (r.stdout + r.stderr).lower()
        if 'nothing to commit' in combined or 'nothing added to commit' in combined:
            return  # 没有实际改动就不记账
        # 写步骤日志
        import json as _json
        from tools.coding.backend.git_save_step import _next_step, _steps_path
        step_no = _next_step(project_dir)
        hr = _g('git log -1 --pretty=format:%h')
        record = {
            'step': step_no,
            'message': msg,
            'commit': hr.stdout.strip(),
            'nothing_to_commit': False,
            'time': _time.strftime('%Y-%m-%d %H:%M:%S'),
            'auto': True
        }
        log_path = _steps_path(project_dir)
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(_json.dumps(record, ensure_ascii=False) + '\n')
    except Exception:
        pass


def _write_file(path, content):
    if not path:
        return {'path': path, 'error': 'No path specified'}
    try:
        from security import is_blocked_system_path
        if is_blocked_system_path(path):
            return {'path': path, 'error': 'Blocked: system directory is not writable'}
    except Exception:
        pass
    # 预检闸门：语法不过拒写
    try:
        from tools.coding.backend import _preflight
        ok, err = _preflight.check_syntax(path, content)
        if not ok:
            return {'path': path, 'error': 'preflight rejected: ' + err}
    except Exception:
        pass
    try:
        backup_path = create_backup(path) if os.path.isfile(path) else None
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as file:
            file.write(content)
        return {
            'path': path,
            'size': len(content.encode('utf-8')),
            'backup': bool(backup_path),
            'backup_path': backup_path,
        }
    except Exception as exc:
        return {'path': path, 'error': str(exc)}


def handle(body, ctx):
    files = body.get('files')
    if not files:
        files = [{'path': body.get('path', ''), 'content': body.get('content', '')}]

    results = [_write_file(item.get('path', ''), item.get('content', '')) for item in files]
    # 变更溯源记账（旁路，失败静默）+ 自动 checkpoint
    try:
        from tools.coding.backend import _changelog
        for r in results:
            if r.get('path') and 'error' not in r:
                _changelog.record_change(body.get('_chat_id', ''), 'write', r['path'], r.get('backup_path') or '')
        _auto_checkpoint(results)
    except Exception:
        pass
    if len(results) == 1:
        ctx.send_json({'ok': 'error' not in results[0], **results[0]})
    else:
        ctx.send_json({'ok': True, 'multi': True, 'files': results})
