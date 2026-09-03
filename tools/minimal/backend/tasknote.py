#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tasknote - 主人任务簿工具（AI 侧）。

主人说「把这个记到任务本上」时，AI 调用本工具直接写入任务簿。
数据与主人手动记录共用 server/data/task_notes.json（复用 mixin_tasknotes 的存储）。

状态机：todo → doing → review → done（done 只能由主人在界面上「审核通过」触发，
AI 无权归档，最多推进到 review 交主人验收）。
"""
import os
import json
import time

TOOL_NAME = 'tasknote'

_DATA_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    'server', 'data', 'task_notes.json'
)


def _load():
    try:
        with open(_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get('tasks'), list):
            return data
    except Exception:
        pass
    return {'tasks': []}


def _save(data):
    os.makedirs(os.path.dirname(_DATA_FILE), exist_ok=True)
    tmp = _DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _DATA_FILE)


def _fmt_ts(ms):
    try:
        return time.strftime('%Y-%m-%d %H:%M', time.localtime(int(ms) / 1000))
    except Exception:
        return '-'


def handle(body, ctx):
    try:
        action = body.get('action', 'add')
        data = _load()
        tasks = data['tasks']
        now = int(time.time() * 1000)

        if action == 'add':
            # 一句话记账：主人原话直接当 title；没传 title 时兜底取 desc/内容字段
            title = (body.get('title') or body.get('desc') or body.get('content') or body.get('text') or '').strip()
            desc = (body.get('desc') or '') if body.get('title') else ''
            if not title:
                return ctx.send_error('缺少 title（一句话任务内容即可）')
            item = {
                'id': 'tn_%d_%03d' % (now, now % 1000),
                'title': title,
                'desc': desc,
                'status': 'todo',
                'remind_at': str(body.get('remind') or body.get('remind_at') or '').strip(),  # YYYY-MM-DD，到这天通知主人
                'reminded_at': 0,
                'source': body.get('source') or 'ai',
                'created_at': now,
                'updated_at': now,
            }
            tasks.append(item)
            _save(data)
            msg = '已记入主人任务簿（待办）'
            if item['remind_at']:
                msg += '，将提醒主人：' + item['remind_at']
            return ctx.send_json({'ok': True, 'message': msg, 'task': item})

        elif action == 'list':
            alive = [t for t in tasks if t.get('status') != 'deleted']
            order = {'doing': 0, 'review': 1, 'todo': 2, 'done': 3}
            alive.sort(key=lambda t: (order.get(t.get('status', 'todo'), 9), -int(t.get('created_at', 0))))
            status_filter = body.get('status')
            if status_filter:
                alive = [t for t in alive if t.get('status') == status_filter]
            limit = int(body.get('limit') or 30)
            brief = [{
                'id': t.get('id'), 'title': t.get('title'), 'desc': t.get('desc'),
                'status': t.get('status'), 'source': t.get('source'),
                'remind_at': t.get('remind_at') or '',
                'created': _fmt_ts(t.get('created_at')), 'updated': _fmt_ts(t.get('updated_at')),
            } for t in alive[:limit]]
            return ctx.send_json({'ok': True, 'count': len(alive), 'tasks': brief})

        elif action == 'status':
            tid = body.get('task_id') or ''
            new_status = body.get('new_status') or ''
            if new_status == 'done':
                return ctx.send_error('AI 无权将任务归档为 done，只有主人在任务簿界面「审核通过」后才会归档。可推进到 review 交主人验收。')
            if new_status not in ('todo', 'doing', 'review'):
                return ctx.send_error('new_status 仅支持 todo / doing / review（done 由主人审核触发）')
            for t in tasks:
                if t.get('id') == tid and t.get('status') != 'deleted':
                    t['status'] = new_status
                    t['updated_at'] = now
                    _save(data)
                    return ctx.send_json({'ok': True, 'message': '任务 %s → %s' % (tid, new_status), 'task': t})
            return ctx.send_error('未找到任务: %s' % tid)

        elif action == 'note':
            tid = body.get('task_id') or ''
            note = body.get('note') or ''
            for t in tasks:
                if t.get('id') == tid and t.get('status') != 'deleted':
                    t['notes'] = (t.get('notes') or [])
                    t['notes'].append({'at': now, 'by': 'ai', 'text': note})
                    t['updated_at'] = now
                    _save(data)
                    return ctx.send_json({'ok': True, 'message': '已追加备注'})
            return ctx.send_error('未找到任务: %s' % tid)

        else:
            return ctx.send_error('未知 action: %s（支持 add / list / status / note）' % action)

    except Exception as e:
        return ctx.send_error('tasknote 工具异常: %s' % e)
