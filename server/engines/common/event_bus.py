#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/event_bus.py - 智能体OS事件总线（P2：SysV → 现代内核）

JSONL journal 追加写作为事件日志，进程内游标消费，支持订阅回调。
- 事件四类：task.ready / file.lock_released / window.state / alert
- publish(): 追加一行到 server/private/logs/eventbus.journal.jsonl，
  并立即触发本进程内的订阅者（跨进程由消费方游标重放）
- drain(): 从上次游标起重放新事件并派发给订阅者；游标持久化
- 降级开关：ZF_EVENTBUS=0 时 publish 只落盘不触发，drain 为空操作
- 零第三方依赖，线程安全，绝不抛错（异常静默，不影响调用方）
"""

import os
import io
import json
import time
import threading

_ENABLED = os.environ.get('ZF_EVENTBUS', '1') != '0'

_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private')
_JOURNAL = os.path.join(_BASE, 'logs', 'eventbus.journal.jsonl')
_CURSOR = os.path.join(_BASE, 'data', 'eventbus.cursor.json')

_LOCK = threading.Lock()
_SUBS = {}          # {event_type: [callback(event_dict), ...]}
_VALID = ('task.ready', 'file.lock_released', 'window.state', 'alert', 'os.event')
_SEQ = 0            # 进程内序号，与 ts 组合成游标偏移（journal 行号）


def _load_cursor():
    try:
        with io.open(_CURSOR, 'r', encoding='utf-8') as f:
            return int(json.load(f).get('offset', 0))
    except Exception:
        return 0


def _save_cursor(off):
    try:
        os.makedirs(os.path.dirname(_CURSOR), exist_ok=True)
        tmp = _CURSOR + '.tmp'
        with io.open(tmp, 'w', encoding='utf-8') as f:
            f.write(json.dumps({'offset': int(off), 'ts': time.time()}))
        os.replace(tmp, _CURSOR)
    except Exception:
        pass


def subscribe(event_type, callback):
    """注册回调。callback(event:dict)；异常由总线吞掉。"""
    if not _ENABLED or not callable(callback):
        return
    with _LOCK:
        _SUBS.setdefault(event_type, []).append(callback)


def publish(event_type, payload=None, source=''):
    """发布事件：journal 落盘 + 触发本进程订阅者。返回是否落盘成功。"""
    if event_type not in _VALID:
        return False
    ev = {
        'ts': round(time.time(), 3),
        'type': event_type,
        'source': str(source or '')[:40],
        'payload': payload if isinstance(payload, dict) else {'raw': str(payload)[:200]},
    }
    try:
        os.makedirs(os.path.dirname(_JOURNAL), exist_ok=True)
        with _LOCK:
            with io.open(_JOURNAL, 'a', encoding='utf-8') as f:
                f.write(json.dumps(ev, ensure_ascii=False) + '\n')
    except Exception:
        return False
    if _ENABLED:
        _dispatch(ev)
    return True


def _dispatch(ev):
    for cb in list(_SUBS.get(ev['type'], [])) + list(_SUBS.get('*', [])):
        try:
            cb(ev)
        except Exception:
            pass


def drain(limit=200):
    """从持久化游标起重放 journal 新事件（跨进程消费），派发给订阅者。
    返回本次消费的事件数。"""
    if not _ENABLED:
        return 0
    try:
        off = _load_cursor()
        got = []
        try:
            with io.open(_JOURNAL, 'r', encoding='utf-8') as f:
                for i, line in enumerate(f):
                    if i < off:
                        continue
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        got.append(json.loads(line))
                    except Exception:
                        pass
                    if len(got) >= max(1, int(limit)):
                        break
        except FileNotFoundError:
            return 0
        for ev in got:
            _dispatch(ev)
        if got:
            _save_cursor(off + len(got))
        return len(got)
    except Exception:
        return 0


def replay(event_type=None, limit=100):
    """只读回看最近事件（不动游标），供诊断用。"""
    out = []
    try:
        with io.open(_JOURNAL, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                if event_type is None or ev.get('type') == event_type:
                    out.append(ev)
    except Exception:
        pass
    return out[-max(1, int(limit)):]


def enabled():
    return _ENABLED
