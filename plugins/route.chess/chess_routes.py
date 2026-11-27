# -*- coding: utf-8 -*-
"""i棋域路由（T2.4 批量·自包含域逐字节插件化，源=domain_chess.py；
实现体本就在域文件内，零 mixin 耦合）。i棋三合一：五子棋/象棋/围棋。

POST /api/chess/move  {game: 'gomoku'|'cchess'|'go', board?, moves?, side, difficulty}
  - 无状态：board 全量传入 + moves 历史重放（v1.2 修订①）
  - 返回 {ok, move, over?, pass?, err?}

moves 元素：象棋/五子棋 [fx,fy,tx,ty]；围棋 {x,y,color,captured?}
"""
import sys, os
# 插件版路径适配：本文件位于 plugins/route.chess/，引擎真源在 server/chess_engine
_ENG = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'chess_engine'))
if _ENG not in sys.path:
    sys.path.insert(0, _ENG)

from routes.dispatcher import route_post
import gomoku
import cchess
import go_engine


def _bad(handler, msg, code=400):
    return handler._send_json({'ok': False, 'err': msg}, code)


def _init_board(game):
    if game == 'gomoku':
        return gomoku._new_board()
    if game == 'cchess':
        return cchess.initial_board()
    return [[0] * go_engine.SIZE for _ in range(go_engine.SIZE)]


@route_post('/api/chess/move')
def _chess_move(handler, path, parsed):
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    if not isinstance(body, dict):
        return _bad(handler, 'bad body')

    game = str(body.get('game') or '')
    difficulty = int(body.get('difficulty') or 2)
    side = int(body.get('side') or 1)
    board = body.get('board')
    moves = body.get('moves') or []
    if game not in ('gomoku', 'cchess', 'go'):
        return _bad(handler, 'unknown game: %s' % game)

    try:
        if isinstance(board, list) and board:
            play = [list(map(int, row)) for row in board]
        else:
            play = _init_board(game)

        if game == 'gomoku':
            mv = gomoku.best_move(play, side, difficulty=difficulty, time_budget_ms=500)
            if mv is None:
                return handler._send_json({'ok': True, 'move': None, 'over': True})
            return handler._send_json({'ok': True, 'move': list(mv[:2])})

        if game == 'cchess':
            if moves:
                play, next_side = cchess.replay(cchess.initial_board(),
                                                [tuple(map(int, m)) for m in moves], 1)
                side = next_side
            mv = cchess.best_move(play, side, difficulty=difficulty, time_budget_ms=800)
            if mv is None:
                return handler._send_json({'ok': True, 'move': None, 'over': True})
            return handler._send_json({'ok': True, 'move': list(mv)})

        # go（真源=moves 重放；前端传的 board 已含落子，若再用会「占位」冲突 → 弃用，从空盘重放）
        play = [[0] * go_engine.SIZE for _ in range(go_engine.SIZE)]
        ko = None
        if moves:
            norm = [{'x': int(m['x']), 'y': int(m['y']), 'color': int(m['color']),
                     'captured': m.get('captured')} for m in moves]
            play, ko, err = go_engine.replay(play, norm)
            if err:
                return _bad(handler, err)
        mv = go_engine.best_move(play, side, ko_point=ko, difficulty=difficulty)
        if mv is None:
            return handler._send_json({'ok': True, 'move': None, 'pass': True})
        return handler._send_json({'ok': True, 'move': list(mv)})
    except ValueError as e:
        return _bad(handler, str(e))
    except Exception as e:
        return _bad(handler, '%s engine error: %s' % (game, e), 500)


@route_post('/api/chess/score')
def _chess_score(handler, path, parsed):
    """围棋终局粗略数子。"""
    try:
        body = handler._read_json()
    except Exception:
        return _bad(handler, 'bad json body')
    board = body.get('board')
    if not isinstance(board, list):
        return _bad(handler, 'need board')
    return handler._send_json({'ok': True, **go_engine.result(board)})
