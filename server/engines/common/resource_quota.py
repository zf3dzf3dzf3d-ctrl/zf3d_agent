#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/resource_quota.py - 智能体OS资源配额（P3：先计量后限流）

每窗口/每 crew 建立配额档案，统一计量+限流：
- 档案字段：{目标ID: {'daily_cap': int, 'used': int, 'day': 'YYYYMMDD',
                      'priority': 0-9, 'suspended': bool, 'reason': str}}
- charge(): 计量一次消耗；超过 daily_cap → 自动置 suspended 并发 alert 事件
- acquire()/release(): 并发槽（信号量按优先级插队）
- suspended() / unsuspend(): 超限挂起与人工解锁
- 存储：server/private/data/quota.json（原子写）；过期自动按日重置
- 降级开关：ZF_QUOTA=0 时 charge 只记账不挂起，acquire 永不阻塞
- 零第三方依赖，线程安全，绝不抛错
"""

import os
import io
import json
import time
import threading
import itertools

_ENABLED = os.environ.get('ZF_QUOTA', '1') != '0'
_DEFAULT_CAP = int(os.environ.get('ZF_QUOTA_DAILY_CAP', '200'))
_DEFAULT_PRIORITY = 5

_BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'private')
_STORE = os.path.join(_BASE, 'data', 'quota.json')

_LOCK = threading.RLock()
_seq = itertools.count()
_SLOTS = {}   # {目标ID: {'limit':N, 'held':N, 'queue':[ (prio, seq, Event) ]}}


def _today():
    return time.strftime('%Y%m%d')


def _load():
    try:
        with io.open(_STORE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data):
    try:
        os.makedirs(os.path.dirname(_STORE), exist_ok=True)
        tmp = _STORE + '.tmp.%d' % threading.get_ident()
        with io.open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _STORE)
    except Exception:
        pass


def _entry(data, target, cap=None, priority=None):
    e = data.get(target)
    today = _today()
    if not isinstance(e, dict) or e.get('day') != today:
        e = {'day': today, 'used': 0,
             'daily_cap': int(cap or (e or {}).get('daily_cap') or _DEFAULT_CAP),
             'priority': int(priority or (e or {}).get('priority') or _DEFAULT_PRIORITY),
             'suspended': False, 'reason': ''}
        data[target] = e
    return e


def configure(target, daily_cap=None, priority=None):
    """设置某目标的日上限/优先级（优先级 0 最高，9 最低）。"""
    with _LOCK:
        data = _load()
        e = _entry(data, target)
        if daily_cap is not None:
            e['daily_cap'] = int(daily_cap)
        if priority is not None:
            e['priority'] = max(0, min(9, int(priority)))
        _save(data)
        return dict(e)


def charge(target, amount=1, kind='token'):
    """计量一次消耗。超日限 → 挂起 + alert 事件。返回 {'ok','used','cap','suspended'}"""
    amount = max(0, int(amount))
    suspended_now = False
    with _LOCK:
        data = _load()
        e = _entry(data, target)
        e['used'] += amount
        if e['used'] > e['daily_cap'] and not e['suspended']:
            e['suspended'] = True
            e['reason'] = '日消耗 %d 超上限 %d，自动挂起' % (e['used'], e['daily_cap'])
            suspended_now = True
        _save(data)
        snap = {'ok': not e['suspended'], 'used': e['used'],
                'cap': e['daily_cap'], 'suspended': e['suspended'],
                'reason': e.get('reason', '')}
    if suspended_now:
        _emit('alert', {'target': target, 'msg': snap['reason']})
    return snap


def suspended(target):
    with _LOCK:
        e = _entry(_load(), target)
        return bool(e['suspended'])


def unsuspend(target):
    """人工解锁（重置当日已用与挂起态）。"""
    with _LOCK:
        data = _load()
        e = _entry(data, target)
        e['suspended'] = False
        e['used'] = 0
        e['reason'] = ''
        _save(data)
        return {'ok': True, 'target': target}


def acquire(target, limit=3, timeout=None):
    """并发槽：同目标最多 limit 个并发，按 priority 小者先。超时返回 False。"""
    with _LOCK:
        s = _SLOTS.setdefault(target, {'limit': int(limit), 'held': 0, 'queue': []})
        s['limit'] = max(int(limit), s['limit'])
        if s['held'] < s['limit'] and not s['queue']:
            s['held'] += 1
            return True
        ev = threading.Event()
        prio = _entry(_load(), target).get('priority', _DEFAULT_PRIORITY)
        import itertools
        s['queue'].append((prio, next(_seq), ev))
        s['queue'].sort(key=lambda x: (x[0], x[1]))
    ev.wait(timeout)
    with _LOCK:
        if ev.is_set():
            return True
        # 超时：把自己从队列里摘掉
        try:
            s['queue'].remove(next(q for q in s['queue'] if q[2] is ev))
        except Exception:
            pass
        return False


def release(target):
    """释放并发槽，唤醒队首（按优先级）。"""
    with _LOCK:
        s = _SLOTS.get(target)
        if not s:
            return
        s['held'] = max(0, s['held'] - 1)
        while s['queue'] and s['held'] < s['limit']:
            _, _, ev = s['queue'].pop(0)
            s['held'] += 1
            ev.set()


def _emit(event_type, payload):
    try:
        from engines.common.event_bus import publish
        publish(event_type, payload, source='quota')
    except Exception:
        pass


def enabled():
    return _ENABLED


def snapshot(target=None):
    """配额档案快照（诊断用）。"""
    with _LOCK:
        data = _load()
        if target:
            e = data.get(target)
            return dict(e) if isinstance(e, dict) else None
        return {k: dict(v) for k, v in data.items()}
