#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ram_cache - 纯内存键值缓存"""
import os, json, subprocess, time, threading
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'ram_cache'

# 全局缓存: {key: {value, expire_at}}
_cache = {}
_cache_lock = threading.Lock()


def _is_expired(entry):
    """检查缓存条目是否已过期"""
    expire_at = entry.get('expire_at', 0)
    if expire_at > 0 and time.time() > expire_at:
        return True
    return False


def handle(body, ctx):
    """处理内存缓存请求"""
    try:
        action = body.get('action', '')
        key = body.get('key', '')
        keys = body.get('keys', [])
        value = body.get('value', '')
        ttl = int(body.get('ttl', 0))

        if action == 'set':
            with _cache_lock:
                entry = {'value': value}
                if ttl > 0:
                    entry['expire_at'] = time.time() + ttl
                else:
                    entry['expire_at'] = 0
                _cache[key] = entry

            ctx.send_json({
                'ok': True,
                'key': key,
                'ttl': ttl
            })

        elif action == 'get':
            with _cache_lock:
                entry = _cache.get(key)
                if entry is None:
                    ctx.send_json({'ok': True, 'value': None, 'found': False})
                    return
                if _is_expired(entry):
                    del _cache[key]
                    ctx.send_json({'ok': True, 'value': None, 'found': False})
                    return
                ctx.send_json({'ok': True, 'value': entry['value'], 'found': True})

        elif action == 'delete':
            with _cache_lock:
                existed = key in _cache
                if existed:
                    del _cache[key]
            ctx.send_json({
                'ok': True,
                'deleted': existed,
                'key': key
            })

        elif action == 'clear':
            with _cache_lock:
                count = len(_cache)
                _cache.clear()
            ctx.send_json({
                'ok': True,
                'cleared': count
            })

        elif action == 'list':
            with _cache_lock:
                valid_keys = []
                expired_keys = []
                for k, entry in list(_cache.items()):
                    if _is_expired(entry):
                        expired_keys.append(k)
                    else:
                        valid_keys.append(k)
                for k in expired_keys:
                    del _cache[k]
            ctx.send_json({
                'ok': True,
                'keys': valid_keys
            })

        elif action == 'has':
            with _cache_lock:
                entry = _cache.get(key)
                if entry is None:
                    exists = False
                elif _is_expired(entry):
                    del _cache[key]
                    exists = False
                else:
                    exists = True
            ctx.send_json({
                'ok': True,
                'exists': exists,
                'key': key
            })

        else:
            ctx.send_error('未知操作: ' + str(action))

    except Exception as e:
        ctx.send_error(str(e))
