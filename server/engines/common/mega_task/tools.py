# -*- coding: utf-8 -*-
"""tools.py —— mega 专属两个工具：archive_search / archive_load

刻意不进全局工具注册表，由 router 在 payload 里直接注入，
这样剥离时只删 router 一处 + 本目录即可，不污染现有工具系统。
"""
from . import config
from . import archive


def schemas():
    """Chat Completions 格式的 tools 数组。"""
    return [
        {
            'type': 'function',
            'function': {
                'name': config.TOOL_SEARCH,
                'description':
                    '在超长任务归档中搜索关键词，返回命中轮号与片段。'
                    '需要回顾早期结论、某个文件在哪轮改过、某句话谁说过时使用。',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'keyword': {'type': 'string', 'description': '要搜索的关键词'},
                        'limit': {'type': 'integer', 'description': '最多返回几条，默认 8'},
                    },
                    'required': ['keyword'],
                },
            },
        },
        {
            'type': 'function',
            'function': {
                'name': config.TOOL_LOAD,
                'description':
                    '读取归档中指定轮的完整原文（一字不删）。'
                    '确认某轮细节、复现当时的完整上下文时使用。',
                'parameters': {
                    'type': 'object',
                    'properties': {
                        'turn': {'type': 'integer', 'description': '轮号'},
                        'from_turn': {'type': 'integer', 'description': '可选，起始轮号（含）'},
                        'to_turn': {'type': 'integer', 'description': '可选，结束轮号（含）'},
                    },
                },
            },
        },
    ]


def desc_text():
    """注入 system 的文字说明（L1 层）。"""
    return (
        '【超长任务模式】本对话启用了超长任务归档：所有历史原文已一字不删地'
        '完整存档，但为控制上下文长度，发送给你的只有「归档索引 + 最近 %d 轮原文」。\n\n'
        '你可以使用两个工具取回细节：\n'
        '1. %s(keyword) —— 搜索归档，返回命中轮号和片段；\n'
        '2. %s(turn / from_turn+to_turn) —— 读取指定轮的完整原文。\n\n'
        '重要：索引只是摘要，涉及具体文件内容、代码原文、早期确切结论时，'
        '必须先调用工具查证，不要凭索引臆造。'
        '需要固定关键结论时，在回复末尾单独一行写「CHECKPOINT: <结论>」，'
        '系统会自动把它置顶保存。'
        % (config.RECENT_RAW_TURNS, config.TOOL_SEARCH, config.TOOL_LOAD)
    )


def is_mega_tool(name):
    return str(name or '') in (config.TOOL_SEARCH, config.TOOL_LOAD)


def execute(session_id, name, args):
    """执行工具，返回字符串结果（供拼成 tool 消息回灌）。"""
    args = args or {}
    if name == config.TOOL_SEARCH:
        kw = str(args.get('keyword') or '').strip()
        if not kw:
            return '[archive_search] 缺少 keyword'
        limit = args.get('limit') or config.MAX_ARCHIVE_SEARCH_HITS
        hits = archive.search(session_id, kw, limit)
        if not hits:
            return '[archive_search] 未命中: %s' % kw
        lines = ['[archive_search] 命中 %d 处（关键词 %s）：' % (len(hits), kw)]
        for h in hits:
            lines.append('--- 第 %s 轮 ---\n%s' % (h.get('turn'), h.get('snippet') or ''))
        return '\n'.join(lines)

    if name == config.TOOL_LOAD:
        if args.get('turn') is not None:
            rec = archive.read_turn(session_id, args.get('turn'))
            if not rec:
                return '[archive_load] 无此轮: %s' % args.get('turn')
            return _fmt_turn(rec)
        a = args.get('from_turn')
        b = args.get('to_turn')
        if a is None or b is None:
            return '[archive_load] 需要 turn，或 from_turn + to_turn'
        try:
            a, b = int(a), int(b)
        except Exception:
            return '[archive_load] 轮号必须是整数'
        if b < a:
            a, b = b, a
        if b - a > 20:
            return '[archive_load] 单次最多 20 轮，请缩小范围'
        out = []
        for rec in archive.iter_turns(session_id):
            t = int(rec.get('turn') or 0)
            if a <= t <= b:
                out.append(_fmt_turn(rec))
        if not out:
            return '[archive_load] 范围 #%s-#%s 无记录' % (a, b)
        return _truncate('\n\n'.join(out))

    return '[mega] 未知工具: %s' % name


def _fmt_turn(rec):
    parts = []
    for m in rec.get('messages') or []:
        if not isinstance(m, dict):
            continue
        role = m.get('role')
        c = m.get('content')
        if isinstance(c, str):
            txt = c
        elif isinstance(c, list):
            txt = '\n'.join(
                str(s.get('text') or '') for s in c if isinstance(s, dict)
            )
        else:
            txt = str(c)
        parts.append('[%s] %s' % (role, txt))
    return '===== 第 %s 轮原文 =====\n%s' % (rec.get('turn'), '\n'.join(parts))


def _truncate(text):
    if len(text) <= config.MAX_ARCHIVE_LOAD_CHARS:
        return text
    return text[:config.MAX_ARCHIVE_LOAD_CHARS] + \
        '\n...[超长已截断，剩余 %d 字符，请缩小轮范围]' % (len(text) - config.MAX_ARCHIVE_LOAD_CHARS)


def extract_checkpoint(reply_text):
    """从回复里抽 CHECKPOINT 行，返回 (清洗后的回复, checkpoint或None)。"""
    if not reply_text or 'CHECKPOINT:' not in reply_text:
        return reply_text, None
    lines = str(reply_text).splitlines()
    keep, cps = [], []
    for ln in lines:
        s = ln.strip()
        if s.startswith('CHECKPOINT:'):
            cps.append(s[len('CHECKPOINT:'):].strip())
        else:
            keep.append(ln)
    return '\n'.join(keep).rstrip(), ('\n'.join(cps) if cps else None)
