# -*- coding: utf-8 -*-
"""Mixin: 任务记事本（/api/tasknotes）—— 主人专属任务中枢。

数据存 server/data/task_notes.json，状态机：
  todo(待办) → doing(进行中) → review(待审核) → done(已归档)
  review 可被打回 → doing
关键规则：只有 action=confirm（用户审核通过）才能把任务归档为 done。
"""
import os
import json
import time
import threading

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
_DATA_FILE = os.path.join(_DATA_DIR, 'task_notes.json')
_TN_LOCK = threading.Lock()

_VALID_STATUS = ('todo', 'doing', 'review', 'done')


def _tn_load():
    try:
        with open(_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get('tasks'), list):
            return data
    except Exception:
        pass
    return {'tasks': []}


def _tn_save(data):
    os.makedirs(_DATA_DIR, exist_ok=True)
    tmp = _DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _DATA_FILE)


def _tn_new_id():
    return 'tn_%d_%03d' % (int(time.time() * 1000), int(time.time() * 1000) % 1000)


class MixinTaskNotes:
    # ===== GET /api/tasknotes =====
    def _handle_tasknotes_get(self):
        with _TN_LOCK:
            data = _tn_load()
        tasks = [t for t in data['tasks'] if t.get('status') != 'deleted']
        # 计算日历提醒状态：due=今天到期 / overdue=已过期未处理 / upcoming=未到期
        today = time.strftime('%Y-%m-%d')
        for t in tasks:
            ra = t.get('remind_at') or ''
            if ra and t.get('status') not in ('done', 'deleted'):
                if ra < today:
                    t['remind_state'] = 'overdue'
                elif ra == today:
                    t['remind_state'] = 'due'
                else:
                    t['remind_state'] = 'upcoming'
            else:
                t['remind_state'] = ''
        # 到期/过期的排最前
        def _sort_key(t):
            rs = t.get('remind_state', '')
            pri = {'overdue': -2, 'due': -1}.get(rs, 0)
            order = {'doing': 0, 'review': 1, 'todo': 2, 'done': 3}
            return (pri, order.get(t.get('status', 'todo'), 9), -int(t.get('created_at', 0)))
        tasks.sort(key=_sort_key)
        self._send_json({'ok': True, 'tasks': tasks, 'today': today})

    # ===== POST /api/tasknotes =====
    def _handle_tasknotes_post(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        action = body.get('action', 'add')
        with _TN_LOCK:
            data = _tn_load()
            tasks = data['tasks']
            now = int(time.time() * 1000)
            result = {'ok': True, 'message': ''}

            if action == 'add':
                title = str(body.get('title', '')).strip()
                if not title:
                    self._send_json({'ok': False, 'error': 'title 不能为空'}, 400)
                    return
                task = {
                    'id': _tn_new_id(),
                    'title': title,
                    'note': str(body.get('note', '')),
                    'status': 'todo',
                    'priority': 'urgent' if body.get('urgent') else 'normal',
                    'remind_at': str(body.get('remind_at') or '').strip(),  # 日历提醒日期 YYYY-MM-DD
                    'reminded_at': 0,   # 已通知时间戳（0=未通知）
                    'created_at': now,
                    'updated_at': now,
                    'done_at': None,
                    'receipt': '',           # AI 完成回执
                    'source': body.get('source', 'user'),
                }
                tasks.append(task)
                result['message'] = '已添加任务：' + title
                result['task'] = task

            elif action == 'update':
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                for k in ('title', 'note'):
                    if k in body:
                        task[k] = str(body[k])
                if 'status' in body and body['status'] in _VALID_STATUS:
                    task['status'] = body['status']
                    task['done_at'] = now if body['status'] == 'done' else None
                if 'urgent' in body:
                    task['priority'] = 'urgent' if body['urgent'] else 'normal'
                if 'remind_at' in body:
                    task['remind_at'] = str(body['remind_at'] or '').strip()
                    task['reminded_at'] = 0  # 改日期后重新计提醒
                task['updated_at'] = now
                result['message'] = '已更新任务'
                result['task'] = task

            elif action == 'status':
                tid = body.get('id')
                status = body.get('status')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                if status not in _VALID_STATUS:
                    self._send_json({'ok': False, 'error': '非法状态'}, 400)
                    return
                # 状态机约束：只能顺流推进 + review 打回 doing；不允许跨级归档
                cur = task.get('status', 'todo')
                allowed = {
                    'todo': {'doing'},
                    'doing': {'review', 'todo'},
                    'review': {'done', 'doing'},
                    'done': set(),
                }
                if status not in allowed.get(cur, set()):
                    self._send_json({'ok': False,
                                     'error': '不允许从 %s 跳到 %s（归档必须走 confirm 审核）' % (cur, status)}, 400)
                    return
                task['status'] = status
                task['updated_at'] = now
                if 'receipt' in body:
                    task['receipt'] = str(body['receipt'])
                result['message'] = '任务状态 → ' + status
                result['task'] = task

            elif action == 'toggle_done':
                # 用户自由切换：待办 ⇄ 完成（不限制原状态）
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                if task.get('status') == 'done':
                    task['status'] = 'todo'
                    task['done_at'] = None
                    result['message'] = '↩️ 已改回待办'
                else:
                    task['status'] = 'done'
                    task['done_at'] = now
                    result['message'] = '✅ 已完成'
                task['updated_at'] = now
                result['task'] = task

            elif action == 'urgent':
                # 加急/取消加急 切换
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                task['priority'] = 'normal' if task.get('priority') == 'urgent' else 'urgent'
                task['updated_at'] = now
                result['message'] = '❗ 已加急' if task['priority'] == 'urgent' else '已取消加急'
                result['task'] = task

            elif action == 'confirm':
                # ★ 唯一归档通道：用户审核通过
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                if task.get('status') != 'review':
                    self._send_json({'ok': False, 'error': '只有「待审核」任务才能确认完成'}, 400)
                    return
                task['status'] = 'done'
                task['done_at'] = now
                task['updated_at'] = now
                result['message'] = '✅ 已审核通过并归档'
                result['task'] = task

            elif action == 'reject':
                # 用户打回，退回进行中
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                task['status'] = 'doing'
                task['updated_at'] = now
                if 'reason' in body:
                    task['receipt'] = '【打回】' + str(body['reason'])
                result['message'] = '已打回，退回进行中'
                result['task'] = task

            elif action == 'delete':
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                task['status'] = 'deleted'
                task['updated_at'] = now
                result['message'] = '已删除'

            elif action == 'claim':
                # ★ 主人认领：自己领这个任务做，进入 doing 并打上 claimed 标记
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                if task.get('status') not in ('todo', 'doing'):
                    self._send_json({'ok': False, 'error': '只有待办/进行中任务可以认领'}, 400)
                    return
                task['status'] = 'doing'
                task['claimed'] = 'owner'
                task['claimed_at'] = now
                task['updated_at'] = now
                result['message'] = '📌 已认领任务：' + task.get('title', '')
                result['task'] = task

            elif action == 'finish':
                # ★ 主人直接完成（不等 AI 审核，主人特权）
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                if task.get('status') == 'deleted':
                    self._send_json({'ok': False, 'error': '任务已删除'}, 400)
                    return
                task['status'] = 'done'
                task['done_at'] = now
                task['updated_at'] = now
                result['message'] = '✅ 已完成：' + task.get('title', '')
                result['task'] = task

            elif action == 'cancel_task':
                # ★ 主人取消任务（软删除）
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                task['status'] = 'deleted'
                task['updated_at'] = now
                result['message'] = '已取消任务：' + task.get('title', '')

            elif action == 'remind_ack':
                # ★ 到期提醒已送达（前端弹过一次后调用，避免重复弹）
                tid = body.get('id')
                task = next((t for t in tasks if t.get('id') == tid), None)
                if not task:
                    self._send_json({'ok': False, 'error': '任务不存在'}, 404)
                    return
                task['reminded_at'] = now
                task['updated_at'] = now
                result['message'] = '已记录提醒送达'
                result['task'] = task

            elif action == 'clear_done':
                kept = [t for t in tasks if t.get('status') != 'done' or body.get('purge')]
                for t in tasks:
                    if t.get('status') == 'done':
                        t['status'] = 'deleted'
                if body.get('purge'):
                    data['tasks'] = kept
                result['message'] = '已清空已完成'

            else:
                self._send_json({'ok': False, 'error': '未知 action: %s' % action}, 400)
                return

            _tn_save(data)
        self._send_json(result)
