#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
plan_batch - 超长计划分批执行
从 long_plan 的 MD 计划中认领一批步骤（默认 5 步），只返回本批上下文，
避免 100 步计划撑爆单对话上下文。本批完成后 report 勾选并写日志。
"""
import os
import re
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'plan_batch'

DEFAULT_BATCH = 5


def _plan_path(ctx, plan_id):
    pid = re.sub(r'[^\w\-]', '', plan_id or '')
    return os.path.join(ctx.base_dir, '项目记录', '超长计划', pid + '.md')


def _step_regex():
    return re.compile(r'^###\s*\[([ x~])\]\s*步骤\s*(\d+)\s*[:：]\s*(.*)$', re.M)


def handle(body, ctx):
    action = body.get('action', '')
    plan_id = body.get('plan_id', '')

    if action == 'claim':
        if not plan_id:
            ctx.send_json({'ok': False, 'error': 'claim 需要 plan_id'})
            return
        fp = _plan_path(ctx, plan_id)
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': '计划不存在: ' + plan_id + '（可先 long_plan.list 查看全部计划）'})
            return
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        batch_size = int(body.get('batch_size') or DEFAULT_BATCH)
        batch_size = max(1, min(batch_size, 20))

        # 提取目标
        m = re.search(r'^-\s*目标\s*[:：]\s*(.*)$', content, re.M)
        goal = m.group(1).strip() if m else ''

        steps = _step_regex().finditer(content)
        all_steps = [{'no': int(m.group(2)), 'status': m.group(1), 'title': m.group(3).strip(),
                      'start': m.start(), 'end': content.find('\n###', m.end()) if content.find('\n###', m.end()) > 0 else len(content)}
                     for m in steps]
        # from_step：从指定步骤开始的 pending（并行分段执行用）
        from_step = body.get('from_step')
        pool = all_steps
        if from_step:
            try:
                from_step = int(from_step)
                pool = [s for s in all_steps if s['no'] >= from_step]
            except (TypeError, ValueError):
                pass
        done_recent = [s for s in all_steps if s['status'] == 'x'][-5:]
        pending = [s for s in pool if s['status'] == ' '][:batch_size]
        if not pending:
            all_done = all_steps and all(s['status'] in ('x', '~') for s in all_steps)
            ctx.send_json({'ok': True, 'plan_id': plan_id, 'batch': [], 'done': bool(all_done),
                           'message': '计划已全部完成，无需认领。' if all_done else ('计划内没有解析到步骤。' if not all_steps else '没有待做步骤。')})
            return

        # 摘录每个待做步骤的完整小节（说明/产出/验收）
        batch = []
        for s in pending:
            seg = content[s['start']:s['end']].strip()
            batch.append({'no': s['no'], 'title': s['title'], 'detail_md': seg})

        ctx.send_json({
            'ok': True, 'plan_id': plan_id,
            'goal': goal,
            'progress': '%d/%d' % (sum(1 for s in all_steps if s['status'] == 'x'), len(all_steps)),
            'previous_recent_done': [{'no': s['no'], 'title': s['title']} for s in done_recent],
            'batch': batch,
            'from_step': from_step or None,
            'message': ('已认领步骤 ' + ','.join(str(s['no']) for s in batch) +
                        '。请逐项执行，每完成一步立即用 plan_batch.report 逐条勾选（或全部完成后一次性 report），'
                        '本对话结束前必须确保已认领步骤全部 report。')
        })
        return

    if action == 'report':
        if not plan_id:
            ctx.send_json({'ok': False, 'error': 'report 需要 plan_id'})
            return
        fp = _plan_path(ctx, plan_id)
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': '计划不存在: ' + plan_id})
            return
        items = body.get('items') or []  # [{no, status?, note?}]
        if not items:
            ctx.send_json({'ok': False, 'error': 'report 需要 items 数组，如 [{no:1, note:"..."}]'})
            return
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()

        log_notes = []
        updated = []
        for it in items:
            try:
                no = int(it.get('no'))
            except (TypeError, ValueError):
                continue
            status = it.get('status', 'completed')
            mark = {'completed': 'x', 'skipped': '~', 'pending': ' '}.get(status)
            if not mark:
                continue
            old = re.search(r'^(###\[?)\s*$', '')  # noop guard
            m = re.search(r'^###\s*\[([ x~])\]\s*步骤\s*%d\s*[:：]' % no, content, re.M)
            if m:
                old_txt = '### [' + m.group(1) + '] 步骤 %d:' % no
                new_txt = '### [' + mark + '] 步骤 %d:' % no
                if old_txt in content:
                    content = content.replace(old_txt, new_txt, 1)
                    updated.append({'no': no, 'status': status})
                    note = (it.get('note') or '').strip()
                    if note:
                        log_notes.append('步骤%d(%s): %s' % (no, status, note))
        if log_notes:
            log_line = '- [' + time.strftime('%Y-%m-%d %H:%M') + ' ' + (body.get('chat_id') or '对话') + '] ' + '；'.join(log_notes)
            content = re.sub(r'(## 执行日志\n)', r'\1' + log_line + '\n', content, count=1)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)

        # 返回剩余待做
        remaining = [int(m.group(2)) for m in _step_regex().finditer(content) if m.group(1) == ' ']
        ctx.send_json({
            'ok': True, 'plan_id': plan_id, 'updated': updated,
            'remaining_count': len(remaining), 'next_pending': remaining[:batch_default(remaining)],
            'message': ('本批已记录。计划全部完成 ✅' if not remaining
                        else '本批已记录，剩余 %d 步（接下来: %s）。可继续 claim 或在对话结束前生成 handoff。'
                             % (len(remaining), ','.join(map(str, remaining[:5]))))
        })
        return

    if action == 'handoff':
        """生成交接摘要：新对话框只需说"继续计划 <plan_id>"即可续做。"""
        if not plan_id:
            ctx.send_json({'ok': False, 'error': 'handoff 需要 plan_id'})
            return
        fp = _plan_path(ctx, plan_id)
        if not os.path.isfile(fp):
            ctx.send_json({'ok': False, 'error': '计划不存在: ' + plan_id})
            return
        with open(fp, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        m = re.search(r'^-\s*目标\s*[:：]\s*(.*)$', content, re.M)
        goal = m.group(1).strip() if m else ''
        steps = [{'no': int(mm.group(2)), 'status': mm.group(1), 'title': mm.group(3).strip()}
                 for mm in _step_regex().finditer(content)]
        done = [s for s in steps if s['status'] == 'x']
        pending = [s for s in steps if s['status'] == ' ']
        text = ('【超长计划交接】\n计划: %s\n目标: %s\n进度: %d/%d\n'
                '已完成最后几步: %s\n下一批待做: 步骤 %s\n'
                '继续方式: 新对话直接说「继续计划 %s」，智能体会调用 plan_batch.claim 自动续做。'
                % (plan_id, goal, len(done), len(steps),
                   '、'.join('%d.%s' % (s['no'], s['title']) for s in done[-3:]) or '无',
                   ','.join(map(str, [s['no'] for s in pending[:5]])) or '无',
                   plan_id))
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'handoff_text': text})
        return

    ctx.send_json({'ok': False, 'error': 'Unknown action: ' + action})


def batch_default(remaining):
    return DEFAULT_BATCH if len(remaining) > DEFAULT_BATCH else len(remaining)
