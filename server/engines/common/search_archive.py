# -*- coding: utf-8 -*-
"""
search_archive —— 历史工具结果存档关键词搜索（v5.4.6）
扫描 private/tool_result_archive/*.json，按关键词匹配原文，返回片段（≤20条、单片≤500字）。
配合 agent_loop 的工具结果打回存档使用：被 reject 的原文模型可用本工具按关键词找回，
无需精确知道存档 ID / 路径。
"""
import os
import re
import json
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.normpath(os.path.join(_DIR, '..', '..', 'private', 'tool_result_archive'))
MAX_HITS = int(os.environ.get('ZF_SEARCH_ARCHIVE_MAX', '20'))
SNIPPET_LEN = 500

TOOL_SCHEMA = {
    'name': 'search_archive',
    'description': ('按关键词搜索历史工具结果存档（被丢弃的超长工具输出原文）。'
                    '返回片段及存档文件路径，可用 read_file/path 精确取回原文。'),
    'input_schema': {
        'type': 'object',
        'properties': {
            'keyword': {'type': 'string', 'description': '关键词（支持正则）'},
            'tool': {'type': 'string', 'description': '可选，按工具名过滤，如 read_file'},
        },
        'required': ['keyword'],
    },
}


def _snippets(text, kw, limit=SNIPPET_LEN):
    """返回关键词命中片段，单片 limit 字。"""
    out = []
    try:
        for m in re.finditer(kw, text or '', re.IGNORECASE):
            s = max(0, m.start() - 60)
            frag = (text[s:m.end() + limit - 60]).replace('\n', ' ')
            out.append(frag[:limit])
            if len(out) >= 3:
                break
    except re.error:
        if kw in (text or ''):
            i = text.index(kw)
            out.append(text[max(0, i - 60):i + limit][:limit])
    return out


def search_archive(keyword, tool=None):
    """搜索存档库，返回 dict（_ok/结果列表）。"""
    if not keyword or not str(keyword).strip():
        return {'_ok': False, 'error': 'keyword 不能为空'}
    hits = []
    if not os.path.isdir(ARCHIVE_DIR):
        return {'_ok': True, 'hits': [], 'note': '存档目录不存在（尚无被打回的工具结果）'}
    files = sorted((f for f in os.listdir(ARCHIVE_DIR) if f.endswith('.json')),
                   key=lambda f: os.path.getmtime(os.path.join(ARCHIVE_DIR, f)), reverse=True)
    for fn in files:
        if len(hits) >= MAX_HITS:
            break
        p = os.path.join(ARCHIVE_DIR, fn)
        try:
            with open(p, 'r', encoding='utf-8-sig') as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if tool and str(d.get('tool') or '') != tool:
            continue
        raw = str(d.get('content') or d.get('result') or '')
        if keyword not in raw:
            snips = _snippets(raw, str(keyword))
        else:
            i = raw.index(keyword)
            snips = [raw[max(0, i - 60):i + SNIPPET_LEN].replace('\n', ' ')[:SNIPPET_LEN]]
        if snips:
            hits.append({'file': os.path.basename(p), 'path': p,
                         'tool': d.get('tool'), 'time': time.strftime(
                             '%m-%d %H:%M', time.localtime(os.path.getmtime(p))),
                         'snippets': snips})
    return {'_ok': True, 'total_hits': len(hits),
            'note': '更多请缩小关键词；原文可用 read_file 按 path 分片读取',
            'hits': hits[:MAX_HITS]}


def run(args):
    """agent 工具入口"""
    a = args or {}
    return search_archive(str(a.get('keyword') or ''), a.get('tool'))
