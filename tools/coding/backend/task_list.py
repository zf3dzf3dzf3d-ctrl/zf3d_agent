#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
task_list - 任务清单工具
迁移自 handler_tools_tasks.py（TaskListMixin），改为 handle(body, ctx) 接口。
"""

import json
import time

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'task_list'


def _normalize_task_list(task_list):
    if not isinstance(task_list, dict):
        return None
    tasks = task_list.get('tasks')
    if not isinstance(tasks, list):
        return None
    normalized_tasks = []
    for index, task in enumerate(tasks, 1):
        if not isinstance(task, dict):
            continue
        item = dict(task)
        item.setdefault('id', index)
        item.setdefault('title', '')
        item.setdefault('status', 'pending')
        if item.get('status') not in ('pending', 'in_progress', 'completed', 'skipped'):
            item['status'] = 'pending'
        normalized_tasks.append(item)
    normalized = dict(task_list)
    normalized['tasks'] = normalized_tasks
    normalized.setdefault('id', '')
    normalized.setdefault('title', '未命名任务清单')
    return normalized


def handle(body, ctx):
    action = body.get('action', 'show')
    tl_id = body.get('id', '')
    # chat_id 缺失时降级到 'default' 命名空间，避免 400 打断 Agent 循环
    chat_id = str(body.get('chat_id') or body.get('_chat_id') or '').strip() or 'default'

    def _belongs_to_chat(task_list):
        return str(task_list.get('chat_id')) == chat_id

    # update/add 未传 id 时：自动定位当前对话最新的清单
    if not tl_id and action in ('update', 'add'):
        try:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT key, value FROM app_data WHERE category=? ORDER BY updated_at DESC',
                        ('task_list',))
            row = None
            for candidate in cur.fetchall():
                try:
                    candidate_list = _normalize_task_list(json.loads(candidate['value']))
                    if candidate_list and _belongs_to_chat(candidate_list):
                        row = candidate
                        break
                except Exception:
                    continue
            conn.close()
            if row:
                tl_id = row['key']
        except Exception:
            tl_id = ''

    # ===== create =====
    if action == 'create':
        title = body.get('title', '')
        tasks = body.get('tasks', [])
        if not title:
            ctx.send_error('缺少 title 参数')
            return
        if not isinstance(tasks, list):
            ctx.send_error('tasks 必须是数组')
            return
        normalized_tasks = []
        for i, task in enumerate(tasks, 1):
            if isinstance(task, str):
                task = {'title': task}
            if not isinstance(task, dict):
                continue
            normalized_tasks.append({
                'id': task.get('id', i),
                'title': str(task.get('title', '')),
                'status': task.get('status', 'pending'),
                'detail': str(task.get('detail', '')),
            })
        tl_id = 'tl_' + str(int(time.time() * 1000))
        task_list = {'id': tl_id, 'title': title, 'tasks': normalized_tasks, 'chat_id': chat_id}
        # 任务开始前自动快照（旁路，失败静默，10 分钟节流）
        snapshot_info = ''
        try:
            from tools.coding.backend import _snapshot
            took, info = _snapshot.auto_snapshot('task_list create: ' + title)
            if took:
                snapshot_info = '；开工快照 ' + info
        except Exception:
            pass
        with ctx.db_lock:
            conn = ctx.get_db()
            conn.execute('INSERT OR REPLACE INTO app_data (category, key, value) VALUES (?, ?, ?)',
                         ('task_list', tl_id, json.dumps(task_list, ensure_ascii=False)))
            conn.commit()
            conn.close()
        ctx.send_json({
            'ok': True, 'tool': 'task_list', 'action': 'create',
            'id': tl_id, 'list': task_list,
            'message': '已创建任务清单：' + title + snapshot_info
        })
        return

    # ===== show =====
    if action == 'show':
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            if tl_id:
                cur.execute('SELECT value FROM app_data WHERE category=? AND key=?',
                            ('task_list', tl_id))
                row = cur.fetchone()
                if row:
                    tl_data = _normalize_task_list(json.loads(row['value']))
                    if tl_data and _belongs_to_chat(tl_data):
                        lists = [tl_data]
                    else:
                        lists = []
                else:
                    lists = []
            else:
                cur.execute('SELECT value FROM app_data WHERE category=? ORDER BY updated_at DESC',
                            ('task_list',))
                rows = cur.fetchall()
                lists = []
                for row in rows:
                    try:
                        task_list = _normalize_task_list(json.loads(row['value']))
                    except Exception:
                        continue
                    # 任务清单以自身 chat_id 作为归属依据。画布节点可能尚未
                    # 持久化或使用不同的存储生命周期，不应阻断任务面板读取。
                    if not task_list or not _belongs_to_chat(task_list):
                        continue
                    lists.append(task_list)
            conn.close()

        status_icons = {'pending': '☐', 'in_progress': '⟳️', 'completed': '✅', 'skipped': '⏭️'}
        if not lists:
            msg = '📋 暂无任务清单'
        elif tl_id:
            tl = lists[0]
            total = len(tl['tasks'])
            completed = sum(1 for t in tl['tasks'] if t['status'] == 'completed')
            skipped = sum(1 for t in tl['tasks'] if t['status'] == 'skipped')
            in_progress = sum(1 for t in tl['tasks'] if t['status'] == 'in_progress')
            pending = total - completed - skipped - in_progress
            task_lines = []
            for t in tl['tasks']:
                icon = status_icons.get(t['status'], '☐')
                line = '  ' + str(t['id']) + '. ' + icon + ' ' + t['title']
                if t.get('detail'):
                    line += ' -> ' + t['detail']
                task_lines.append(line)
            progress_pct = int(completed / total * 100) if total > 0 else 0
            msg = '📋 任务清单「' + tl['title'] + '」\n'
            msg += ('进度: ' + str(completed) + '/' + str(total) + ' 完成 (' + str(progress_pct)
                    + '%) | ⏭️' + str(skipped) + ' 跳过 | ⟳️' + str(in_progress)
                    + ' 进行中 | ☐' + str(pending) + ' 待处理\n')
            msg += '\n'.join(task_lines)
        else:
            lines = []
            for tl in lists:
                total = len(tl['tasks'])
                completed = sum(1 for t in tl['tasks'] if t['status'] == 'completed')
                pct = int(completed / total * 100) if total > 0 else 0
                lines.append('  - [' + tl['id'] + '] ' + tl['title'] + ' ('
                             + str(completed) + '/' + str(total) + ' ' + str(pct) + '%)')
            msg = '📋 共 ' + str(len(lists)) + ' 个任务清单:\n' + '\n'.join(lines)
        ctx.send_json({'ok': True, 'tool': 'task_list', 'action': 'show',
                        'lists': lists, 'message': msg})
        return

    # ===== update =====
    if action == 'update':
        task_id = body.get('task_id')
        status = body.get('status', '')
        detail = body.get('detail', '')
        if not tl_id:
            ctx.send_error('缺少 id 参数')
            return
        if task_id is None:
            ctx.send_error('缺少 task_id 参数')
            return
        if status not in ('pending', 'in_progress', 'completed', 'skipped'):
            ctx.send_error('无效 status')
            return
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT value FROM app_data WHERE category=? AND key=?',
                        ('task_list', tl_id))
            row = cur.fetchone()
            if not row:
                conn.close()
                ctx.send_error('任务清单 ' + tl_id + ' 不存在')
                return
            tl_data = _normalize_task_list(json.loads(row['value']))
            if not tl_data or not _belongs_to_chat(tl_data):
                conn.close()
                ctx.send_error('任务清单不属于当前对话')
                return
            found = False
            task_title = ''
            for t in tl_data['tasks']:
                if t['id'] == task_id:
                    t['status'] = status
                    if detail:
                        t['detail'] = detail
                    found = True
                    task_title = t['title']
                    break
            if not found:
                conn.close()
                ctx.send_error('任务 ' + str(task_id) + ' 不存在')
                return
            conn.execute('UPDATE app_data SET value=?, updated_at=CURRENT_TIMESTAMP '
                         'WHERE category=? AND key=?',
                         (json.dumps(tl_data, ensure_ascii=False), 'task_list', tl_id))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'tool': 'task_list', 'action': 'update', 'id': tl_id,
                         'task_id': task_id, 'status': status,
                         'message': '任务已更新：' + task_title})
        return

    # ===== add =====
    if action == 'add':
        title = body.get('title', '')
        detail = body.get('detail', '')
        status = body.get('status', 'pending')
        if not tl_id:
            ctx.send_error('缺少 id 参数')
            return
        if not title:
            ctx.send_error('缺少 title 参数')
            return
        if status not in ('pending', 'in_progress', 'completed', 'skipped'):
            ctx.send_error('无效 status')
            return
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            cur.execute('SELECT value FROM app_data WHERE category=? AND key=?',
                        ('task_list', tl_id))
            row = cur.fetchone()
            if not row:
                conn.close()
                ctx.send_error('任务清单 ' + tl_id + ' 不存在')
                return
            tl_data = _normalize_task_list(json.loads(row['value']))
            if not tl_data or not _belongs_to_chat(tl_data):
                conn.close()
                ctx.send_error('任务清单不属于当前对话')
                return
            new_id = max([t['id'] for t in tl_data['tasks']] or [0]) + 1
            tl_data['tasks'].append({'id': new_id, 'title': title, 'status': status, 'detail': detail})
            conn.execute('UPDATE app_data SET value=?, updated_at=CURRENT_TIMESTAMP '
                         'WHERE category=? AND key=?',
                         (json.dumps(tl_data, ensure_ascii=False), 'task_list', tl_id))
            conn.commit()
            conn.close()
        ctx.send_json({'ok': True, 'tool': 'task_list', 'action': 'add', 'id': tl_id,
                         'task_id': new_id, 'message': '已添加任务：' + title})
        return

    # ===== delete =====
    if action == 'delete':
        with ctx.db_lock:
            conn = ctx.get_db()
            cur = conn.cursor()
            if tl_id:
                cur.execute('SELECT value FROM app_data WHERE category=? AND key=?',
                            ('task_list', tl_id))
                row = cur.fetchone()
                if not row:
                    conn.close()
                    ctx.send_error('任务清单 ' + str(tl_id) + ' 不存在')
                    return
                try:
                    task_list = _normalize_task_list(json.loads(row['value']))
                except Exception:
                    task_list = None
                if not task_list or not _belongs_to_chat(task_list):
                    conn.close()
                    ctx.send_error('任务清单不属于当前对话')
                    return
                cur.execute('DELETE FROM app_data WHERE category=? AND key=?',
                            ('task_list', tl_id))
                deleted = cur.rowcount
            else:
                cur.execute('SELECT key, value FROM app_data WHERE category=?',
                            ('task_list',))
                keys = []
                for row in cur.fetchall():
                    try:
                        task_list = _normalize_task_list(json.loads(row['value']))
                    except Exception:
                        task_list = None
                    if task_list and _belongs_to_chat(task_list):
                        keys.append(row['key'])
                for key in keys:
                    cur.execute('DELETE FROM app_data WHERE category=? AND key=?',
                                ('task_list', key))
                deleted = len(keys)
            conn.commit()
            conn.close()
        response = {'ok': True, 'tool': 'task_list', 'action': 'delete',
                    'deleted': deleted,
                    'message': '已删除 ' + str(deleted) + ' 个任务清单'}
        if tl_id:
            response['id'] = tl_id
        ctx.send_json(response)
        return

    ctx.send_error('未知 action: ' + str(action))
