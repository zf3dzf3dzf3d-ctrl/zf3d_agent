#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
long_plan - 超长计划管理（MD 持久化）
计划文件存于「项目记录/超长计划/」目录，单一事实来源，
支持多个对话框接力执行同一个计划。

格式约定（模型可精确解析）：
    # 超长计划: 标题
    ## 元信息
    - plan_id: lp-xxx
    - 目标: ...
    - 总步数: N
    ## 阶段 x: xxx
    ### [x] 步骤 1: 标题
    - 说明: ...
    - 产出: ...
    - 验收: ...
    ## 执行日志
    - [时间 对话] ...
"""
import os
import re
import time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'long_plan'


def _plans_dir(ctx):
    d = os.path.join(ctx.base_dir, '项目记录', '超长计划')
    os.makedirs(d, exist_ok=True)
    return d


def _safe_id(plan_id):
    return re.sub(r'[^\w\-]', '', plan_id or '')


def _plan_path(ctx, plan_id):
    return os.path.join(_plans_dir(ctx), _safe_id(plan_id) + '.md')


def _step_regex():
    return re.compile(r'^###\s*\[([ xX~✓√\-])\]\s*步骤\s*(\d+)\s*[:：]\s*(.*)$', re.M)


def _parse(content):
    """解析计划内容，返回 steps 列表 [{no, status, title}]。
    容错：识别大小写 X / ✓ / √ / - 等常见手写变体；重复步骤号取最后出现的一次。"""
    status_map = {'x': 'completed', 'X': 'completed', '✓': 'completed',
                  '√': 'completed', ' ': 'pending', '~': 'skipped', '-': 'skipped'}
    steps = {}
    for m in _step_regex().finditer(content):
        status = status_map.get(m.group(1), 'pending')
        no = int(m.group(2))
        steps[no] = {'no': no, 'status': status, 'title': m.group(3).strip()}
    return [steps[k] for k in sorted(steps)]


def _meta(content, key):
    m = re.search(r'^-\s*' + key + r'\s*[:：]\s*(.*)$', content, re.M)
    return m.group(1).strip() if m else ''


def _auto_backup(fp):
    """每次写入前留一份 .auto.bak（单份滚动覆盖），供损坏自恢复。永不抛错。"""
    try:
        if os.path.isfile(fp):
            import shutil as _shutil
            _shutil.copy2(fp, fp + '.auto.bak')
    except Exception:
        pass


def _render_steps(steps, start_no=1):
    """把步骤列表渲染成 MD 步骤章节（含阶段分章）。"""
    lines = []
    n = len(steps)
    for i, s in enumerate(steps):
        no = start_no + i
        if (no - 1) % 10 == 0:
            lines.append('## 阶段 %d（步骤 %d-%d）' % ((no - 1) // 10 + 1, no, min(no + 9, start_no + n - 1)))
        t = s if isinstance(s, str) else s.get('title', '')
        lines.append('### [ ] 步骤 %d: %s' % (no, t))
        if isinstance(s, dict):
            for k, lab in (('detail', '说明'), ('deliverable', '产出'), ('accept', '验收')):
                v = s.get(k, '')
                if v:
                    lines.append('- %s: %s' % (lab, v))
        lines.append('')
    return '\n'.join(lines) + '\n'


def handle(body, ctx):
    action = body.get('action', 'list')
    plans_dir = _plans_dir(ctx)

    # ===== list：列出所有计划及进度 =====
    if action == 'list':
        light = bool(body.get('light'))
        plans = []
        try:
            for f in sorted(os.listdir(plans_dir)):
                if not f.endswith('.md'):
                    continue
                try:
                    fp_path = os.path.join(plans_dir, f)
                    if light:
                        # 轻量模式：只读标题行 + 步骤行，不读全文（大计划文件可达数百 KB）
                        title = ''
                        done = 0
                        total = 0
                        first = True
                        with open(fp_path, 'r', encoding='utf-8', errors='replace') as fp:
                            for line in fp:
                                if first:
                                    title = re.sub(r'^#\s*超长计划\s*[:：]\s*', '', line.rstrip('\n')).strip()
                                    first = False
                                m = _step_regex().match(line)
                                if m:
                                    total += 1
                                    if m.group(1).lower() in ('x', '✓', '√'):
                                        done += 1
                        if first:
                            title = f[:-3]
                        plans.append({
                            'plan_id': f[:-3],
                            'title': title,
                            'total': total,
                            'done': done,
                            'finished': bool(total) and done == total
                        })
                    else:
                        with open(fp_path, 'r', encoding='utf-8', errors='replace') as fp:
                            c = fp.read()
                        steps = _parse(c)
                        done = sum(1 for s in steps if s['status'] == 'completed')
                        plans.append({
                            'plan_id': f[:-3],
                            'title': re.sub(r'^#\s*超长计划\s*[:：]\s*', '', (c.splitlines() or [''])[0]).strip(),
                            'total': len(steps),
                            'done': done,
                            'finished': bool(steps) and done == len(steps)
                        })
                except Exception:
                    pass
            ctx.send_json({'ok': True, 'plans': plans})
        except Exception as e:
            ctx.send_json({'ok': False, 'error': str(e)})
        return

    plan_id = body.get('plan_id', '')

    # ===== create：创建新计划 =====
    if action == 'create':
        title = (body.get('title') or '').strip()
        goal = (body.get('goal') or '').strip()
        steps = body.get('steps') or []
        if not title or not steps:
            ctx.send_json({'ok': False, 'error': 'create 需要 title 和 steps（步骤列表）'})
            return
        if not plan_id:
            plan_id = 'lp-' + time.strftime('%Y%m%d-%H%M%S')
        # 每步: 字符串 或 {title, detail, deliverable, accept}
        lines = ['# 超长计划: ' + title, '',
                 '## 元信息',
                 '- plan_id: ' + plan_id,
                 '- 目标: ' + (goal or '(未填写)'),
                 '- 总步数: ' + str(len(steps)),
                 '- 创建: ' + time.strftime('%Y-%m-%d %H:%M'), '']
        # 按每 10 步一个阶段自动分章
        lines.append(_render_steps(steps))
        lines.append('## 执行日志')
        lines.append('- [' + time.strftime('%Y-%m-%d %H:%M') + '] 计划创建')
        fp_ = _plan_path(ctx, plan_id)
        with open(fp_, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'total': len(steps),
                       'message': '计划已创建: ' + plan_id + '，共 %d 步。后续用 plan_batch.claim 认领执行。' % len(steps)})
        return

    if not plan_id:
        ctx.send_json({'ok': False, 'error': '需要 plan_id 参数（list 操作除外）'})
        return
    fp = _plan_path(ctx, plan_id)
    if not os.path.isfile(fp):
        ctx.send_json({'ok': False, 'error': '计划不存在: ' + plan_id})
        return
    # 损坏自恢复：若存在同名 .bak 且主文件解析出 0 步而 bak 有步骤，提示可恢复
    with open(fp, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    if action not in ('create', 'read') and not _step_regex().search(content):
        bak_fp = fp + '.auto.bak'
        if os.path.isfile(bak_fp):
            with open(bak_fp, 'r', encoding='utf-8', errors='replace') as f:
                bak_content = f.read()
            if _step_regex().search(bak_content):
                # 主文件损坏（解析不到任何步骤），用最近一次自动备份顶上
                import shutil as _shutil
                _shutil.copy2(bak_fp, fp)
                content = bak_content
                ctx.send_json({'ok': True, 'plan_id': plan_id,
                               'warning': '计划文件损坏（解析不到步骤），已从自动备份恢复。请先 read 确认内容，再重试本次操作。',
                               'recovered': True})
                return

    # ===== update：修订计划（目标可逐步明确，步骤可追加/细化/重写）=====
    if action == 'update':
        changes = []
        # 1) 修订目标
        new_goal = (body.get('goal') or '').strip()
        if new_goal:
            content = re.sub(r'^- 目标:.*$', '- 目标: ' + new_goal, content, count=1, flags=re.M)
            changes.append('目标已更新')
        # 2) 追加步骤
        append_steps = body.get('append_steps') or []
        if append_steps:
            start_no = (max((s['no'] for s in _parse(content)), default=0)) + 1
            block = _render_steps(append_steps, start_no=start_no)
            # 插到执行日志之前
            content = content.replace('## 执行日志', block + '\n## 执行日志', 1)
            m = re.search(r'^- 总步数: (\d+)$', content, re.M)
            if m:
                content = content.replace(m.group(0), '- 总步数: ' + str(int(m.group(1)) + len(append_steps)), 1)
            changes.append('追加 %d 步（步骤 %d 起）' % (len(append_steps), start_no))
        # 3) 全量重写剩余步骤（reset_pending=true 时清空未完成步骤后重写）
        if body.get('reset_pending'):
            new_steps = body.get('steps') or []
            if not new_steps:
                ctx.send_json({'ok': False, 'error': 'reset_pending 需要提供 steps'})
                return
            done = [s for s in _parse(content) if s['status'] == 'completed']
            # 重建正文：保留已完成步骤为 [x]，其余用新步骤替换
            head = content.split('## 执行日志')[0]
            keep = ''
            for s in done:
                keep += '### [x] 步骤 %d: (已完成保留)\n\n' % s['no']
            body_lines = head.split('\n')
            # 去掉旧的步骤章节（保留头部元信息）
            cut = next((i for i, l in enumerate(body_lines) if l.startswith('## 阶段')), len(body_lines))
            head = '\n'.join(body_lines[:cut]).rstrip() + '\n\n'
            content = head + keep + _render_steps(new_steps, start_no=len(done) + 1) + '\n## 执行日志' + content.split('## 执行日志', 1)[1]
            m = re.search(r'^- 总步数: \d+$', content, re.M)
            if m:
                content = content.replace(m.group(0), '- 总步数: %d' % (len(done) + len(new_steps)), 1)
            changes.append('重写未完成步骤为 %d 步（已完成 %d 步保留）' % (len(new_steps), len(done)))
        if not changes:
            ctx.send_json({'ok': False, 'error': 'update 需要至少提供 goal / append_steps / reset_pending+steps 之一'})
            return
        log_line = '- [' + time.strftime('%Y-%m-%d %H:%M') + '] 计划修订: ' + '；'.join(changes)
        content = content.replace('## 执行日志', '## 执行日志\n' + log_line, 1)
        _auto_backup(fp)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'changes': changes,
                       'message': '计划已修订（' + '；'.join(changes) + '）。计划允许逐步明确，执行前建议 read 确认最新内容。'})
        return

    # ===== read：返回全文 =====
    if action == 'read':
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'content': content})
        return

    # ===== progress：勾选/跳过步骤 + 写日志 =====
    if action == 'progress':
        step_nos = body.get('step_nos') or []
        status = body.get('status', 'completed')  # completed / skipped
        note = (body.get('note') or '').strip()   # 本批完成摘要，写入日志
        mark = {'completed': 'x', 'skipped': '~', 'pending': ' '}.get(status)
        if not mark or not step_nos:
            ctx.send_json({'ok': False, 'error': 'progress 需要 step_nos 数组和 status(completed/skipped)'})
            return
        steps = _parse(content)
        changed = []
        for no in step_nos:
            for m in _step_regex().finditer(content):
                if int(m.group(2)) == no:
                    old = '### [' + m.group(1) + '] 步骤 %d:' % no
                    new = '### [' + mark + '] 步骤 %d:' % no
                    if old in content:
                        content = content.replace(old, new, 1)
                        changed.append(no)
                    break
        if note:
            log_line = '- [' + time.strftime('%Y-%m-%d %H:%M') + ' ' + (body.get('chat_id') or '对话') + '] 步骤 ' + \
                       ','.join(str(n) for n in sorted(set(changed))) + (' 已跳过' if status == 'skipped' else ' 完成') + ': ' + note
            # 插入到日志节顶部之后
            content = re.sub(r'(## 执行日志\n)', r'\1' + log_line + '\n', content, count=1)
        _auto_backup(fp)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)
        ctx.send_json({'ok': True, 'plan_id': plan_id, 'updated': changed, 'total_steps': len(steps),
                       'progress': _stats_str(steps, changed, status)})
        return

    # ===== stats：进度概览 + 下一批待做步骤（新对话续做入口）=====
    if action == 'stats':
        steps = _parse(content)
        done = [s['no'] for s in steps if s['status'] == 'completed']
        pending = [s['no'] for s in steps if s['status'] == 'pending']
        # 日志最后 10 条
        log_part = content.split('## 执行日志', 1)
        logs = []
        if len(log_part) == 2:
            logs = [l for l in log_part[1].strip().splitlines() if l.strip().startswith('- ')][-10:]
        ctx.send_json({
            'ok': True, 'plan_id': plan_id,
            'title': _meta(content, '标题') or re.sub(r'^#\s*超长计划\s*[:：]\s*', '', (content.splitlines() or [''])[0]).strip(),
            'goal': _meta(content, '目标'),
            'total': len(steps), 'done_count': len(done), 'pending_count': len(pending),
            'steps': steps,
            'finished': bool(steps) and not pending,
            'next_pending': pending[:10],
            'recent_logs': logs,
            'message': ('计划已全部完成 ✅' if (steps and not pending)
                        else '进度 %d/%d，接下来从步骤 %s 开始。' % (len(done), len(steps), pending[0] if pending else '-'))
        })
        return

    ctx.send_json({'ok': False, 'error': 'Unknown action: ' + action})


def _stats_str(steps, changed, status):
    done = sum(1 for s in steps if s['status'] == 'completed' or (s['no'] in changed and status == 'completed'))
    return '%d/%d' % (done, len(steps))
