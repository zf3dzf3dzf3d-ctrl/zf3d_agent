#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""query_answers - 根据问题关键字查找问答对"""
import os, json, time, re
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'query_answers'


def handle(body, ctx):
    """处理工具请求"""
    try:
        keyword = body.get('keyword', '')
        regex = body.get('regex', False)
        limit = body.get('limit', 10)
        offset = body.get('offset', 0)
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        answer_max_length = body.get('answer_max_length', 2000)
        include_question = body.get('include_question', True)

        if not keyword:
            ctx.send_error('keyword 参数为必填')
            return

        if not isinstance(limit, int) or limit < 1:
            limit = 10
        if not isinstance(offset, int) or offset < 0:
            offset = 0
        if not isinstance(answer_max_length, int) or answer_max_length < 1:
            answer_max_length = 2000

        # 构建要搜索的 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = None  # 搜索全部

        # 编译正则表达式
        regex_pattern = None
        if regex:
            try:
                regex_pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                ctx.send_error('无效的正则表达式: ' + keyword)
                return

        with ctx.db_lock:
            conn = ctx.get_db()
            try:
                cur = conn.cursor()

                # 查询匹配关键词的 user 消息
                if sid_list:
                    placeholders = ','.join('?' for _ in sid_list)
                    cur.execute(
                        'SELECT id, session_id, content FROM chat_history '
                        "WHERE role = 'user' AND session_id IN (" + placeholders + ') '
                        'ORDER BY id ASC',
                        tuple(sid_list)
                    )
                else:
                    cur.execute(
                        'SELECT id, session_id, content FROM chat_history '
                        "WHERE role = 'user' ORDER BY id ASC"
                    )

                user_rows = cur.fetchall()

                # 过滤匹配关键词的问题
                matched_questions = []
                for row in user_rows:
                    content = row['content'] or ''
                    if regex and regex_pattern:
                        if not regex_pattern.search(content):
                            continue
                    else:
                        if keyword.lower() not in content.lower():
                            continue
                    matched_questions.append(row)

                # 批量获取 session 标题
                all_sids = set(r['session_id'] for r in matched_questions)
                sid_title_map = {}
                if all_sids:
                    ph = ','.join('?' for _ in all_sids)
                    cur.execute(
                        'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                        tuple(all_sids)
                    )
                    for r in cur.fetchall():
                        sid_title_map[r['id']] = r['name']

                # 为每个匹配的问题找紧随其后的 assistant 回复
                results = []
                for q in matched_questions:
                    sid = q['session_id']
                    q_id = q['id']

                    # 用 id > ? 查找下一条 assistant 消息（id 是 AUTOINCREMENT，天然有序）
                    cur.execute(
                        'SELECT content FROM chat_history '
                        "WHERE session_id = ? AND role = 'assistant' AND id > ? "
                        'ORDER BY id ASC LIMIT 1',
                        (sid, q_id)
                    )
                    a_row = cur.fetchone()
                    if a_row:
                        answer = a_row['content'] or ''
                        if len(answer) > answer_max_length:
                            answer = answer[:answer_max_length] + '...'

                        result = {
                            'session_id': sid,
                            'session_title': sid_title_map.get(sid, sid),
                            'answer': answer
                        }
                        if include_question:
                            result['question'] = q['content'] or ''
                        results.append(result)
            finally:
                conn.close()

        total_found = len(results)
        # 分页
        paged = results[offset:offset + limit]
        has_more = (offset + limit) < total_found
        next_offset = offset + limit if has_more else total_found

        ctx.send_json({
            'ok': True,
            'results': paged,
            'keyword': keyword,
            'regex': regex,
            'has_more': has_more,
            'next_offset': next_offset,
            'returned': len(paged),
            'total_found': total_found
        })
    except Exception as e:
        ctx.send_error(str(e))
