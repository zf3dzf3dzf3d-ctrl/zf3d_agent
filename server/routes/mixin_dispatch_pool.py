# -*- coding: utf-8 -*-
"""Mixin: 派单池（命令行侧直接派小弟，lp 目标链协议 v1.0 任务包）。

设计：
  - 我（命令行智能体）通过 POST /api/dispatch/pool {action:'submit'} 提交任务包
  - 浏览器端 app-dispatch-pool.js 轮询领单（claim），自动创建小弟对话派活
  - 小弟干完后前端回写回执（receipt），命令行侧用 status 查看/验收

任务包字段（目标链统一协议 v1.0）：
  goal / accept(验收标准) / deliverable / constraints / timeout_sec

存储：private/dispatch_pool.json，读写带锁，崩溃不丢单。
"""
import os
import json
import time
import uuid
import threading

from routes._shared import *  # noqa: F401,F403
from routes.mixin_base import MixinBase

_POOL_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'dispatch_pool.json'
)
_POOL_LOCK = threading.Lock()
_MAX_TASKS = 200      # 池上限，防膨胀
_MAX_DONE_AGE = 86400 * 3  # 已完结任务保留 3 天


def _load():
    if not os.path.exists(_POOL_PATH):
        return {'tasks': []}
    try:
        with open(_POOL_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        if not isinstance(d, dict) or not isinstance(d.get('tasks'), list):
            return {'tasks': []}
        return d
    except Exception:
        return {'tasks': []}


def _save(d):
    os.makedirs(os.path.dirname(_POOL_PATH), exist_ok=True)
    tmp = _POOL_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _POOL_PATH)


def _gc(d):
    """清理超龄已完结任务"""
    now = time.time()
    before = len(d['tasks'])
    d['tasks'] = [t for t in d['tasks']
                  if t.get('status') not in ('done', 'failed', 'cancelled')
                  or now - t.get('ended_at', now) < _MAX_DONE_AGE]
    return before - len(d['tasks'])


class MixinDispatchPool(MixinBase):
    """派单池路由（POST /api/dispatch/pool）"""

    def _handle_dispatch_pool(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        action = body.get('action', 'status')

        with _POOL_LOCK:
            d = _load()
            _gc(d)
            tasks = d['tasks']

            if action == 'submit':
                goal = str(body.get('goal') or '').strip()
                accept = str(body.get('accept') or '').strip()
                if not goal:
                    self._send_json({'ok': False, 'error': 'goal 不能为空'}, 400)
                    return
                if len(tasks) >= _MAX_TASKS:
                    self._send_json({'ok': False, 'error': '派单池已满（%d）' % _MAX_TASKS}, 429)
                    return
                task = {
                    'id': 'dp-' + uuid.uuid4().hex[:10],
                    'goal': goal,
                    'accept': accept or '小弟自述完成且给出产出',
                    'deliverable': str(body.get('deliverable') or '文字结论'),
                    'constraints': str(body.get('constraints') or ''),
                    'priority': int(body.get('priority') or 0),
                    'parent_chat_id': str(body.get('parent_chat_id') or ''),
                    'timeout_sec': int(body.get('timeout_sec') or 900),
                    'status': 'pending',      # pending/running/done/failed/timeout
                    'created_at': time.time(),
                    'claimed_at': None,
                    'claimed_by': None,
                    'ended_at': None,
                    'receipt': None,         # 小弟回执
                }
                tasks.append(task)
                tasks.sort(key=lambda t: -t['priority'])
                _save(d)
                self._send_json({'ok': True, 'id': task['id'],
                                'message': '任务已入池，等待浏览器端小弟领取'}, 200)
                return

            if action == 'claim':
                # 前端领单：取最高优先级的 pending 单
                task = next((t for t in tasks if t['status'] == 'pending'), None)
                if not task:
                    self._send_json({'ok': True, 'task': None}, 200)
                    return
                task['status'] = 'running'
                task['claimed_at'] = time.time()
                task['claimed_by'] = str(body.get('worker') or 'browser-worker')
                _save(d)
                self._send_json({'ok': True, 'task': task}, 200)
                return

            if action == 'receipt':
                tid = str(body.get('id') or '')
                task = next((t for t in tasks if t['id'] == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在: ' + tid}, 404)
                    return
                task['receipt'] = {
                    'status': str(body.get('result') or 'done'),   # done/failed
                    'summary': str(body.get('summary') or ''),
                    'evidence': str(body.get('evidence') or ''),
                    'chat_id': str(body.get('chat_id') or ''),
                }
                task['status'] = 'done' if task['receipt']['status'] == 'done' else 'failed'
                task['ended_at'] = time.time()
                _save(d)
                self._send_json({'ok': True, 'id': tid, 'status': task['status']}, 200)
                return

            if action == 'cancel':
                tid = str(body.get('id') or '')
                task = next((t for t in tasks if t['id'] == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在: ' + tid}, 404)
                    return
                if task['status'] in ('done', 'failed', 'cancelled'):
                    self._send_json({'ok': False, 'error': '任务已完结: ' + task['status']}, 409)
                    return
                task['status'] = 'cancelled'
                task['ended_at'] = time.time()
                _save(d)
                self._send_json({'ok': True, 'id': tid}, 200)
                return

            # 默认 status：返回全部任务摘要（running 的顺带判超时）
            now = time.time()
            changed = False
            for t in tasks:
                if t['status'] == 'running' and now - (t['claimed_at'] or now) > t['timeout_sec']:
                    t['status'] = 'timeout'
                    t['ended_at'] = now
                    t['receipt'] = {'status': 'timeout', 'summary': '超时未交回执（命令行侧自动判死）',
                                    'evidence': '', 'chat_id': t.get('claimed_by') or ''}
                    changed = True
            if changed:
                _save(d)
            out = [{'id': t['id'], 'goal': t['goal'][:80], 'status': t['status'],
                    'age_sec': int(now - t['created_at']), 'receipt': t['receipt']}
                   for t in tasks]
            self._send_json({'ok': True, 'tasks': out}, 200)
