#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""table_memory - 通用表格记忆（长期数据记录）

领域无关的极简数据库工具。表名和字段全部由大模型按需创建/填写，
核心只做最简单的数据库操作（SQLite 单文件持久化）。
适合：每日打卡、运营数据记录、长期观察统计等跨对话持久化场景。
底层复用 server/memory_core.py 的 MemoryCore。
"""

import json
import os
import sys
import threading

TOOL_NAME = 'table_memory'

# memory_core.py 位于 server/ 目录
_SERVER_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'server'))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

_core = None
_core_lock = threading.Lock()


def _get_core():
    global _core
    with _core_lock:
        if _core is None:
            from memory_core import MemoryCore
            _core = MemoryCore()
        return _core


def handle(body, ctx):
    """处理表格记忆请求"""
    try:
        action = body.get('action', 'list')
        core = _get_core()

        if action == 'create_table':
            name = (body.get('table') or '').strip()
            if not name:
                ctx.send_json({'ok': False, 'error': '需要提供 table（表名）'})
                return
            core.create_table(name)
            ctx.send_json({'ok': True, 'table': name})

        elif action == 'list_tables':
            ctx.send_json({'ok': True, 'tables': core.list_tables()})

        elif action == 'drop_table':
            name = (body.get('table') or '').strip()
            if not name:
                ctx.send_json({'ok': False, 'error': '需要提供 table（表名）'})
                return
            core.drop_table(name)
            ctx.send_json({'ok': True, 'dropped': name})

        elif action == 'insert':
            name = (body.get('table') or '').strip()
            data = body.get('data')
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    ctx.send_json({'ok': False, 'error': 'data 不是合法 JSON'})
                    return
            if not name or not isinstance(data, dict) or not data:
                ctx.send_json({'ok': False, 'error': '需要提供 table（表名）和 data（字段对象）'})
                return
            result = core.insert(name, data)
            if isinstance(result, dict) and 'id' in result:
                row_id = result['id']
            else:
                row_id = result
            ctx.send_json({'ok': True, 'id': row_id, 'table': name})

        elif action == 'query':
            name = (body.get('table') or '').strip()
            if not name:
                ctx.send_json({'ok': False, 'error': '需要提供 table（表名）'})
                return
            where = body.get('where')
            if isinstance(where, str) and where.strip():
                try:
                    where = json.loads(where)
                except Exception:
                    ctx.send_json({'ok': False, 'error': 'where 不是合法 JSON'})
                    return
            rows = core.query(
                name,
                where=where if isinstance(where, dict) and where else None,
                order=(body.get('order') or '').strip() or None,
                limit=body.get('limit'),
            )
            ctx.send_json({'ok': True, 'rows': rows, 'count': len(rows)})

        elif action == 'get':
            name = (body.get('table') or '').strip()
            row_id = body.get('id')
            if not name or row_id is None:
                ctx.send_json({'ok': False, 'error': '需要提供 table 和 id'})
                return
            row = core.get(name, row_id)
            ctx.send_json({'ok': True, 'row': row, 'found': row is not None})

        elif action == 'update':
            name = (body.get('table') or '').strip()
            row_id = body.get('id')
            data = body.get('data')
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    ctx.send_json({'ok': False, 'error': 'data 不是合法 JSON'})
                    return
            if not name or row_id is None or not isinstance(data, dict) or not data:
                ctx.send_json({'ok': False, 'error': '需要提供 table、id 和 data'})
                return
            core.update(name, row_id, data)
            ctx.send_json({'ok': True, 'id': row_id})

        elif action == 'delete':
            name = (body.get('table') or '').strip()
            row_id = body.get('id')
            if not name or row_id is None:
                ctx.send_json({'ok': False, 'error': '需要提供 table 和 id'})
                return
            core.delete(name, row_id)
            ctx.send_json({'ok': True, 'deleted': row_id})

        elif action == 'stats':
            name = (body.get('table') or '').strip()
            field = (body.get('field') or '').strip()
            if not name or not field:
                ctx.send_json({'ok': False, 'error': '需要提供 table 和 field（数值字段名）'})
                return
            ctx.send_json({'ok': True, 'stats': core.stats(name, field)})

        elif action == 'batch':
            # 批量执行：operations 为数组，每项是完整的单次操作 {action, ...}
            ops = body.get('operations')
            if isinstance(ops, str):
                try:
                    ops = json.loads(ops)
                except Exception:
                    ops = None
            if not isinstance(ops, list) or not ops:
                ctx.send_json({'ok': False, 'error': '需要提供 operations（操作数组，每项含 action 及所需参数）'})
                return
            results = []
            for i, op in enumerate(ops):
                try:
                    if not isinstance(op, dict) or 'action' not in op:
                        raise ValueError('操作缺少 action 字段')
                    op = dict(op)
                    op_action = op.pop('action')
                    sub = _dispatch(core, op_action, op)
                    results.append({'index': i, 'ok': True, 'result': sub})
                except Exception as e:
                    results.append({'index': i, 'ok': False, 'error': str(e)})
            ok_count = sum(1 for r in results if r['ok'])
            ctx.send_json({'ok': ok_count == len(results), 'total': len(results), 'ok_count': ok_count, 'results': results})

        else:
            ctx.send_json({'ok': False, 'error': f'未知操作: {action}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})


def _dispatch(core, action, body):
    """执行单个操作，返回结果 dict（供 handle 和 batch 共用）。出错抛异常。"""
    if action == 'create_table':
        name = (body.get('table') or '').strip()
        if not name:
            raise ValueError('需要提供 table（表名）')
        core.create_table(name)
        return {'table': name}

    if action == 'list_tables':
        return {'tables': core.list_tables()}

    if action == 'drop_table':
        name = (body.get('table') or '').strip()
        if not name:
            raise ValueError('需要提供 table（表名）')
        core.drop_table(name)
        return {'dropped': name}

    if action == 'insert':
        name = (body.get('table') or '').strip()
        data = body.get('data')
        if isinstance(data, str):
            data = json.loads(data)
        if not name or not isinstance(data, dict) or not data:
            raise ValueError('需要提供 table 和 data')
        result = core.insert(name, data)
        row_id = result['id'] if isinstance(result, dict) and 'id' in result else result
        return {'id': row_id, 'table': name}

    if action == 'query':
        name = (body.get('table') or '').strip()
        if not name:
            raise ValueError('需要提供 table（表名）')
        where = body.get('where')
        if isinstance(where, str) and where.strip():
            try:
                where = json.loads(where)
            except Exception:
                raise ValueError('where 不是合法 JSON')
        rows = core.query(
            name,
            where=where if isinstance(where, dict) and where else None,
            order=(body.get('order') or '').strip() or None,
            limit=body.get('limit'),
        )
        return {'rows': rows, 'count': len(rows)}

    if action == 'get':
        name = (body.get('table') or '').strip()
        row_id = body.get('id')
        if not name or row_id is None:
            raise ValueError('需要提供 table 和 id')
        row = core.get(name, row_id)
        return {'row': row, 'found': row is not None}

    if action == 'update':
        name = (body.get('table') or '').strip()
        row_id = body.get('id')
        data = body.get('data')
        if isinstance(data, str):
            data = json.loads(data)
        if not name or row_id is None or not isinstance(data, dict) or not data:
            raise ValueError('需要提供 table、id 和 data')
        core.update(name, row_id, data)
        return {'id': row_id}

    if action == 'delete':
        name = (body.get('table') or '').strip()
        row_id = body.get('id')
        if not name or row_id is None:
            raise ValueError('需要提供 table 和 id')
        core.delete(name, row_id)
        return {'deleted': row_id}

    if action == 'stats':
        name = (body.get('table') or '').strip()
        field = (body.get('field') or '').strip()
        if not name or not field:
            raise ValueError('需要提供 table 和 field（数值字段名）')
        return {'stats': core.stats(name, field)}

    raise ValueError(f'未知操作: {action}')
