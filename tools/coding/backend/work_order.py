#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""work_order - 工单清单管理"""

import os
import json
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'work_order'

CATEGORY = 'work_order'


def _get_wo_key(chat_id):
    """根据 chat_id 生成工单存储 key"""
    return f'wo_{chat_id}' if chat_id else 'wo_default'


def _load_work_order(conn, chat_id):
    """从数据库加载工单"""
    key = _get_wo_key(chat_id)
    row = conn.execute(
        'SELECT value FROM app_data WHERE category=? AND key=?',
        [CATEGORY, key]
    ).fetchone()
    if row:
        try:
            return json.loads(row['value'])
        except Exception:
            pass
    return None


def _save_work_order(conn, wo):
    """保存工单到数据库"""
    key = _get_wo_key(wo.get('chat_id', ''))
    now = int(time.time() * 1000)
    value = json.dumps(wo, ensure_ascii=False)
    row = conn.execute(
        'SELECT id FROM app_data WHERE category=? AND key=?',
        [CATEGORY, key]
    ).fetchone()
    if row:
        conn.execute(
            'UPDATE app_data SET value=?, updated_at=? WHERE category=? AND key=?',
            [value, now, CATEGORY, key]
        )
    else:
        conn.execute(
            'INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [CATEGORY, key, value, now, now]
        )


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'show')
        chat_id = body.get('_chat_id', '')

        if action == 'create':
            _do_create(body, ctx, chat_id)
        elif action == 'add':
            _do_add(body, ctx, chat_id)
        elif action == 'update':
            _do_update(body, ctx, chat_id)
        elif action == 'remove':
            _do_remove(body, ctx, chat_id)
        elif action == 'show':
            _do_show(ctx, chat_id)
        elif action == 'clear':
            _do_clear(ctx, chat_id)
        else:
            ctx.send_json({'ok': False, 'error': f'未知操作: {action}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})


def _do_create(body, ctx, chat_id):
    """创建工单"""
    title = body.get('title', '工单')
    now = int(time.time() * 1000)
    wo_id = 'wo_' + str(now)
    wo = {
        'id': wo_id,
        'title': title,
        'items': [],
        'chat_id': chat_id,
        'created_at': now,
        'updated_at': now
    }

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            _save_work_order(conn, wo)
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'work_order': wo})


def _do_add(body, ctx, chat_id):
    """向工单添加任务项"""
    item_type = body.get('item_type', 'custom')
    target = body.get('target', '')
    action_desc = body.get('action_desc', '')
    params = body.get('params', '')
    note = body.get('note', '')
    now = int(time.time() * 1000)

    item = {
        'id': now,
        'type': item_type,
        'target': target,
        'desc': action_desc,
        'params': params,
        'note': note,
        'status': 'pending'
    }

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            wo = _load_work_order(conn, chat_id)
            if not wo:
                # 没有工单则自动创建一个
                wo = {
                    'id': 'wo_' + str(now),
                    'title': '自动创建工单',
                    'items': [],
                    'chat_id': chat_id,
                    'created_at': now,
                    'updated_at': now
                }
            wo['items'].append(item)
            wo['updated_at'] = now
            _save_work_order(conn, wo)
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'item': item, 'work_order': wo})


def _do_update(body, ctx, chat_id):
    """修改任务项"""
    item_id = body.get('item_id')
    new_note = body.get('new_note')
    new_status = body.get('new_status')

    if item_id is None:
        ctx.send_json({'ok': False, 'error': '需要提供 item_id'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            wo = _load_work_order(conn, chat_id)
            if not wo:
                ctx.send_json({'ok': False, 'error': '工单不存在'})
                return

            found = False
            for item in wo.get('items', []):
                if str(item.get('id')) == str(item_id):
                    if new_note is not None:
                        item['note'] = new_note
                    if new_status is not None:
                        item['status'] = new_status
                    found = True
                    break

            if not found:
                ctx.send_json({'ok': False, 'error': f'未找到任务项 {item_id}'})
                return

            wo['updated_at'] = int(time.time() * 1000)
            _save_work_order(conn, wo)
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'work_order': wo})


def _do_remove(body, ctx, chat_id):
    """删除任务项"""
    item_id = body.get('item_id')

    if item_id is None:
        ctx.send_json({'ok': False, 'error': '需要提供 item_id'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            wo = _load_work_order(conn, chat_id)
            if not wo:
                ctx.send_json({'ok': False, 'error': '工单不存在'})
                return

            original_len = len(wo.get('items', []))
            wo['items'] = [item for item in wo.get('items', []) if str(item.get('id')) != str(item_id)]

            if len(wo['items']) == original_len:
                ctx.send_json({'ok': False, 'error': f'未找到任务项 {item_id}'})
                return

            wo['updated_at'] = int(time.time() * 1000)
            _save_work_order(conn, wo)
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'work_order': wo})


def _do_show(ctx, chat_id):
    """查看当前工单"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            wo = _load_work_order(conn, chat_id)
        finally:
            conn.close()

    if wo:
        ctx.send_json({'ok': True, 'work_order': wo})
    else:
        ctx.send_json({'ok': True, 'work_order': None, 'message': '当前无工单'})


def _do_clear(ctx, chat_id):
    """清空工单"""
    key = _get_wo_key(chat_id)
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            conn.execute(
                'DELETE FROM app_data WHERE category=? AND key=?',
                [CATEGORY, key]
            )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'message': '工单已清空'})
