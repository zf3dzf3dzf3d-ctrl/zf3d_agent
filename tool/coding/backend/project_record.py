#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""project_record - 项目记录管理"""
import os
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'project_record'


def handle(body, ctx):
    action = body.get('action', 'list')
    name = body.get('name', '')
    content = body.get('content', '')
    keyword = body.get('keyword', '')

    records_dir = os.path.join(ctx.base_dir, '项目记录')
    if not os.path.isdir(records_dir):
        try:
            os.makedirs(records_dir, exist_ok=True)
        except Exception:
            pass

    def _safe_name(n):
        if not n:
            return ''
        n = n.strip()
        if not n.endswith('.md'):
            n += '.md'
        n = os.path.basename(n)
        return n

    if action == 'list':
        try:
            files = []
            if os.path.isdir(records_dir):
                for f in sorted(os.listdir(records_dir)):
                    if f.endswith('.md'):
                        files.append(f[:-3])
            ctx.send_json({'ok': True, 'records': files})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    if action == 'read':
        names = body.get('names')
        if names and isinstance(names, list):
            results = []
            for n in names:
                fn = _safe_name(n)
                fp = os.path.join(records_dir, fn)
                if os.path.isfile(fp):
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                            results.append({'name': fn[:-3], 'content': f.read()})
                    except Exception as e:
                        results.append({'name': fn[:-3], 'error': str(e)})
                else:
                    results.append({'name': fn[:-3], 'error': 'Not found'})
            ctx.send_json({'ok': True, 'multi': True, 'records': results})
            return
        fn = _safe_name(name)
        fp = os.path.join(records_dir, fn)
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': 'Record not found: ' + name})
            return
        try:
            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                c = f.read()
            ctx.send_json({'ok': True, 'name': fn[:-3], 'content': c})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    if action == 'write':
        fn = _safe_name(name)
        if not fn:
            ctx.send_json({'ok': False, 'error': 'No name specified'})
            return
        fp = os.path.join(records_dir, fn)
        try:
            with open(fp, 'w', encoding='utf-8') as f:
                f.write(content)
            ctx.send_json({'ok': True, 'name': fn[:-3], 'size': len(content.encode('utf-8'))})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    if action == 'append':
        fn = _safe_name(name)
        if not fn:
            ctx.send_json({'ok': False, 'error': 'No name specified'})
            return
        fp = os.path.join(records_dir, fn)
        try:
            with open(fp, 'a', encoding='utf-8') as f:
                f.write(content)
            ctx.send_json({'ok': True, 'name': fn[:-3]})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    if action == 'search':
        kw = keyword or body.get('keyword', '')
        if not kw:
            ctx.send_json({'ok': False, 'error': 'No keyword specified'})
            return
        results = []
        if os.path.isdir(records_dir):
            for f in sorted(os.listdir(records_dir)):
                if not f.endswith('.md'):
                    continue
                fp = os.path.join(records_dir, f)
                try:
                    with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                        if kw in fh.read():
                            results.append(f[:-3])
                except Exception:
                    pass
        ctx.send_json({'ok': True, 'keyword': kw, 'records': results})
        return

    if action == 'delete':
        fn = _safe_name(name)
        if not fn:
            ctx.send_json({'ok': False, 'error': 'No name specified'})
            return
        fp = os.path.join(records_dir, fn)
        try:
            if os.path.isfile(fp):
                os.remove(fp)
                ctx.send_json({'ok': True, 'name': fn[:-3]})
            else:
                ctx.send_json({'ok': False, 'error': 'Record not found: ' + name})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    ctx.send_json({'ok': False, 'error': 'Unknown action: ' + action})
