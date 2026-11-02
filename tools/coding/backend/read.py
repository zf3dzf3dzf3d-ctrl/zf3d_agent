#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""read - 读取文本文件"""
import os
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'read'


def _blocked(p):
    try:
        from security import is_blocked_system_path
        return is_blocked_system_path(p)
    except Exception:
        return False


def handle(body, ctx):
    max_chars = int(body.get('max_chars', 8000) or 8000)
    paths = body.get('paths')
    # 【2026-09-09 重复读拦截】前端透传的对话级已读计数（{path: count}）+ force 破格重读
    read_count = body.get('_read_count') or {}
    force = bool(body.get('force'))
    if not paths:
        p = body.get('path', '')
        paths = [p] if p else []

    if not paths:
        ctx.send_json({'ok': False, 'error': 'No path specified'})
        return

    if len(paths) == 1:
        p = paths[0]
        tried = [p]
        # 【2026-09-13 易用性修复】相对路径自动补根目录：先按原样试，
        # 失败则依次相对 project_dir（当前项目）、base_dir（软件根目录）重试，
        # 避免模型因一次相对路径失败就退回用 shell 读文件。
        def _cands(pp):
            out = []
            if os.path.isabs(pp):
                out.append(pp)
            else:
                out.append(os.path.join(ctx.project_dir, pp))
                if os.path.abspath(ctx.project_dir) != os.path.abspath(ctx.base_dir):
                    out.append(os.path.join(ctx.base_dir, pp))
            return out
        _hit = None
        for _c in _cands(str(p)):
            try:
                if _blocked(_c):
                    ctx.send_json({'ok': False, 'error': 'Blocked: system directory is not accessible (' + p + ')'})
                    return
                if os.path.isfile(_c):
                    _hit = _c
                    break
            except Exception:
                pass
        if _hit:
            p = _hit
        else:
            ctx.send_json({'ok': False,
                           'error': 'File not found: ' + str(p) +
                                    '（已尝试: ' + ' | '.join(_cands(str(p))) +
                                    '。相对路径会自动按项目根目录补全，请确认文件名/扩展名）'})
            return
        try:
            if _blocked(p):
                ctx.send_json({'ok': False, 'error': 'Blocked: system directory is not accessible (' + p + ')'})
                return
            if not os.path.isfile(p):
                ctx.send_json({'ok': False, 'error': 'File not found: ' + p})
                return
            # 重复读拦截：未变更且已读过 → 不回正文
            try:
                from tools.coding.backend import _readguard
                _serve, _note = _readguard.should_serve_content(p, read_count.get(p, 0), force)
                if not _serve:
                    ctx.send_json({'ok': True, 'path': p, 'cached': True, 'content': '', 'note': _note})
                    return
            except Exception:
                pass
            _enc_ok = False
            try:
                from tools.coding.backend import _encoding
                text, _enc = _encoding.read_text(p)
                _enc_ok = True
            except ImportError:
                pass
            if not _enc_ok:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    text = f.read()
            content = text[:max_chars + 1]
            truncated = len(content) > max_chars
            if truncated:
                content = content[:max_chars]
            size = os.path.getsize(p)
            # 【改必读】回读到内容 → 销账
            try:
                from tools.coding.backend import _mustread as _mr
                _mr.mark_read(p)
            except Exception:
                pass
            ctx.send_json({'ok': True, 'path': p, 'content': content,
                           'truncated': truncated,
                           'meta': {'size': size, 'encoding': _enc}})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    results = []
    # 【2026-09-13 易用性修复】多路径分支同样做相对路径自动补根目录
    def _cand2(pp):
        if os.path.isfile(pp):
            return pp
        if os.path.isabs(pp):
            return None
        for base in (ctx.project_dir, ctx.base_dir):
            c = os.path.join(base, pp)
            if os.path.isfile(c):
                return c
        return None
    for p in paths:
        try:
            rp = _cand2(p)
            if not rp:
                results.append({'path': p, 'error': 'File not found（相对路径已自动按项目根/软件根补全重试仍未命中）'})
                continue
            if _blocked(rp):
                results.append({'path': p, 'error': 'Blocked: system directory'})
                continue
            try:
                from tools.coding.backend import _readguard
                _serve, _note = _readguard.should_serve_content(rp, read_count.get(rp, 0), force)
                if not _serve:
                    results.append({'path': p, 'cached': True, 'lines': [], 'note': _note})
                    continue
            except Exception:
                pass
            _enc_ok = False
            try:
                from tools.coding.backend import _encoding
                text, _enc = _encoding.read_text(rp)
                _enc_ok = True
            except ImportError:
                pass
            if not _enc_ok:
                with open(rp, 'r', encoding='utf-8', errors='replace') as f:
                    text = f.read()
            content = text[:max_chars + 1]
            truncated = len(content) > max_chars
            if truncated:
                content = content[:max_chars]
            size = os.path.getsize(rp)
            # 【改必读】多文件分支同样要销账：本次真实回读了该文件内容
            try:
                from tools.coding.backend import _mustread as _mr
                _mr.mark_read(rp)
            except Exception:
                pass
            results.append({'path': p, 'content': content, 'truncated': truncated,
                            'meta': {'size': size, 'encoding': _enc}})
        except Exception as e:
            results.append({'path': p, 'error': str(e)})
    ctx.send_json({'ok': True, 'multi': True, 'files': results})
