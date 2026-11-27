# -*- coding: utf-8 -*-
"""
go_engine.py — i棋类·围棋 9 路规则陪练 M2（策划案 v1.2：先规则陪练降级，防每步>2秒）
- 9x9 棋盘，禁入点（自杀除非提子）、劫争（简单劫：禁止立即回提）正确
- 终局粗略数子（仅数空+子，不作复杂死活判定，标注"粗略"）
- AI 策略：确定性规则启发（提吃>逃 Liberty=1 的己子>扩大地盘随机偏向角/星位）
- 无状态：board 全量传入（list[list[int]] 0空 1黑 2白），moves 历史含 ko 检查所需上一手
"""
import random

SIZE = 9

def _neighbors(x, y):
    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
        nx, ny = x+dx, y+dy
        if 0 <= nx < SIZE and 0 <= ny < SIZE:
            yield nx, ny

def _group(board, x, y):
    """返回 (群点set, 气数)。"""
    color = board[y][x]
    seen = {(x, y)}
    stack = [(x, y)]
    libs = set()
    while stack:
        cx, cy = stack.pop()
        for nx, ny in _neighbors(cx, cy):
            v = board[ny][nx]
            if v == 0:
                libs.add((nx, ny))
            elif v == color and (nx, ny) not in seen:
                seen.add((nx, ny))
                stack.append((nx, ny))
    return seen, len(libs)

def _would_capture(board, x, y, color):
    """假想 color 在 (x,y) 落子后会被提走的对方群点集合。"""
    b = [row[:] for row in board]
    b[y][x] = color
    opp = 3 - color
    captured = set()
    for nx, ny in _neighbors(x, y):
        if b[ny][nx] == opp:
            g, libs = _group(b, nx, ny)
            if libs == 0:
                captured |= g
    return captured

def is_valid_move(board, x, y, color, ko_point=None):
    """禁入点/占位/劫争校验。ko_point: (x,y) 上手单提产生的劫点。"""
    if not (0 <= x < SIZE and 0 <= y < SIZE) or board[y][x] != 0:
        return False, "占位或越界"
    if ko_point and (x, y) == tuple(ko_point):
        return False, "劫争：禁立即回提"
    captured = _would_capture(board, x, y, color)
    if not captured:
        # 无提子则必须落子后有气
        b = [row[:] for row in board]
        b[y][x] = color
        g, libs = _group(b, x, y)
        if libs == 0:
            return False, "禁入点（自杀）"
    return True, ""

def apply_move(board, x, y, color):
    """落子并提子。返回被提点列表（用于前端渲染与劫点计算）。"""
    board[y][x] = color
    opp = 3 - color
    captured = []
    for nx, ny in _neighbors(x, y):
        if board[ny][nx] == opp:
            g, libs = _group(board, nx, ny)
            if libs == 0:
                for (gx, gy) in g:
                    board[gy][gx] = 0
                    captured.append((gx, gy))
    return captured

def compute_ko_point(board, prev_move, prev_captured):
    """简单劫：上一手恰提1子且落下的群是单子单气 → 劫点为被提位置。"""
    if not prev_move or prev_captured is None or len(prev_captured) != 1:
        return None
    fx, fy = prev_move
    if board[fy][fx] != 0:
        g, libs = _group(board, fx, fy)
        if len(g) == 1 and libs == 1:
            (cx, cy) = prev_captured[0]
            return (cx, cy)
    return None

def replay(board, moves):
    """重放 moves=[{x,y,color,captured?}]，返回 (board, ko_point, err)。"""
    ko = None
    for i, m in enumerate(moves):
        x, y, color = m["x"], m["y"], m["color"]
        ok, why = is_valid_move(board, x, y, color, ko)
        if not ok:
            return None, None, "第%d手非法: %s" % (i+1, why)
        cap = apply_move(board, x, y, color)
        ko = compute_ko_point(board, (x, y), cap)
    return board, ko, ""

def _score_board(board):
    """粗略数子：子数1分+只被己色包围的空点1分（不给贴目/死活精判）。"""
    black = white = 0
    for y in range(SIZE):
        for x in range(SIZE):
            if board[y][x] == 1:
                black += 1
            elif board[y][x] == 2:
                white += 1
    for y in range(SIZE):
        for x in range(SIZE):
            if board[y][x] != 0:
                continue
            seen = set()
            stack = [(x, y)]
            region = []
            borders = set()
            ok = True
            while stack:
                cx, cy = stack.pop()
                if (cx, cy) in seen:
                    continue
                seen.add((cx, cy))
                region.append((cx, cy))
                for nx, ny in _neighbors(cx, cy):
                    v = board[ny][nx]
                    if v == 0:
                        if (nx, ny) not in seen:
                            stack.append((nx, ny))
                    else:
                        borders.add(v)
            if len(borders) == 1:
                if 1 in borders:
                    black += len(region)
                elif 2 in borders:
                    white += len(region)
    return black, white

def best_move(board, color, ko_point=None, difficulty=2):
    """规则启发 AI：
    ①能提吃→提 ②己群单气→逃（能逃则逃）③打吃对方可提点 ④星位/三三附近 randomly weighted
    返回 (x,y) 或 None（无点可下=停一手）。"""
    empties = [(x, y) for y in range(SIZE) for x in range(SIZE) if board[y][x] == 0]
    cand = []
    for (x, y) in empties:
        ok, _ = is_valid_move(board, x, y, color, ko_point)
        if not ok:
            continue
        cap = _would_capture(board, x, y, color)
        # 落子后自己的气
        b = [row[:] for row in board]
        b[y][x] = color
        for (gx, gy) in cap:
            b[gy][gx] = 0
        g, libs = _group(b, x, y)
        w = 1
        if cap:
            w += 100 + len(cap) * 10
        if libs == 1:
            w -= 50  # 自填死不优先
        # 逃被叫吃的己群
        for nx, ny in _neighbors(x, y):
            if board[ny][nx] == color:
                gg, ll = _group(board, nx, ny)
                if ll == 1 and (x, y) in set() or ll == 1:
                    w += 60
                    break
        # 打吃（对方群将只剩1气）
        for nx, ny in _neighbors(x, y):
            if board[ny][nx] == 3 - color:
                b2 = [row[:] for row in board]
                b2[y][x] = color
                for (gx, gy) in cap:
                    b2[gy][gx] = 0
                gg, ll = _group(b2, nx, ny)
                if ll == 1:
                    w += 30
                    break
        # 布局偏好：星位/角/三线
        if (x, y) in ((2,2),(6,2),(2,6),(6,6),(4,4)):
            w += 8
        if x in (2,4,6) and y in (2,4,6):
            w += 3
        cand.append((w, x, y))
    if not cand:
        return None
    cand.sort(reverse=True)
    top = cand[: min(len(cand), 6 if difficulty >= 3 else (3 if difficulty == 2 else 1))]
    w, x, y = random.choice(top) if difficulty >= 2 else top[0]
    return (x, y)

def result(board):
    """终局粗略数子。"""
    b, w = _score_board(board)
    return {"black": b, "white": w, "note": "粗略数子（不含贴目与死活精判）"}
