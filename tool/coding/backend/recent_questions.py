#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""recent_questions - 查询最近用户提问"""
import os, json, time, re
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'recent_questions'

# 噪音消息关键词（短消息时匹配）
_NOISE_WORDS = [
    '刷新', '继续', '好的', '嗯', '好', '对', '是的', '了解', '明白',
    '收到', '可以', '没问题', 'ok', 'OK', 'Ok', '行', '收到',
    '继续生成', '继续写', '继续说', '接着说', '再来', '还有吗',
    '谢谢', '感谢', '多谢', '辛苦了', '好的好的', '好好好',
    '嗯嗯', '哈哈', '呵呵', '666', '牛', '厉害',
]


def _is_noise(content):
    """判断是否为噪音消息"""
    if not content:
        return True
    text = str(content).strip()
    if not text:
        return True
    # 短消息（<=6字）才做噪音过滤
    if len(text) <= 6:
        lower = text.lower()
        for pat in _NOISE_WORDS:
            if pat.lower() in lower:
                return True
    return False


def handle(body, ctx):
    """处理工具请求"""
    try:
        keyword = body.get('keyword', '')
        regex = body.get('regex', False)
        limit = body.get('limit', 100)
        offset = body.get('offset', 0)
        session_id = body.get('session_id', '')
        session_ids = body.get('session_ids', None)
        filter_noise = body.get('filter_noise', True)

        if not isinstance(limit, int) or limit < 1:
            limit = 100
        if not isinstance(offset, int) or offset < 0:
            offset = 0

        # 构建要搜索的 session_id 列表
        if session_ids and isinstance(session_ids, list):
            sid_list = [s for s in session_ids if s]
        elif session_id:
            sid_list = [session_id]
        else:
            sid_list = None  # 搜索全部

        # 编译正则表达式
        regex_pattern = None
        if regex and keyword:
            try:
                regex_pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                ctx.send_error('无效的正则表达式: ' + keyword)
                return

        with ctx.db_lock:
            conn = ctx.get_db()
            try:
                cur = conn.cursor()

                # 查询所有 user 消息（按 id 倒序，最新的在前）
                if sid_list:
                    placeholders = ','.join('?' for _ in sid_list)
                    cur.execute(
                        'SELECT id, session_id, content FROM chat_history '
                        "WHERE role = 'user' AND session_id IN (" + placeholders + ') '
                        'ORDER BY id DESC',
                        tuple(sid_list)
                    )
                else:
                    cur.execute(
                        "SELECT id, session_id, content FROM chat_history "
                        "WHERE role = 'user' ORDER BY id DESC"
                    )

                rows = cur.fetchall()

                # 统计搜索的 session 数量
                sessions_searched = len(set(r['session_id'] for r in rows))

                # 批量获取 session 标题
                all_sids = set(r['session_id'] for r in rows)
                sid_title_map = {}
                if all_sids:
                    ph = ','.join('?' for _ in all_sids)
                    cur.execute(
                        'SELECT id, name FROM sessions WHERE id IN (' + ph + ')',
                        tuple(all_sids)
                    )
                    for r in cur.fetchall():
                        sid_title_map[r['id']] = r['name']
            finally:
                conn.close()

        # 过滤和收集
        all_questions = []
        for row in rows:
            content = row['content'] or ''

            # 噪音过滤
            if filter_noise and _is_noise(content):
                continue

            # 关键词匹配
            if keyword:
                if regex and regex_pattern:
                    if not regex_pattern.search(content):
                        continue
                else:
                    if keyword.lower() not in content.lower():
                        continue

            sid = row['session_id']
            all_questions.append({
                'session_id': sid,
                'session_title': sid_title_map.get(sid, sid),
                'content': content
            })

        total_found = len(all_questions)
        # 分页
        paged = all_questions[offset:offset + limit]
        has_more = (offset + limit) < total_found
        next_offset = offset + limit if has_more else total_found

        ctx.send_json({
            'ok': True,
            'questions': paged,
            'keyword': keyword,
            'regex': regex,
            'sessions_searched': sessions_searched,
            'filter_noise': filter_noise,
            'has_more': has_more,
            'next_offset': next_offset,
            'returned': len(paged),
            'total_found': total_found
        })
    except Exception as e:
        ctx.send_error(str(e))
