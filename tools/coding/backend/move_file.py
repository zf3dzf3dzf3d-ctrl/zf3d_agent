#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""move_file - 移动/重命名文件"""
import os
import shutil

TOOL_NAME = 'move_file'


def handle(body, ctx):
    try:
        moves = body.get('moves')
        if not moves:
            src = body.get('src', '')
            dst = body.get('dst', '')
            if not src or not dst:
                ctx.send_error('src and dst are required')
                return
            moves = [{'src': src, 'dst': dst}]

        overwrite = body.get('overwrite', False)
        results = []
        ok_count = 0

        for m in moves:
            src = m.get('src', '')
            dst = m.get('dst', '')
            try:
                try:
                    from security import is_blocked_system_path
                    if is_blocked_system_path(src, for_write=True) or is_blocked_system_path(dst, for_write=True):
                        results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Blocked: system directory'})
                        continue
                except Exception:
                    pass
                # 文件保护闸门：移动 = 源被删 + 目标被写，两侧都查
                try:
                    from tools.coding.backend import _file_protect as _fprot
                    _blocked = None
                    for _p in (src, dst):
                        ok, err = _fprot.check_write(_p)
                        if not ok:
                            _blocked = err
                            break
                    if _blocked:
                        results.append({'src': src, 'dst': dst, 'ok': False, 'error': _blocked})
                        continue
                    # 【2026-11-22 L0 写入端扩面】目标名卫生查（畸形文件名/根层提醒）
                    _ok3, _err3 = _fprot.hygiene_check(dst, None, is_new=not os.path.exists(dst))
                    if not _ok3:
                        results.append({'src': src, 'dst': dst, 'ok': False, 'error': _err3})
                        continue
                except Exception:
                    pass
                if not os.path.exists(src):
                    results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Source not found'})
                    continue
                if os.path.exists(dst) and not overwrite:
                    results.append({'src': src, 'dst': dst, 'ok': False, 'error': 'Destination exists (overwrite=False)'})
                    continue
                dst_dir = os.path.dirname(dst)
                if dst_dir and not os.path.isdir(dst_dir):
                    os.makedirs(dst_dir, exist_ok=True)
                shutil.move(src, dst)
                results.append({'src': src, 'dst': dst, 'ok': True})
                ok_count += 1
            except Exception as e:
                results.append({'src': src, 'dst': dst, 'ok': False, 'error': str(e)})

        # 【2026-11-22 账本补记】移动 = git 视角的 D(源)+新(目标)，两端都入 pending 账本，
        # 否则选择性快照（P1-1 Phase B）会漏掉移动产生的改动。旁路，失败静默。
        try:
            _ok_moves = [r for r in results if r.get('ok')]
            if _ok_moves:
                try:
                    from config import BASE_DIR as _BASE
                except Exception:
                    from tools.coding.backend._changelog import BASE_DIR as _BASE
                from tools.coding.backend.git_save_step import pending_append
                _rels = []
                for _r in _ok_moves:
                    for _p in (_r.get('src'), _r.get('dst')):
                        try:
                            _rels.append(os.path.relpath(_p, _BASE).replace(os.sep, '/'))
                        except Exception:
                            _rels.append(os.path.basename(_p))
                pending_append(_BASE, _rels, chat_id=str(body.get('_chat_id', '') or ''))
        except Exception:
            pass

        ctx.send_json({'ok': True, 'results': results, 'ok_count': ok_count, 'total': len(results)})
    except Exception as e:
        ctx.send_error(str(e))
