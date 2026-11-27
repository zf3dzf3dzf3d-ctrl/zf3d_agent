# -*- coding: utf-8 -*-
"""Mixin: 后台任务监控（/api/schedule）—— 无限桌面监控卡数据源。

只读端点，直接读 tools/coding/backend/schedule.py 的进程内 _tasks（同进程，无需 IPC）。
GET /api/schedule?action=list              所有任务摘要（含 last_output）
GET /api/schedule?action=status&name=X     单任务详情

安全红线：本端点只读，不接受新建/停止等写操作（写操作仍走对话内 schedule 工具）。
"""
import re

_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')


class MixinSchedule:
    # ===== GET /api/schedule?action=list|status =====
    def _handle_schedule_get(self, query):
        from urllib.parse import parse_qs
        qs = parse_qs(query or '')
        action = (qs.get('action') or ['list'])[0]

        try:
            from tools.coding.backend import schedule as sched
        except Exception as e:
            self._send_json({'ok': False, 'error': 'schedule 模块不可用: %s' % e})
            return

        try:
            if action == 'list':
                with sched._tasks_lock:
                    tasks = []
                    for task in sched._tasks.values():
                        item = sched._task_summary(task, include_output=True)
                        # 去控制字符，防 JSON/前端渲染异常
                        if item.get('last_output'):
                            item['last_output'] = _CTRL_RE.sub('', item['last_output'])[:4000]
                        item.pop('process', None)
                        tasks.append(item)
                tasks.sort(key=lambda t: (not t['running'], t['name']))
                self._send_json({'ok': True, 'tasks': tasks,
                                 'max_active_tasks': sched.MAX_ACTIVE_TASKS})
                return

            if action == 'status':
                name = (qs.get('name') or [''])[0].strip()
                if not name:
                    self._send_json({'ok': False, 'error': '需要 name 参数'})
                    return
                with sched._tasks_lock:
                    task = sched._tasks.get(name)
                    if task is None:
                        self._send_json({'ok': False, 'error': '任务不存在: %s' % name})
                        return
                    result = sched._task_summary(task, include_output=True)
                    if result.get('last_output'):
                        result['last_output'] = _CTRL_RE.sub('', result['last_output'])[:8000]
                self._send_json({'ok': True, **result})
                return

            self._send_json({'ok': False, 'error': '未知 action: %s' % action})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})
