#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pixel_display - 像素显示器"""

import os
import json
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'pixel_display'

CATEGORY = 'pixel_display'
KEY_LATEST = 'latest'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'status')

        if action == 'show':
            _do_show(body, ctx)
        elif action == 'clear':
            _do_clear(ctx)
        elif action == 'status':
            _do_status(ctx)
        else:
            ctx.send_json({'ok': False, 'error': f'未知操作: {action}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})


def _do_show(body, ctx):
    """存储PXL数据到app_data，前端轮询读取显示"""
    title = body.get('title', '')
    data = body.get('data', '')
    fps = body.get('fps', 2)
    now = int(time.time() * 1000)

    if not data:
        ctx.send_json({'ok': False, 'error': '需要提供 data 参数'})
        return

    display_data = {
        'title': title,
        'data': data,
        'fps': fps,
        'updated_at': now
    }

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            # 检查是否已有记录
            row = conn.execute(
                'SELECT id FROM app_data WHERE category=? AND key=?',
                [CATEGORY, KEY_LATEST]
            ).fetchone()

            if row:
                conn.execute(
                    'UPDATE app_data SET value=?, updated_at=? WHERE category=? AND key=?',
                    [json.dumps(display_data, ensure_ascii=False), now, CATEGORY, KEY_LATEST]
                )
            else:
                conn.execute(
                    'INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                    [CATEGORY, KEY_LATEST, json.dumps(display_data, ensure_ascii=False), now, now]
                )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'message': '像素显示数据已更新', 'display': display_data})


def _do_clear(ctx):
    """删除app_data中的pixel_display记录"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            conn.execute(
                'DELETE FROM app_data WHERE category=? AND key=?',
                [CATEGORY, KEY_LATEST]
            )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'message': '像素显示器已清空'})


def _do_status(ctx):
    """返回当前状态"""
    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            row = conn.execute(
                'SELECT value, updated_at FROM app_data WHERE category=? AND key=?',
                [CATEGORY, KEY_LATEST]
            ).fetchone()
        finally:
            conn.close()

    if row:
        try:
            data = json.loads(row['value'])
        except Exception:
            data = {'raw': row['value']}
        ctx.send_json({'ok': True, 'active': True, 'display': data, 'updated_at': row['updated_at']})
    else:
        ctx.send_json({'ok': True, 'active': False, 'display': None})
