#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""replace_text - Replace text in files with bounded automatic backups."""

from tool.coding.backend._backup import create_backup
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'replace_text'


def _replace_in_file(path, old_text, new_text, replace_all, do_backup):
    try:
        with open(path, 'r', encoding='utf-8', errors='replace') as file:
            content = file.read()
    except FileNotFoundError:
        return None, 'File not found: ' + path, None
    except Exception as exc:
        return None, str(exc), None

    count = content.count(old_text)
    if count == 0:
        return 0, None, None
    if not replace_all and count > 1:
        return None, f'old_text matches {count} locations, set all=true to replace all', None

    try:
        backup_path = create_backup(path) if do_backup else None
        new_content = content.replace(old_text, new_text) if replace_all else content.replace(old_text, new_text, 1)
        with open(path, 'w', encoding='utf-8') as file:
            file.write(new_content)
    except Exception as exc:
        return None, str(exc), None
    return count if replace_all else 1, None, backup_path


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
        for path in paths:
            replacements, error, backup_path = _replace_in_file(
                path, old_text, body.get('new_text', ''), replace_all, do_backup
            )
            result = {'path': path}
            if error:
                result['error'] = error
            else:
                result.update({
                    'replacements': replacements,
                    'backup': bool(backup_path),
                    'backup_path': backup_path,
                })
            results.append(result)

        if len(results) == 1:
            ctx.send_json({'ok': 'error' not in results[0], **results[0]})
        else:
            ctx.send_json({'ok': True, 'multi': True, 'files': results})
    except Exception as exc:
        ctx.send_error(str(exc))
