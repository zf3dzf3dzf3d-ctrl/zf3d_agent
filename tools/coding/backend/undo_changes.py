#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""undo_changes - 撤销本步任务的所有文件改动（依据前端账本记录）。

账本每条记录格式：
  {path, backup_path, op}
  op: 'write'（覆盖写/替换，backup_path 指向 .bak；新建文件 backup_path 为空 → 删除）
      'move'（src/dst 对调还原）
接收 body:
  { changes: [ {path, backup_path?, op, src?, dst?} ] }
返回每个文件的撤销结果清单。
"""
import os
import shutil

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'undo_changes'


def _undo_write(path, backup_path):
    """还原写入/替换：有备份→用备份覆盖回去；无备份→删除该新建文件。"""
    try:
        try:
            from security import is_blocked_system_path
            if is_blocked_system_path(path):
                return {'path': path, 'ok': False, 'error': 'Blocked: system directory'}
        except Exception:
            pass
        if backup_path and os.path.isfile(backup_path):
            shutil.copy2(backup_path, path)
            return {'path': path, 'ok': True, 'action': 'restored', 'from': backup_path}
        if os.path.isfile(path):
            os.remove(path)
            return {'path': path, 'ok': True, 'action': 'deleted_new_file'}
        return {'path': path, 'ok': True, 'action': 'already_absent'}
    except Exception as exc:
        return {'path': path, 'ok': False, 'error': str(exc)}


def _undo_move(src, dst):
    """还原移动：把 dst 移回 src。"""
    try:
        try:
            from security import is_blocked_system_path
            if is_blocked_system_path(src) or is_blocked_system_path(dst):
                return {'src': src, 'dst': dst, 'ok': False, 'error': 'Blocked: system directory'}
        except Exception:
            pass
        if not os.path.exists(dst):
            if os.path.exists(src):
                return {'src': src, 'dst': dst, 'ok': True, 'action': 'already_restored'}
            return {'src': src, 'dst': dst, 'ok': False, 'error': 'Moved file missing: ' + dst}
        src_dir = os.path.dirname(src)
        if src_dir and not os.path.isdir(src_dir):
            os.makedirs(src_dir, exist_ok=True)
        if os.path.exists(src):
            return {'src': src, 'dst': dst, 'ok': False, 'error': 'Original path already exists, cannot restore'}
        shutil.move(dst, src)
        return {'src': src, 'dst': dst, 'ok': True, 'action': 'moved_back'}
    except Exception as exc:
        return {'src': src, 'dst': dst, 'ok': False, 'error': str(exc)}


def handle(body, ctx):
    try:
        changes = body.get('changes') or []
        if not changes:
            ctx.send_json({'ok': False, 'error': 'No changes to undo'})
            return

        results = []
        ok_count = 0
        # 逆序撤销（后改的先撤），避免互相覆盖
        for item in reversed(changes):
            op = item.get('op', 'write')
            if op == 'move':
                r = _undo_move(item.get('src', ''), item.get('dst', ''))
            else:
                r = _undo_write(item.get('path', ''), item.get('backup_path', ''))
            if r.get('ok'):
                ok_count += 1
            results.append(r)

        ctx.send_json({
            'ok': True,
            'undone': ok_count,
            'total': len(results),
            'results': results,
            'formatted': '↩️ 撤销完成：{}/{} 成功\n'.format(ok_count, len(results)) + '\n'.join(
                ('  ✅ ' + (r.get('path') or (r.get('src', '') + ' ← ' + r.get('dst', ''))) + ('（' + r['action'] + '）' if r.get('action') else ''))
                if r.get('ok') else
                ('  ❌ ' + (r.get('path') or r.get('src', '')) + '：' + r.get('error', ''))
                for r in results
            )
        })
    except Exception as exc:
        ctx.send_error(str(exc))
