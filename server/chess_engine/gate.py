# -*- coding: utf-8 -*-
"""gate.py — i棋·象棋/围棋机器闸门（v1.2 六.7条，2026-11-21）
- 象棋：蹩马腿/塞象眼/将帅不照面/过河兵回归用例 + 自对弈30局(difficulty=1, 500ms预算)
- 围棋：劫争禁立即回提/禁入点用例 + 自对弈20局
- 全过 GATE_PASS(退出0)；任一失败 GATE_FAIL(退出1)
"""
import sys, io, time, random, os
from util_log import get_logger

log = get_logger('gate')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cchess, go_engine

fails = []
def check(name, cond):
    log.info(('PASS ' if cond else 'FAIL ') + name)
    if not cond:
        fails.append(name)

RC = 0  # cchess color 索引：0红 1黑

# ===== 象棋规则用例 =====
# 蹩马腿：红马(4,7)->(3,5)，腿点(4,6)
b = [[0]*9 for _ in range(10)]
b[9][4] = 11; b[0][4] = 21
b[7][4] = 14
b[6][4] = 17
check('象棋·蹩马腿(腿点被塞非法)', not cchess.is_valid_move(b, 4, 7, 3, 5, RC))
b[6][4] = 0
check('象棋·蹩马腿(腿点清空合法)', cchess.is_valid_move(b, 4, 7, 3, 5, RC))

# 塞象眼：红象(2,9)->(4,7)，眼点(3,8)
b = [[0]*9 for _ in range(10)]
b[9][4] = 11; b[0][4] = 21
b[9][2] = 13
b[8][3] = 17
check('象棋·塞象眼(眼点被塞非法)', not cchess.is_valid_move(b, 2, 9, 4, 7, RC))
b[8][3] = 0
check('象棋·塞象眼(眼点清空合法)', cchess.is_valid_move(b, 2, 9, 4, 7, RC))

# 将帅不照面：两帅同列无遮挡，黑方不得有保持照面的着法
b = [[0]*9 for _ in range(10)]
b[0][4] = 21; b[9][4] = 11
b[9][0] = 15
mv = cchess.gen_moves(b, 1)  # 1=黑 color 索引
stay = [m for m in mv if m[0] == 4 and m[2] == 4 and m[1] == 0]
check('象棋·将帅不照面(黑帅无保持照面着法)', not stay)

# 过河兵
b = [[0]*9 for _ in range(10)]
b[0][4] = 21; b[9][4] = 11
b[5][4] = 17
check('象棋·过河兵可横走', cchess.is_valid_move(b, 4, 5, 5, 5, RC))
b[5][4] = 0; b[6][4] = 17
check('象棋·未过河兵不可横走', not cchess.is_valid_move(b, 4, 6, 5, 6, RC))

# ===== 象棋自对弈30局 =====
t0 = time.time()
okg = 0
random.seed(42)
for g in range(30):
    bd = cchess.initial_board()
    side = 1
    legal = True
    for step in range(120):
        m = cchess.best_move(bd, side, difficulty=1, time_budget_ms=500)
        if not m:
            break
        fx, fy, tx, ty = m
        if not cchess.is_valid_move(bd, fx, fy, tx, ty, side - 1):
            legal = False
            fails.append('象棋自对弈第%d局第%d步非法%s' % (g+1, step+1, str(m)))
            break
        cchess.apply_move(bd, fx, fy, tx, ty)
        side = 3 - side
    if legal:
        okg += 1
dt = time.time() - t0
check('象棋·自对弈30局全合法(耗时%.1fs)' % dt, okg == 30)

# ===== 围棋规则用例 =====
# 劫争形：黑单子(2,4)，白(1,4)(3,4)(2,3)(2,5)围之(黑仅(2,3)向的气相关劫形)；
# 场景：白刚提掉黑(2,3)→ko=(2,3)，黑禁立即回提
g0 = [[0]*9 for _ in range(9)]
g0[4][2] = 1
g0[4][1] = 2; g0[4][3] = 2; g0[3][2] = 2; g0[5][2] = 2
ok, why = go_engine.is_valid_move(g0, 2, 3, 1, ko_point=(2, 3))
check('围棋·劫争禁立即回提', (not ok) and ('劫' in why))

# 禁入点：空点(4,4)四邻全白，黑下无提无气
g1 = [[0]*9 for _ in range(9)]
g1[4][3] = 2; g1[4][5] = 2; g1[3][4] = 2; g1[5][4] = 2
ok, why = go_engine.is_valid_move(g1, 4, 4, 1)
check('围棋·禁入点(自杀)拒绝', (not ok) and ('禁入' in why))

# ===== 围棋自对弈20局 =====
t0 = time.time()
okg = 0
random.seed(7)
for g in range(20):
    bd = [[0]*9 for _ in range(9)]
    color = 1
    ko = None
    legal = True
    for step in range(120):
        m = go_engine.best_move(bd, color, ko_point=ko, difficulty=1)
        if not m:
            break
        x, y = m
        ok, why = go_engine.is_valid_move(bd, x, y, color, ko_point=ko)
        if not ok:
            legal = False
            fails.append('围棋自对弈第%d局第%d步非法(%d,%d):%s' % (g+1, step+1, x, y, why))
            break
        cap = go_engine.apply_move(bd, x, y, color)
        ko = go_engine.compute_ko_point(bd, (x, y), cap)
        color = 3 - color
    if legal:
        okg += 1
dt = time.time() - t0
check('围棋·自对弈20局全合法(耗时%.1fs)' % dt, okg == 20)

log.info('=' * 40)
if fails:
    log.info('GATE_FAIL (%d)' % len(fails))
    for f in fails[:10]:
        log.info('%s %s', ' -', f)
    sys.exit(1)
log.info('GATE_PASS')
