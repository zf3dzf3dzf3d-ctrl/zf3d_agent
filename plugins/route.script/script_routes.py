# -*- coding: utf-8 -*-
"""i剧本杀域路由（P1 最小可玩 MVP，策划案 v2.2：手写本单机局）。

GET  /api/script/list                 -> {ok, books:[{id,title,player_count}]}
POST /api/script/start  {book, mode}  -> {ok, session} 开局：
    - session 含 background/intro/scenes/clues(公开部分)/characters(公开人设)
    - 凶手身份与 secret 不下发（防泄底：MVP 单机局 secret 由前端"我的剧本"按角色取）
POST /api/script/secret {book, char}  -> {ok, secret, knowledge, prewritten}
    - 单机局当前玩家自取自己的隐藏剧本（防泄底靠"只取自己"的客户端纪律 + P2 prompt 裁剪）
POST /api/script/vote   {book, votes} -> {ok, result} 投票判凶（程序确定性判定，LLM 不当裁判）
    - votes: [charId...]；得票最多且 >= 半数 -> 投中；否则凶手逃脱
    - 投中但任务链不全由前端按 v2.2 记 0.5 低质量胜利，此处只判投中与否

剧本落盘 server/script_books/*.json，须经 script_solver.py 校验（启动时不重验，
新增剧本用 CLI：python script_engine/script_solver.py script_books/<name>.json）。
"""
import json
import os
import re
import time

from routes.dispatcher import route_get, route_post

# 插件路径适配（T2.4 批量）：副本位于 plugins/route.script/，重指 __file__ 到源路径，
# 使全部 dirname 链（server/routes → server → 项目根）与源文件语义一致，逻辑零改动
__file__ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'routes', 'domain_script.py')
from script_engine.script_solver import solve
from script_engine.script_ai import ask_npc, gen_book

_BOOKS_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'script_books'))


def _bad(handler, msg, code=400):
    return handler._send_json({'ok': False, 'err': msg}, code)


def _load_book(book_id):
    book_id = str(book_id or '')
    if not book_id or '/' in book_id or '\\' in book_id or '..' in book_id:
        return None
    path = os.path.join(_BOOKS_DIR, book_id + '.json')
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _public_view(book):
    """公开视图：剥掉凶手标记、全部 secret、知识表、隐藏事实。"""
    tl_pub = [f for f in book.get('timeline', []) if not f.get('hidden')]
    return {
        'id': book['id'], 'title': book['title'],
        'intro': book['intro'], 'background': book['background'],
        'scenes': book['scenes'],
        'characters': [{'id': c['id'], 'name': c['name'],
                        'is_victim': c.get('is_victim', False),
                        'persona': c.get('persona', '')}
                       for c in book['characters']],
        'clues': [{'id': c['id'], 'spot': c['spot'], 'name': c['name'],
                   'desc': c['desc']} for c in book['clues']],
        'timeline': tl_pub,
        'win_conditions': book.get('win_conditions', {}),
    }


@route_get('/api/script/list')
def _script_list(handler, path, parsed):
    books = []
    for fn in sorted(os.listdir(_BOOKS_DIR)):
        if not fn.endswith('.json'):
            continue
        try:
            with open(os.path.join(_BOOKS_DIR, fn), 'r', encoding='utf-8') as f:
                b = json.load(f)
            books.append({'id': b.get('id'), 'title': b.get('title'),
                          'player_count': b.get('player_count')})
        except Exception:
            continue
    return handler._send_json({'ok': True, 'books': books})


@route_post('/api/script/start')
def _script_start(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    book = _load_book((body or {}).get('book'))
    if not book:
        return _bad(handler, 'book not found')
    errs = solve(book)  # 开局时兜底再验一次，拒绝不可解剧本上桌
    if errs:
        return _bad(handler, 'book rejected by solver: ' + '; '.join(errs[:3]))
    return handler._send_json({'ok': True, 'session': _public_view(book)})


@route_post('/api/script/secret')
def _script_secret(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    book = _load_book((body or {}).get('book'))
    if not book:
        return _bad(handler, 'book not found')
    cid = str((body or {}).get('char') or '')
    for c in book['characters']:
        if c['id'] == cid:
            return handler._send_json({
                'ok': True, 'name': c['name'],
                'secret': c.get('secret', ''),
                'knowledge': c.get('knowledge', []),
                'prewritten': c.get('prewritten', []),
                'is_murderer': bool(c.get('is_murderer')),
            })
    return _bad(handler, 'unknown char: %s' % cid)


@route_post('/api/script/vote')
def _script_vote(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    book = _load_book((body or {}).get('book'))
    if not book:
        return _bad(handler, 'book not found')
    votes = (body or {}).get('votes') or []
    char_ids = {c['id'] for c in book['characters']}
    votes = [v for v in votes if v in char_ids]
    if not votes:
        return _bad(handler, 'no valid votes')
    murderer = next((c['id'] for c in book['characters'] if c.get('is_murderer')), None)
    tally = {}
    for v in votes:
        tally[v] = tally.get(v, 0) + 1
    top_id, top_n = max(tally.items(), key=lambda kv: kv[1])
    n_players = len(votes)
    half = n_players // 2 + (n_players % 2)  # >= 严格过半
    hit = (top_n >= half and top_id == murderer)
    return handler._send_json({
        'ok': True,
        'result': 'hit' if hit else 'escape',
        'murderer': murderer,
        'tally': tally,
        'hit': hit,
    })


# ==================== P2 AI 设施包路由 ====================

@route_post('/api/script/ask')
def _script_ask(handler, path, parsed):
    """NPC 扮演问答：{book, char, question} -> {ok, text, mode}
    防泄底：服务端每问独立 prompt 裁剪（只给该角色 knowledge + 公开信息），
    生成侧再过 _leak_check，命中即降级预写台词。LLM 不下发任何隐藏剧本。"""
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    book = _load_book((body or {}).get('book'))
    if not book:
        return _bad(handler, 'book not found')
    cid = str((body or {}).get('char') or '')
    char = next((c for c in book['characters'] if c['id'] == cid), None)
    if not char:
        return _bad(handler, 'unknown char: %s' % cid)
    text, mode = ask_npc(book, char, (body or {}).get('question'))
    return handler._send_json({'ok': True, 'text': text, 'mode': mode})


_AI_STATS = {'gen': 0, 'pass': 0}   # 进程级一次通过率观测（40% 降级线）


@route_post('/api/script/gen')
def _script_gen(handler, path, parsed):
    """AI 槽位填本：{theme, difficulty} -> {ok, book, source}
    source: ai=LLM 本通过 Solver | template=降级模板拼装 | fail。
    一次通过率 <40% 自动走 template（策划案 v2.1 降级线）。"""
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    theme = str((body or {}).get('theme') or '').strip()[:30]
    diff = str((body or {}).get('difficulty') or '中等').strip()[:10]
    if not theme:
        return _bad(handler, 'theme required')
    book, source = gen_book(theme, diff, _AI_STATS)
    if not book:
        return _bad(handler, 'gen failed: solver rejected even template')
    if source == 'ai':
        # AI 本落盘书架，立即注册为可玩剧本（文件名 ai_ 前缀便于识别/清理）
        safe = re.sub(r'[^a-z0-9_]', '', str(book.get('id') or ''))[:40] or (
            'ai_gen_' + str(int(time.time()) % 1000000))
        book['id'] = safe
        try:
            with open(os.path.join(_BOOKS_DIR, safe + '.json'), 'w',
                      encoding='utf-8') as f:
                json.dump(book, f, ensure_ascii=False, indent=1)
        except Exception:
            pass  # 落盘失败不影响本局，返回给前端即玩
    return handler._send_json({'ok': True, 'book': book, 'source': source})
