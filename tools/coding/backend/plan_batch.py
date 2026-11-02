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
    return os.path.join(ctx.base_dir, 'private', '记忆', '超长计划', pid + '.md')


_DONE_MARKS = ('x', 'X', '✓', '√')
_SKIP_MARKS = ('~', '-')
# 归一化：long_plan 可写入 ✓/√/X/- 等手写变体，这里统一映射，避免状态误判
def _norm(mark):
    if mark in _DONE_MARKS:
        return 'x'
    if mark in _SKIP_MARKS:
        return '~'
    return mark  # ' ' / '!' / 其他按原样


def _step_regex():
    return re.compile(r'^###\s*\[([xX✓√ x~\-!])\]\s*步骤\s*(\d+)\s*[:：]\s*(.*)$', re.M)


BLOCK_MARK = '!'  # blocked：因外部条件挂起，区别于 skipped


def _read_log_tail(content, n=5):
    """提取执行日志末尾 n 行，供断点恢复。"""
    m = re.search(r'##\s*执行日志\s*\n(.*?)(?=\n##|\Z)', content, re.S)
    if not m:
        return []
    lines = [l.rstrip() for l in m.group(1).splitlines() if l.strip()]
    return lines[-n:]


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
        done_recent = [s for s in all_steps if _norm(s['status']) == 'x'][-5:]
        blocked = [s for s in all_steps if _norm(s['status']) == BLOCK_MARK]
        # pending 池排除 blocked（挂起的步骤不认领）
        pool = [s for s in pool if _norm(s['status']) != BLOCK_MARK]
        pending = [s for s in pool if _norm(s['status']) == ' '][:batch_size]
        if not pending:
            all_done = all_steps and all(_norm(s['status']) in ('x', '~', BLOCK_MARK) for s in all_steps)
            msg = '计划已全部完成，无需认领。' if all_done else (
                '计划内没有解析到步骤。' if not all_steps else
                ('没有待做步骤。' + (' 挂起步骤: %s' % ','.join(str(s['no']) for s in blocked) if blocked else '')))
            ctx.send_json({'ok': True, 'plan_id': plan_id, 'batch': [], 'done': bool(all_done),
                           'blocked_steps': [{'no': s['no'], 'title': s['title']} for s in blocked],
                           'message': msg})
            return

        # 断点恢复上下文：执行日志末尾 + 最近完成
        log_tail = _read_log_tail(content)

        # 摘录每个待做步骤的完整小节（说明/产出/验收）
        batch = []
        for s in pending:
            seg = content[s['start']:s['end']].strip()
            batch.append({'no': s['no'], 'title': s['title'], 'detail_md': seg})

        ctx.send_json({
            'ok': True, 'plan_id': plan_id,
            'goal': goal,
            'progress': '%d/%d' % (sum(1 for s in all_steps if _norm(s['status']) == 'x'), len(all_steps)),
            'previous_recent_done': [{'no': s['no'], 'title': s['title']} for s in done_recent],
            'blocked_steps': [{'no': s['no'], 'title': s['title']} for s in blocked],
            'resume_log_tail': log_tail,
            'batch': batch,
            'from_step': from_step or None,
            'message': ('已认领步骤 ' + ','.join(str(s['no']) for s in batch) +
                        '。请逐项执行，每完成一步立即用 plan_batch.report 逐条勾选（或全部完成后一次性 report），'
                        'note 中写清产出物文件路径和关键结论；被外部条件卡住的步骤用 status:"blocked" 挂起并注明卡点，不要硬标 skipped。'
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
            if status == 'blocked':
                status = BLOCK_MARK  # 挂起：区别于 skipped
            mark = {'completed': 'x', 'skipped': '~', 'pending': ' ', BLOCK_MARK: BLOCK_MARK}.get(status)
            if not mark:
                continue
        # report 使用相同正则（含变体标记）
        mm = re.search(r'^###\s*\[([xX✓√ x~\-!])\]\s*步骤\s*%d\s*[:：]' % no, content, re.M)
        if mm:
            old_txt = '### [' + mm.group(1) + '] 步骤 %d:' % no
            new_txt = '### [' + mark + '] 步骤 %d:' % no
            if old_txt in content:
                content = content.replace(old_txt, new_txt, 1)
                updated.append({'no': no, 'status': 'blocked' if status == BLOCK_MARK else status})
                note = (it.get('note') or '').strip()
                if note:
                    log_notes.append('步骤%d(%s): %s' % (no, 'blocked' if status == BLOCK_MARK else status, note))
                    # 产出物/卡点写入步骤小节，供断点恢复时直接读取
                    idx = content.find(new_txt)
                    if idx >= 0:
                        n2 = content.find('\n###', idx + 1)
                        seg_end = n2 if n2 >= 0 else content.find('\n## ', idx + 1)
                        if seg_end < 0:
                            seg_end = len(content)
                        seg = content[idx:seg_end]
                        if '- 产出与卡点:' in seg:
                            seg = re.sub(r'- 产出与卡点:.*', '- 产出与卡点: ' + note, seg, count=1)
                        else:
                            seg = seg.rstrip('\n') + '\n- 产出与卡点: ' + note + '\n'
                        content = content[:idx] + seg + content[seg_end:]
        if log_notes:
            log_line = '- [' + time.strftime('%Y-%m-%d %H:%M') + ' ' + (body.get('chat_id') or '对话') + '] ' + '；'.join(log_notes)
            content = re.sub(r'(## 执行日志\n)', r'\1' + log_line + '\n', content, count=1)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)

        # 返回剩余待做
        remaining = [int(m.group(2)) for m in _step_regex().finditer(content) if _norm(m.group(1)) == ' ']
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
        done = [s for s in steps if _norm(s['status']) == 'x']
        pending = [s for s in steps if _norm(s['status']) == ' ']
        blocked = [s for s in steps if _norm(s['status']) == BLOCK_MARK]
        log_tail = _read_log_tail(content, 3)
        # 抽取挂起/待做步骤的产出与卡点行
        def _notes(nos):
            out = {}
            for n in nos:
                mm2 = re.search(r'^###\s*\[[xX✓√ x~\-!]\]\s*步骤\s*%d\s*[:：].*?\n(.*?)(?=\n###|\n## |\Z)' % n, content, re.S | re.M)
                if mm2:
                    nm = re.search(r'- 产出与卡点:\s*(.*)', mm2.group(1))
                    if nm:
                        out[n] = nm.group(1).strip()
            return out
        text = ('【计划交接】%s\n目标: %s\n进度: %d/%d 完成\n最近完成: %s\n挂起(blocked): %s\n执行日志摘要: %s\n下一步待做: %s\n'
                '续做提示: 新对话中说「继续计划 %s」或用 plan_batch.claim 认领。') % (
                   plan_id, goal, len(done), len(steps),
                   ','.join(map(str, [s['no'] for s in done[-3:]])) or '无',
                   (','.join('%d:%s' % (s['no'], _notes([s['no']]).get(s['no'], '未注明卡点')) for s in blocked)) or '无',
                   ' | '.join(log_tail[-3:]) or '无',
                   ','.join(map(str, [s['no'] for s in pending[:5]])) or '无',
                   plan_id)
        text = ('【计划交接】\n计划: %s\n目标: %s\n进度: %d/%d 完成\n'
                '最近完成: %s\n挂起(blocked): %s\n执行日志摘要: %s\n下一批待做: 步骤 %s\n'
                '继续方式: 新对话直接说「继续计划 %s」，智能体会调用 plan_batch.claim 自动续做；'
                '被挂起的步骤需先解决卡点再用 report status:"completed" 恢复。'
                % (plan_id, goal, len(done), len(steps),
                   '、'.join('%d.%s' % (s['no'], s['title']) for s in done[-3:]) or '无',
                   (','.join('%d.%s[%s]' % (s['no'], s['title'], _notes([s['no']]).get(s['no'], '未注明卡点')) for s in blocked)) or '无',
                   ' | '.join(log_tail[-3:]) or '无',
                   ','.join(map(str, [s['no'] for s in pending[:5]])) or '无',
                   plan_id))
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'handoff_text': text})
        return

    ctx.send_json({'ok': False, 'error': 'Unknown action: ' + action})


def batch_default(remaining):
    return DEFAULT_BATCH if len(remaining) > DEFAULT_BATCH else len(remaining)
