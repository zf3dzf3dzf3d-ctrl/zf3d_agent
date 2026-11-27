# -*- coding: utf-8 -*-
"""
cchess.py — i棋类·中国象棋引擎 M2（策划案 v1.2）
- 10x9 棋盘，行0=黑方底线（上），行9=红方底线（下）
- 红方(1)在下，黑方(2)在上；红先
- 规则校验：蹩马腿/塞象眼/将帅不照面/各子走法；长将判负逻辑简化为不主动长将
- 搜索：α-β 浅搜(2层)+子力价值+位置粗分，500ms 预算
- 无状态：board 全量传入（list[list[int]]，0空 1红 2黑），AI 执 side
- 纯 Python 无依赖
"""
import time

ROWS, COLS = 10, 9
RED, BLACK = 1, 2

# 子力编码：1帅 2士 3象 4马 5车 6炮 7兵（红）/ 同数字+10 表示黑方同种
# 简化：用 piece 类型 = p % 10（1..7），颜色 = p // 10（0红 1黑）；0为空
# 为兼容前端约定：红方 11..17，黑方 21..27，0空

VAL = {1: 6000, 2: 600, 3: 600, 4: 1200, 5: 2400, 6: 1500, 7: 300}

def initial_board():
    """返回初始局面。行0在顶部（黑），行9在底部（红）。"""
    b = [[0] * COLS for _ in range(ROWS)]
    # 黑方（上，行0）
    back = [25, 24, 23, 22, 21, 22, 23, 24, 25]  # 车马象士帅士象马车
    b[0] = back[:]
    b[2][1] = b[2][7] = 26
    for c in range(0, 9, 2):
        b[3][c] = 27
    # 红方（下，行9）
    b[9] = [p - 10 for p in back]
    b[7][1] = b[7][7] = 16
    for c in range(0, 9, 2):
        b[6][c] = 17
    return b

def _color(p):
    return 0 if p < 20 else 1  # 0红 1黑

def _side_num(side):
    """side: 1红 2黑 → 颜色索引"""
    return side - 1

def _in_board(x, y):
    return 0 <= x < COLS and 0 <= y < ROWS

def _in_palace(x, y, color):
    if x < 3 or x > 5:
        return False
    return (0 <= y <= 2) if color == 1 else (7 <= y <= 9)

def _own_half(y, color):
    return (y <= 4) if color == 1 else (y >= 5)

def _find_king(board, color):
    tgt = 11 if color == 0 else 21
    for y in range(10):
        for x in range(9):
            if board[y][x] == tgt:
                return (x, y)
    return None

def gen_moves(board, color):
    """生成 color 全部伪合法着法 [(fx,fy,tx,ty)]，已过滤送帅/照面。"""
    moves = []
    for y in range(10):
        for x in range(9):
            p = board[y][x]
            if p == 0 or _color(p) != color:
                continue
            t = p % 10
            if t == 1:  # 帅
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if _in_palace(nx, ny, color):
                        moves.append((x, y, nx, ny))
            elif t == 2:  # 士
                for dx, dy in ((1,1),(1,-1),(-1,1),(-1,-1)):
                    nx, ny = x+dx, y+dy
                    if _in_palace(nx, ny, color):
                        moves.append((x, y, nx, ny))
            elif t == 3:  # 象
                for dx, dy in ((2,2),(2,-2),(-2,2),(-2,-2)):
                    nx, ny = x+dx, y+dy
                    ex, ey = x+dx//2, y+dy//2
                    if _in_board(nx, ny) and _own_half(ny, color) and board[ey][ex] == 0:
                        moves.append((x, y, nx, ny))
            elif t == 4:  # 马
                for dx, dy in ((1,2),(2,1),(2,-1),(1,-2),(-1,-2),(-2,-1),(-2,1),(-1,2)):
                    nx, ny = x+dx, y+dy
                    lx, ly = x + (1 if abs(dx)==2 else 0), y + (1 if abs(dy)==2 else 0)
                    if abs(dx) == 2:
                        lx, ly = x + dx//2, y
                    else:
                        lx, ly = x, y + dy//2
                    if _in_board(nx, ny) and board[ly][lx] == 0:
                        moves.append((x, y, nx, ny))
            elif t == 5:  # 车
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    while _in_board(nx, ny):
                        if board[ny][nx] == 0:
                            moves.append((x, y, nx, ny))
                        else:
                            if _color(board[ny][nx]) != color:
                                moves.append((x, y, nx, ny))
                            break
                        nx += dx; ny += dy
            elif t == 6:  # 炮
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    jumped = False
                    while _in_board(nx, ny):
                        if not jumped:
                            if board[ny][nx] == 0:
                                moves.append((x, y, nx, ny))
                            else:
                                jumped = True
                        else:
                            if board[ny][nx] != 0:
                                if _color(board[ny][nx]) != color:
                                    moves.append((x, y, nx, ny))
                                break
                        nx += dx; ny += dy
            elif t == 7:  # 兵
                fwd = -1 if color == 0 else 1  # 红向上
                nx, ny = x, y+fwd
                if _in_board(nx, ny):
                    moves.append((x, y, nx, ny))
                if not _own_half(y, color):  # 过河
                    for dx in (-1, 1):
                        nx = x+dx
                        if _in_board(nx, y):
                            moves.append((x, y, nx, y+0) if False else (x, y, nx, y))
    # 过滤吃己方子
    legal = []
    for (fx, fy, tx, ty) in moves:
        tp = board[ty][tx]
        if tp != 0 and _color(tp) == color:
            continue
        legal.append((fx, fy, tx, ty))
    # 过滤送帅：走完后自己被将或将帅照面
    out = []
    for m in legal:
        fx, fy, tx, ty = m
        saved = board[ty][tx]
        board[ty][tx] = board[fy][fx]
        board[fy][fx] = 0
        if not _in_check(board, color):
            out.append(m)
        board[fy][fx] = board[ty][tx]
        board[ty][tx] = saved
    return out

def _in_check(board, color):
    """color 的帅是否被攻击或将帅照面。"""
    k = _find_king(board, color)
    if not k:
        return True
    kx, ky = k
    # 将帅照面
    ek = _find_king(board, 1 - color)
    if ek and ek[0] == kx:
        clear = True
        for yy in range(min(ek[1], ky)+1, max(ek[1], ky)):
            if board[yy][kx] != 0:
                clear = False
                break
        if clear:
            return True
    # 被任一敌子攻击：生成敌伪着看是否吃帅（性能可接受：棋子少）
    opp = 1 - color
    for y in range(10):
        for x in range(9):
            p = board[y][x]
            if p == 0 or _color(p) != opp:
                continue
            if _attacks(board, x, y, p, kx, ky):
                return True
    return False

def _attacks(board, x, y, p, tx, ty):
    """(x,y) 的子 p 能否一步吃到 (tx,ty)（不考虑蹩腿以外保护，含蹩腿/塞象眼）。"""
    t = p % 10
    dx, dy = tx - x, ty - y
    color = _color(p)
    if t == 1:
        return _in_palace(tx, ty, color) and abs(dx)+abs(dy) == 1
    if t == 2:
        return _in_palace(tx, ty, color) and abs(dx) == 1 and abs(dy) == 1
    if t == 3:
        if abs(dx) != 2 or abs(dy) != 2:
            return False
        if not _own_half(ty, color):
            return False
        return board[y+dy//2][x+dx//2] == 0
    if t == 4:
        if (abs(dx), abs(dy)) not in ((1,2),(2,1)):
            return False
        if abs(dx) == 2:
            lx, ly = x+dx//2, y
        else:
            lx, ly = x, y+dy//2
        return board[ly][lx] == 0
    if t == 5:
        if dx != 0 and dy != 0:
            return False
        sx = 0 if dx == 0 else (1 if dx > 0 else -1)
        sy = 0 if dy == 0 else (1 if dy > 0 else -1)
        cx, cy = x+sx, y+sy
        while (cx, cy) != (tx, ty):
            if board[cy][cx] != 0:
                return False
            cx += sx; cy += sy
        return True
    if t == 6:
        if dx != 0 and dy != 0:
            return False
        sx = 0 if dx == 0 else (1 if dx > 0 else -1)
        sy = 0 if dy == 0 else (1 if dy > 0 else -1)
        cx, cy = x+sx, y+sy
        screen = 0
        while (cx, cy) != (tx, ty):
            if board[cy][cx] != 0:
                screen += 1
                if screen > 1:
                    return False
            cx += sx; cy += sy
        return screen == 1
    if t == 7:
        fwd = -1 if color == 0 else 1
        if dx == 0 and dy == fwd:
            return True
        if not _own_half(y, color) and abs(dx) == 1 and dy == 0:
            return True
        return False
    return False

def is_valid_move(board, fx, fy, tx, ty, color):
    for (a, b, c, d) in gen_moves(board, color):
        if (a, b, c, d) == (fx, fy, tx, ty):
            return True
    return False

def apply_move(board, fx, fy, tx, ty):
    board[ty][tx] = board[fy][fx]
    board[fy][fx] = 0

def check_gameover(board, color_to_move):
    """color_to_move 无合法着 → 被将死/困毙，输。"""
    if not gen_moves(board, color_to_move):
        return True
    if not _find_king(board, color_to_move - 1):
        return True
    return False

def _eval(board, color):
    """粗评估：子力+过河兵加分，从 color 视角。"""
    score = 0
    for y in range(10):
        for x in range(9):
            p = board[y][x]
            if p == 0:
                continue
            c = _color(p)
            t = p % 10
            v = VAL[t]
            if t == 7:
                crossed = (y <= 4) if c == 0 else (y >= 5)
                if crossed:
                    v += 200
            score += v if c == color else -v
    return score

def _alphabeta(board, depth, alpha, beta, color, deadline):
    if time.time() > deadline:
        return _eval(board, color)
    moves = gen_moves(board, color)
    if not moves:
        return -100000 + (2 - depth)  # 被将死
    if depth <= 0:
        return _eval(board, color)
    best = -10**9
    # 吃子优先排序
    moves.sort(key=lambda m: -VAL.get(board[m[3]][m[2]] % 10, 0) if board[m[3]][m[2]] else 0)
    for (fx, fy, tx, ty) in moves:
        saved = board[ty][tx]
        apply_move(board, fx, fy, tx, ty)
        val = -_alphabeta(board, depth-1, -beta, -alpha, 1-color, deadline)
        board[fy][fx] = board[ty][tx]
        board[ty][tx] = saved
        if val > best:
            best = val
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
        if time.time() > deadline:
            break
    return best

def best_move(board, side, difficulty=2, time_budget_ms=500):
    """AI 执 side(1红/2黑) 找最佳着。返回 (fx,fy,tx,ty) 或 None。"""
    color = side - 1
    deadline = time.time() + time_budget_ms / 1000.0
    moves = gen_moves(board, color)
    if not moves:
        return None
    depth = 1 if difficulty <= 1 else (2 if difficulty == 2 else 3)
    best, best_m = -10**9, moves[0]
    moves.sort(key=lambda m: -VAL.get(board[m[3]][m[2]] % 10, 0) if board[m[3]][m[2]] else 0)
    for (fx, fy, tx, ty) in moves:
        saved = board[ty][tx]
        apply_move(board, fx, fy, tx, ty)
        val = -_alphabeta(board, depth-1, -10**9, 10**9, 1-color, deadline)
        board[fy][fx] = board[ty][tx]
        board[ty][tx] = saved
        if time.time() > deadline:
            break
        if val > best:
            best, best_m = val, (fx, fy, tx, ty)
    return best_m

def replay(board, moves, start_side):
    """重放 moves 历史（v1.2 修订：接口传 moves），返回最终局面与下一手颜色。
    moves: [[fx,fy,tx,ty],...]；start_side: 1红先。非法即抛 ValueError。"""
    side = start_side
    for i, m in enumerate(moves):
        fx, fy, tx, ty = m
        color = side - 1
        if not is_valid_move(board, fx, fy, tx, ty, color):
            raise ValueError("第%d手非法: %s" % (i+1, m))
        apply_move(board, fx, fy, tx, ty)
        side = 3 - side
    return board, side
