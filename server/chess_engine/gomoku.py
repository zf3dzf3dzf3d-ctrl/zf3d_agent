# -*- coding: utf-8 -*-
"""
gomoku.py — i棋类·五子棋引擎 M1（策划案 v1.2）
- 15路棋盘，规则AI：活三/冲四/做四检测（确定性规则）+ 启发式打分 + α-β浅层搜索
- time_budget_ms 时间预算（v1.2 反驳师⑤修订：验收须限定预算，默认500ms）
- 无状态：board 全量传入（列表 list[list[int]]，0空 1黑 2白），AI 执 side 落子
- 纯 Python，断网可玩，无第三方依赖
"""
import time

SIZE = 15

def _new_board():
    return [[0] * SIZE for _ in range(SIZE)]

def _in(x, y):
    return 0 <= x < SIZE and 0 <= y < SIZE

DIRS = [(1, 0), (0, 1), (1, 1), (1, -1)]

def check_win(board, side):
    """判定 side 是否已成五连。返回 True/False。"""
    for y in range(SIZE):
        for x in range(SIZE):
            if board[y][x] != side:
                continue
            for dx, dy in DIRS:
                # 只以该子为起点向正向查（避免重复）
                px, py = x - dx, y - dy
                if _in(px, py) and board[py][px] == side:
                    continue
                cnt = 0
                cx, cy = x, y
                while _in(cx, cy) and board[cy][cx] == side:
                    cnt += 1
                    cx += dx
                    cy += dy
                if cnt >= 5:
                    return True
    return False

def _line_counts(board, x, y, dx, dy, side):
    """以 (x,y) 为中心（假想落 side），统计正方向连续同色数/空点及跳子情况。
    返回 (count, open_ends, jump) 简化模型：
      count   = 含假想子在内的连续同色数
      open    = 两端是否为空（0/1/2）
    """
    count = 1
    cx, cy = x + dx, y + dy
    while _in(cx, cy) and board[cy][cx] == side:
        count += 1
        cx += dx
        cy += dy
    end1_open = _in(cx, cy) and board[cy][cx] == 0
    cx, cy = x - dx, y - dy
    while _in(cx, cy) and board[cy][cx] == side:
        count += 1
        cx -= dx
        cy -= dy
    end2_open = _in(cx, cy) and board[cy][cx] == 0
    return count, (int(end1_open) + int(end2_open))

def _score_point(board, x, y, side):
    """假想在 (x,y) 落 side 的进攻分（活三/冲四/做四启发）。"""
    if board[y][x] != 0:
        return -1
    score = 0
    for dx, dy in DIRS:
        c, o = _line_counts(board, x, y, dx, dy, side)
        if c >= 5:
            score += 100000          # 成五：必胜
        elif c == 4:
            score += 10000 if o >= 1 else 0   # 冲四/活四
        elif c == 3:
            score += 5000 if o == 2 else 500  # 活三/眠三
        elif c == 2:
            score += 300 if o == 2 else 50
        else:
            score += 10
    return score

def _candidate_moves(board, radius=2, limit=40):
    """候选点：已有棋子附近 radius 内的空点；开局时取中心附近。"""
    stones = [(x, y) for y in range(SIZE) for x in range(SIZE) if board[y][x] != 0]
    if not stones:
        return [(SIZE // 2, SIZE // 2)]
    cand = set()
    for sx, sy in stones:
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                nx, ny = sx + dx, sy + dy
                if _in(nx, ny) and board[ny][nx] == 0:
                    cand.add((nx, ny))
    # 按攻防合分排序取前 limit 个，控制搜索宽度
    scored = []
    for (x, y) in cand:
        s = _score_point(board, x, y, 1) + _score_point(board, x, y, 2)
        scored.append((s, x, y))
    scored.sort(reverse=True)
    return [(x, y) for _, x, y in scored[:limit]]

def _apply(board, x, y, side):
    board[y][x] = side

def _undo(board, x, y):
    board[y][x] = 0

def _evaluate(board, side):
    """全局粗评：己方点分和 − 对方点分和（只扫候选区域太贵，改为逐子线评分的轻量替代）。
    MVP 用：双方所有已落子的 _score_point 邻域近似太贵 → 直接用差值启发：
    对每个空候选点算双方面分做 max 吸收不现实，这里退化为子数差+中心权重。"""
    mine, theirs = 0, 0
    for y in range(SIZE):
        for x in range(SIZE):
            v = board[y][x]
            if v == side:
                mine += 1 + (SIZE // 2 - abs(x - SIZE // 2) - abs(y - SIZE // 2)) * 0.01
            elif v != 0:
                theirs += 1
    return mine - theirs

def _alphabeta(board, depth, alpha, beta, side, ai_side, deadline):
    if time.time() > deadline:
        return _evaluate(board, ai_side)
    if check_win(board, ai_side):
        return 10 ** 7
    if check_win(board, 3 - ai_side):
        return -(10 ** 7)
    if depth == 0:
        return _evaluate(board, ai_side)
    moves = _candidate_moves(board, limit=12)
    if not moves:
        return 0
    best = -(10 ** 9)
    for (x, y) in moves:
        _apply(board, x, y, side)
        val = -_alphabeta(board, depth - 1, -beta, -alpha, 3 - side, ai_side, deadline)
        _undo(board, x, y)
        if val > best:
            best = val
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    return best

def best_move(board, side, time_budget_ms=500, difficulty=2):
    """主入口：返回 AI 执 side 的落点 (x, y)。
    规则优先级：①己方成五 ②挡对方成五 ③己方活四/冲四 ④挡对方活三/冲四
               ⑤α-β(depth≤2, 500ms 预算) 选攻防合分最高点。
    """
    t0 = time.time()
    deadline = t0 + time_budget_ms / 1000.0
    opp = 3 - side
    empties = [(x, y) for y in range(SIZE) for x in range(SIZE) if board[y][x] == 0]
    if not empties:
        return None

    # ① 己方一手成五
    for (x, y) in empties:
        if _score_point(board, x, y, side) >= 100000:
            return (x, y)
    # ② 挡对方成五
    for (x, y) in empties:
        if _score_point(board, x, y, opp) >= 100000:
            return (x, y)
    # ③ 己方活四/冲四
    for (x, y) in empties:
        if _score_point(board, x, y, side) >= 10000:
            return (x, y)
    # ④ 挡对方活三/冲四
    for (x, y) in empties:
        if _score_point(board, x, y, opp) >= 5000:
            return (x, y)

    # ⑤ α-β 浅搜（难度1只走规则+1层启发；难度2/3 搜2层）
    depth = 1 if difficulty <= 1 else 2
    cand = _candidate_moves(board, limit=(16 if difficulty >= 3 else 24))
    best, best_xy = -(10 ** 9), cand[0]
    for (x, y) in cand:
        _apply(board, x, y, side)
        val = -_alphabeta(board, depth, -(10 ** 9), 10 ** 9, 3 - side, side, deadline)
        _undo(board, x, y)
        # 攻防合分加权，避免纯搜索忽略防守
        val += _score_point(board, x, y, side) + _score_point(board, x, y, opp) * 0.9
        if time.time() > deadline:
            break
        if val > best:
            best, best_xy = val, (x, y)
    return best_xy

def is_valid_move(board, x, y):
    return _in(x, y) and board[y][x] == 0
