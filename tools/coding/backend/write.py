#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""write - Write text files with bounded automatic backups."""

import os

from tools.coding.backend._backup import create_backup
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'write'

# 本次请求的对话项目目录（handle 里注入，供 _write_file 白名单校验）
_CTX_PROJECT_DIR = {}


def _auto_checkpoint(results):
    """写操作成功后自动 git 暂存（旁路，失败静默）。

    【2026-09-10 延迟合并提交】执行期只 git add -A 暂存 + 把改动文件记入
    pending 清单，不再逐次 commit；本轮回答结束（self_check finish 终点
    快照）时一次性提交。一轮对话改 100 个文件也只产出 1 个 git 提交。
    """
    try:
        ok_paths = [r['path'] for r in (results or []) if r.get('path') and 'error' not in r]
        if not ok_paths:
            return
        import subprocess
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
            return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=project_dir, creationflags=subprocess.CREATE_NO_WINDOW)
        _g('git add -A')
        from tools.coding.backend.git_save_step import pending_append
        pending_append(project_dir, [os.path.basename(p) for p in ok_paths])
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
    # 【2026-09-09 路径白名单】写入必须落在软件发布版目录或对话关联项目目录内。
    # 事故：模型路径幻觉把半成品写到了 F:\朱峰后续社区…（发布版路径多打两个字），
    # 在 F 盘根误建整棵目录树。白名单从根上杜绝：目录都建不出来，文件更写不进去。
    _warn = ''
    try:
        from tools.coding.backend._pathguard import guard_write_path
        ok, err = guard_write_path(path, _CTX_PROJECT_DIR.get('dir'))
        if not ok:
            return {'path': path, 'error': err}
        _warn = err  # 越界时 err 现在是提示文案（不阻断）
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
            **({'path_warning': _warn} if _warn else {}),
        }
    except Exception as exc:
        return {'path': path, 'error': str(exc)}


def handle(body, ctx):
    # 注入对话项目目录供白名单校验（清旧值防串台）
    _CTX_PROJECT_DIR.clear()
    _CTX_PROJECT_DIR['dir'] = getattr(ctx, 'project_dir', None) or ''
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
