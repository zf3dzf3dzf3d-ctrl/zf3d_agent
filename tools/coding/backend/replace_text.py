#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""replace_text - Replace text in files with bounded automatic backups."""

from tools.coding.backend._backup import create_backup
from tools.coding.backend.base import ToolContext
from tools.coding.backend.write import _auto_checkpoint

TOOL_NAME = 'replace_text'


def _replace_in_file(path, old_text, new_text, replace_all, do_backup, project_dir=None):
    # 【2026-09-11 只提示不限制】越界不再拒绝，提示文案存入 _warn 附在结果里
    _warn = ''
    try:
        from tools.coding.backend._pathguard import guard_write_path
        ok, err = guard_write_path(path, project_dir)
        if not ok:
            return None, err, None, ''
        _warn = err
    except Exception:
        pass
    # 【2026-09-11 编码自愈】自动检测编码读入，写回用同一编码，杜绝 GBK 文件被 UTF-8 重写污染
    _enc = 'utf-8'
    try:
        from tools.coding.backend import _encoding
        content, _enc = _encoding.read_text(path)
    except ImportError:
        with open(path, 'r', encoding='utf-8', errors='replace') as file:
            content = file.read()
    except FileNotFoundError:
        return None, 'File not found: ' + path, None, ''
    except Exception as exc:
        return None, str(exc), None, ''

    count = content.count(old_text)
    if count == 0:
        return 0, None, None, ''
    if not replace_all and count > 1:
        return None, f'old_text matches {count} locations, set all=true to replace all', None, ''

    try:
        backup_path = create_backup(path) if do_backup else None
        new_content = content.replace(old_text, new_text) if replace_all else content.replace(old_text, new_text, 1)
        # 预检闸门：替换后语法不过拒写
        try:
            from tools.coding.backend import _preflight
            ok, err = _preflight.check_syntax(path, new_content)
            if not ok:
                return None, 'preflight rejected: ' + err, None, ''
        except Exception:
            pass
        with open(path, 'w', encoding=_enc) as file:
            file.write(new_content)
    except Exception as exc:
        return None, str(exc), None, ''
    return count if replace_all else 1, None, backup_path, ''


def handle(body, ctx):
    try:
        old_text = body.get('old_text', '')
        if not old_text:
            ctx.send_error('old_text is required')
            return
        paths = body.get('paths') or ([body.get('path', '')] if body.get('path') else [])
        if not paths:
            ctx.send_error('No path specified')
            return

        replace_all = bool(body.get('all', False))
        do_backup = bool(body.get('backup', True))
        results = []
        _proj_dir = getattr(ctx, 'project_dir', None) or ''
        _last_warns = {}
        for path in paths:
            replacements, error, backup_path, _warn = _replace_in_file(
                path, old_text, body.get('new_text', ''), replace_all, do_backup, _proj_dir
            )
            if _warn:
                _last_warns[path] = _warn
            result = {'path': path}
            if error:
                result['error'] = error
            else:
                result.update({
                    'replacements': replacements,
                    'backup': bool(backup_path),
                    'backup_path': backup_path,
                    **({'path_warning': _warn} if _warn else {}),
                })
            results.append(result)

        if len(results) == 1:
            ok_single = 'error' not in results[0]
        else:
            ok_single = True
        # 变更溯源记账（旁路，失败静默）
        try:
            from tools.coding.backend import _changelog
            for r in results:
                if r.get('path') and 'error' not in r:
                    _changelog.record_change(body.get('_chat_id', ''), 'replace_text', r['path'], r.get('backup_path') or '')
        except Exception:
            pass
        # 自动 checkpoint（旁路，失败静默）
        try:
            _auto_checkpoint(results)
        except Exception:
            pass
        if len(results) == 1:
            ctx.send_json({'ok': ok_single, **results[0]})
        else:
            ctx.send_json({'ok': True, 'multi': True, 'files': results})
    except Exception as exc:
        ctx.send_error(str(exc))
