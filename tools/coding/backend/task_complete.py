#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""task_complete - 任务完成标记"""
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'task_complete'


def handle(body, ctx):
    success = body.get('success')
    if success is None:
        success = True
    success = (success is True or str(success).lower() == 'true')
    message = body.get('message', '任务完成' if success else '任务失败')
    scope = body.get('scope', '当前任务')
    # 【改必读】收尾闸门：成功收尾时若仍有「改后未读」的文件 → 拒绝收尾，要求先回读（失败静默放行）
    unread = []
    if success:
        try:
            from tools.coding.backend import _mustread
            unread = _mustread.pending()
            if unread:
                names = '\n'.join('- %s（%s 改动后未读）' % (u['path'], u['tool']) for u in unread[:10])
                ctx.send_json({
                    'ok': False, 'success': False, 'tool': 'task_complete',
                    'message': '收尾被拦截：以下文件改过后还没有回读过（改必读规则），请先用 read/read_lines 确认改动结果，再重新收尾。\n' + names,
                    'unread_files': unread})
                return
        except Exception:
            pass
    # 变更溯源结算：把本会话累积的文件改动写入 变更日志.md + 文件变更索引.md（旁路，失败静默）
    flushed = 0
    try:
        from tools.coding.backend import _changelog
        flushed = _changelog.flush_task(body.get('_chat_id', ''), message, success)
    except Exception:
        pass
    # 自动工作日志：任务完成 → 工作日志/YYYY-MM.md；攒满 20 条自动阶段总结；每日快照备份
    try:
        from tools.coding.backend import _memory_tools
        log_name = _memory_tools.append_work_log(
            ctx, ('任务完成' if success else '任务失败') + '：' + (message or '').split('\n')[0][:60],
            ' '.join(str(message or '').split('\n')[1:3]))
        if log_name:
            _memory_tools.maybe_stage_summary(ctx)
        _memory_tools.backup_memory_snapshot(ctx)
    except Exception:
        pass
    # 【涌现侦测钩子·已迁移】主交互流程中 task_complete 前端直接 return 不 POST 本 handler
    # （见 public/js/tools-04-execute.js case 'task_complete'，且 prefetch 白名单不含本工具），
    # 故本 handle 内的钩子在真实对话循环里不可达。已迁至唯一可达收尾链路：
    # 前端 DB.saveStats → POST /api/db/stats → routes/api_dispatch_post.py 的 _run_growth 异步线程。
    # 【记忆送达钩子】（Retrieved but Not Delivered 启发）：收尾前主动检索记忆库一次，
    # 命中相关历史记录则随响应注入摘要，防"存了但没读到"。限次限长，异常静默。
    memory_hits = []
    if success:
        try:
            import os as _os
            import sys as _sys
            if _os.environ.get('ZF_MEMORY_RECALL_OFF', '') != '1':
                _srv = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), '..', '..', '..', 'server'))
                if _os.path.isdir(_srv) and _srv not in _sys.path:
                    _sys.path.insert(0, _srv)
                from engines.common.vector_memory import search_memory
                q = ' '.join(str(message or '').split())[:80]
                if q.strip():
                    r = search_memory(q, top_k=3)
                    for h in (r.get('hits') or []):
                        if float(h.get('score') or 0) >= 0.12:
                            memory_hits.append({'file': h.get('file'),
                                                'snippet': str(h.get('snippet') or '')[:200]})
        except Exception:
            memory_hits = []
    payload = {'ok': success, 'success': success, 'message': message, 'scope': scope,
               'tool': 'task_complete', 'changes_logged': flushed}
    if memory_hits:
        payload['memory_recall'] = memory_hits
        payload['message'] = (message or '') + '\n\n📎 记忆送达（收尾自动检索，全文用 project_record read）：' + \
            '\n'.join('- %s: %s' % (h['file'], h['snippet'].replace('\n', ' ')[:120]) for h in memory_hits)
    ctx.send_json(payload)
