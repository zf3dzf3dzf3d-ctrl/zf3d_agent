# -*- coding: utf-8 -*-
"""
selfplay_gate.py — i棋类 M1 硬闸门：五子棋自对弈 100 局无非法着法（限定时间预算）
用法: python server/chess_engine/selfplay_gate.py [局数]
通过标准: 全部局数内双方每步均为合法空点、无越界、无重复落子、可正常分出胜负或和棋。
"""
import sys, os, time
from util_log import get_logger

log = get_logger('selfplay_gate')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gomoku as G

def play_one(seed_idx, budget_ms):
    import random
    rnd = random.Random(seed_idx)  # 每局独立种子：首手扰动，保证100局互不重复
    b = G._new_board()
    side = 1
    moves = []
    fx = 7 + rnd.randint(-2, 2)
    fy = 7 + rnd.randint(-2, 2)
    first = (fx, fy)
    b[fy][fx] = 1
    moves.append(first)
    side = 2
    t0 = time.time()
    while True:
        mv = G.best_move(b, side, time_budget_ms=budget_ms, difficulty=2)
        if mv is None:
            return 'draw', moves, time.time() - t0
        x, y = mv
        if not G.is_valid_move(b, x, y):
            raise AssertionError('非法着法: %s side=%d moves=%d' % (mv, side, len(moves)))
        if mv in moves:
            raise AssertionError('重复落子: %s' % (mv,))
        b[y][x] = side
        moves.append(mv)
        if G.check_win(b, side):
            return side, moves, time.time() - t0
        if len(moves) >= 225:
            return 'draw', moves, time.time() - t0
        side = 3 - side

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    offset = int(sys.argv[2]) if len(sys.argv) > 2 else 0  # 种子偏移：分批跑时保证局局不同
    budget = 120  # 自对弈每步 120ms 预算（闸门专用，控制总时长）
    wins = {1: 0, 2: 0, 'draw': 0}
    t0 = time.time()
    for i in range(n):
        r, moves, dur = play_one(i + offset, budget)
        wins[r] = wins.get(r, 0) + 1
        if (i + 1) % 10 == 0:
            log.info('progress %d/%d  last game: %d moves %.1fs' % (i + 1, n, len(moves), dur))
    total_t = time.time() - t0
    log.info('GATE RESULT: %d games, illegal=0, wins B%d W%d draw%d, total %.1fs' % (
        n, wins[1], wins[2], wins['draw'], total_t))
    log.info('PASS' if n > 0 else 'FAIL')

if __name__ == '__main__':
    main()
