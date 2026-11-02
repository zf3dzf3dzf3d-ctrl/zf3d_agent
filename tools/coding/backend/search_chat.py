#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""search_chat - 搜索聊天记录内容"""
import os, json, time
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'search_chat'


def _make_snippet(content, keyword, width=60):
    """围绕关键词生成摘要片段"""
    if not content:
        return ''
    text = str(content)
    idx = text.lower().find(keyword.lower())
    if idx < 0:
        # 关键词未直接命中，返回开头
        return text[:width * 2] + ('...' if len(text) > width * 2 else '')
    start = max(0, idx - width)
    end = min(len(text), idx + len(keyword) + width)
    snippet = text[start:end]
    if start > 0:
        snippet = '...' + snippet
    if end < len(text):
        snippet = snippet + '...'
    return snippet


def handle(body, ctx):
    """处理工具请求"""
    try:
        keyword = body.get('keyword', '')
        keywords = body.get('keywords', None)
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        match_mode = body.get('match_mode', 'any')
        limit = body.get('limit', 50)
        role = body.get('role', '')

        if not isinstance(limit, int) or limit < 1:
            limit = 50
        if match_mode not in ('any', 'all'):
            match_mode = 'any'

        # 构建关键词列表
        if keywords and isinstance(keywords, list):
            kw_list = [k for k in keywords if k]
        elif keyword:
            kw_list = [keyword]
        else:
            kw_list = []

        if not kw_list:
            ctx.send_error('需要提供 keyword 或 keywords 参数')
            return

        # 构建要搜索的 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = None  # 搜索全部

        results = []
        sessions_searched = 0
        total_matches = 0

        with ctx.db_lock:
            conn = ctx.get_db()
            try:
                cur = conn.cursor()

                # 获取要搜索的 session 列表
                if sid_list:
                    placeholders = ','.join('?' for _ in sid_list)
                    cur.execute(
                        'SELECT DISTINCT session_id FROM chat_history '
                        'WHERE session_id IN (' + placeholders + ')',
                        tuple(sid_list)
                    )
                else:
                    cur.execute('SELECT DISTINCT session_id FROM chat_history')

                search_sids = [r['session_id'] for r in cur.fetchall()]
                sessions_searched = len(search_sids)

                # 批量获取 session 标题
                sid_title_map = {}
                if search_sids:
                    ph = ','.join('?' for _ in search_sids)
                    cur.execute(
                        'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                        tuple(search_sids)
                    )
                    for r in cur.fetchall():
                        sid_title_map[r['id']] = r['name']

                for sid in search_sids:
                    # 查询该 session 的消息
                    params = [sid]
                    where_parts = ['session_id = ?']
                    if role:
                        where_parts.append('role = ?')
                        params.append(role)

                    cur.execute(
                        'SELECT id, role, content FROM chat_history WHERE '
                        + ' AND '.join(where_parts)
                        + ' ORDER BY id ASC',
                        tuple(params)
                    )
                    rows = cur.fetchall()

                    matches = []
                    for row in rows:
                        content = row['content'] or ''
                        # 关键词匹配
                        if match_mode == 'all':
                            matched = all(
                                k.lower() in content.lower() for k in kw_list
                            )
                        else:  # any
                            matched = any(
                                k.lower() in content.lower() for k in kw_list
                            )

                        if matched:
                            # 找到第一个命中的关键词生成摘要
                            first_kw = ''
                            for k in kw_list:
                                if k.lower() in content.lower():
                                    first_kw = k
                                    break
                            snippet = _make_snippet(content, first_kw)
                            matches.append({
                                'role': row['role'],
                                'snippet': snippet
                            })
                            if len(matches) >= limit:
                                break

                    if matches:
                        title = sid_title_map.get(sid, sid)
                        results.append({
                            'session_id': sid,
                            'title': title,
                            'match_count': len(matches),
                            'matches': matches
                        })
                        total_matches += len(matches)
            finally:
                conn.close()

        ctx.send_json({
            'ok': True,
            'results': results,
            'keywords': kw_list,
            'sessions_searched': sessions_searched,
            'sessions_matched': len(results),
            'total_matches': total_matches,
            'match_mode': match_mode,
            'role': role
        })
    except Exception as e:
        ctx.send_error(str(e))
