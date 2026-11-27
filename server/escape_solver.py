# -*- coding: utf-8 -*-
"""
escape_solver.py — i密室 P1 核心模块（策划案 v2.1 §二 P1）
职责：
1. validate_level(level): level.json Schema + 引用完整性校验（10好10坏验收）
2. generate_level(seed, difficulty): 程序算法生成网格地图（天然可达）+ 固定槽位模板谜题
   槽位链（突破师定式3）：入口 → 钥匙(item) → 密码(code) → 顺序(sequence) → 出口
   （riddle 每局 ≤1 题可选，见策划案 §三.2）
3. CLI 自测入口：python escape_solver.py --selftest 跑 10好/10坏
判定全程序化，零 AI 依赖（AI 只填文案，属 P2）。
"""
import random
import json
import sys

from util_log import get_logger

log = get_logger('escape_solver')
# ---------- Schema 定义 ----------
GRID_CHARS = set('#.D')  # 墙/地/门 —— 仅允许此字符集（反驳师②：未定义字符直接拦截）
PUZZLE_TYPES = {'item', 'code', 'sequence', 'riddle'}
DIFFICULTIES = {1, 2, 3}


def validate_level(level):
    """校验 level dict，返回 (ok, errors[])。好关卡 errors=[]。"""
    errors = []
    if not isinstance(level, dict):
        return False, ['level 不是 dict']
    # 1. 顶层必需字段
    for k in ('level_id', 'theme', 'difficulty', 'grid', 'rooms', 'objects', 'puzzles', 'exit_room'):
        if k not in level:
            errors.append(f'缺少顶层字段 {k}')
    if errors:
        return False, errors
    # 2. 难度
    if level['difficulty'] not in DIFFICULTIES:
        errors.append(f"difficulty 非法: {level['difficulty']}，允许 {sorted(DIFFICULTIES)}")
    # 3. 网格：矩形、字符集合法、非空
    grid = level['grid']
    if not isinstance(grid, list) or not grid or not all(isinstance(r, str) for r in grid):
        errors.append('grid 必须为非空字符串数组')
    else:
        w = len(grid[0])
        if any(len(r) != w for r in grid):
            errors.append('grid 各行长度不一致（非矩形）')
        bad = sorted({c for r in grid for c in r} - GRID_CHARS)
        if bad:
            errors.append(f'grid 出现未定义字符: {bad}（允许 {sorted(GRID_CHARS)}）')
        if '#' not in ''.join(grid):
            errors.append('grid 无墙（#），疑似非法地图')
    # 4. 房间引用与坐标合法
    rooms = level.get('rooms', {})
    if not isinstance(rooms, dict) or not rooms:
        errors.append('rooms 必须为非空 dict')
    else:
        for rid, room in rooms.items():
            if not isinstance(room, dict) or 'pos' not in room:
                errors.append(f'房间 {rid} 缺 pos')
                continue
            err = _check_pos(room['pos'], grid, f'房间 {rid}')
            errors.extend(err)
    if level.get('exit_room') not in rooms:
        errors.append(f"exit_room {level.get('exit_room')} 不在 rooms 中")
    # 5. 物品坐标：越界/落墙内/互相重叠（反驳师② 硬缺口）
    objects = level.get('objects', {})
    seen_pos = {}
    for oid, obj in objects.items():
        if not isinstance(obj, dict) or 'pos' not in obj:
            errors.append(f'物品 {oid} 缺 pos')
            continue
        err = _check_pos(obj['pos'], grid, f'物品 {oid}')
        errors.extend(err)
        p = tuple(obj.get('pos', [-1, -1]))
        if p in seen_pos:
            errors.append(f'物品 {oid} 与 {seen_pos[p]} 坐标重叠于 {list(p)}')
        seen_pos[p] = oid
    # 6. 谜题类型合法 + 引用完整性（突破师定式2：免 BFS 模拟器，只做 Schema+引用校验）
    puzzles = level.get('puzzles', [])
    if not isinstance(puzzles, list) or not puzzles:
        errors.append('puzzles 必须为非空数组')
    else:
        riddle_count = 0
        puzzle_ids = set()
        for i, pz in enumerate(puzzles):
            tag = f'puzzles[{i}]'
            if not isinstance(pz, dict):
                errors.append(f'{tag} 不是 dict')
                continue
            t = pz.get('type')
            if t not in PUZZLE_TYPES:
                errors.append(f'{tag} type 非法: {t}')
            if t == 'riddle':
                riddle_count += 1
                if not pz.get('answer_keywords'):
                    errors.append(f'{tag} riddle 缺 answer_keywords')
            elif not pz.get('answer') and pz.get('answer') != 0:
                errors.append(f'{tag} 缺 answer')
            if t == 'item' and pz.get('requires') not in objects:
                errors.append(f"{tag} requires 引用不存在的物品: {pz.get('requires')}")
            for gate in (pz.get('unlocks') or []):
                if gate not in (level.get('doors') or {}):
                    errors.append(f'{tag} unlocks 引用不存在的门: {gate}')
            pid = pz.get('id')
            if pid in puzzle_ids:
                errors.append(f'{tag} 谜题 id 重复: {pid}')
            puzzle_ids.add(pid)
            # 房间引用完整性（对抗回归①：谜题挂不存在房间；无 room 字段=无房间谜题，放行）
            if pz.get('room') is not None and pz.get('room') not in rooms:
                errors.append(f"{tag} room 引用不存在的房间: {pz.get('room')}")
        if riddle_count > 1:
            errors.append(f'riddle 每局最多 1 题，实际 {riddle_count}')
    # 7. 依赖无环（DAG 校验，拓扑排序）
    err = _check_dag(puzzles)
    errors.extend(err)
    # 8. 出口 BFS 可达性（对抗回归②：入口→出口必须有通路）
    grid_ok = isinstance(grid, list) and grid and isinstance(grid[0], str)
    start = level.get('start_pos')
    exit_room = rooms.get(level.get('exit_room')) if isinstance(rooms, dict) else None
    if grid_ok and isinstance(start, list) and isinstance(exit_room, dict) and exit_room.get('pos'):
        from collections import deque
        H, W = len(grid), len(grid[0])
        sy, sx = start
        ey, ex = exit_room['pos']
        if isinstance(sy, int) and isinstance(sx, int) and 0 <= sy < H and 0 <= sx < W and grid[sy][sx] != '#':
            seen = {(sy, sx)}
            q = deque([(sy, sx)])
            reach = False
            while q and not reach:
                y, x = q.popleft()
                if (y, x) == (ey, ex):
                    reach = True
                    break
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < H and 0 <= nx < W and grid[ny][nx] != '#' and (ny, nx) not in seen:
                        seen.add((ny, nx))
                        q.append((ny, nx))
            if not reach:
                errors.append(f"出口 {level.get('exit_room')}@{ey},{ex} 从 start_pos {start} BFS 不可达")
    return len(errors) == 0, errors


def _check_pos(pos, grid, tag):
    """坐标校验：越界 / 落墙内（反驳师②）。"""
    errs = []
    if not (isinstance(pos, list) and len(pos) == 2 and all(isinstance(v, int) for v in pos)):
        return [f'{tag} pos 非法: {pos}（须为 [行,列] 整数对）']
    r, c = pos
    if not grid or not isinstance(grid[0], str):
        return errs
    H, W = len(grid), len(grid[0])
    if not (0 <= r < H and 0 <= c < W):
        errs.append(f'{tag} pos 越界: {pos}（地图 {H}x{W}）')
    elif grid[r][c] == '#':
        errs.append(f'{tag} pos 落墙内: {pos}')
    return errs


def _check_dag(puzzles):
    """谜题依赖无环：requires(物品)←产出 与 unlocks 门 形成的链须为 DAG。此处校验
    puzzle 间 prerequisite 引用无环（prereq 指向更早谜题 id，且不得成环）。"""
    if not isinstance(puzzles, list):
        return []
    ids = [p.get('id') for p in puzzles if isinstance(p, dict)]
    graph = {}
    for p in puzzles:
        if not isinstance(p, dict):
            continue
        graph[p.get('id')] = list(p.get('prereq') or [])
    for deps in graph.values():
        for d in deps:
            if d not in ids:
                return [f'prereq 引用不存在的谜题: {d}']
    # Kahn 拓扑：indeg[i] = i 的前置数量；前置完成后 i 入队
    indeg = {i: len(set(deps)) for i, deps in graph.items()}
    queue = [i for i in ids if indeg[i] == 0]
    seen = 0
    while queue:
        n = queue.pop()
        seen += 1
        for i, deps in graph.items():
            if n in deps:
                indeg[i] -= 1
                if indeg[i] == 0:
                    queue.append(i)
    if seen != len(ids):
        return ['puzzles 依赖存在环（非 DAG）']
    return []


# ---------- 程序生成（P1.5 主路线：程序地图天然可达，槽位模板谜题死局率趋近零） ----------
# 地图用固定 2x2 房间布局（四房间对角连通），保证可达；复杂度随难度扩展房间数
_SLOT_CHAIN = [
    {'type': 'item', 'desc': '找到 {item_a}（藏在房间内）'},
    {'type': 'code', 'desc': '用 {item_a} 打开容器得到 3 位密码并输入'},
    {'type': 'sequence', 'desc': '按正确顺序扳动 {n} 个机关'},
    {'type': 'riddle', 'desc': '解开门口的谜语（可跳过扣分）'},
]


def generate_level(seed=None, difficulty=1, theme='古堡钟楼'):
    """程序生成一关：返回 level dict（必过 validate_level）。"""
    rng = random.Random(seed)
    diff = difficulty if difficulty in DIFFICULTIES else 1
    # 房间数：难度 1→4，2→6，3→9（全开孔网格天然连通）
    side = {1: 2, 2: 3, 3: 3}[diff]
    rooms_n = side * side
    # 网格：每房间占 3x3（含隔墙），全内部连通
    H = W = side * 2 + 1
    grid = [['#'] * W for _ in range(H)]
    room_cells = []
    for rr in range(side):
        for cc in range(side):
            r0, c0 = rr * 2 + 1, cc * 2 + 1
            grid[r0][c0] = '.'
            room_cells.append([r0, c0])
            # 与右/下邻居打通
            if cc + 1 < side:
                grid[r0][c0 + 1] = '.'
            if rr + 1 < side:
                grid[r0 + 1][c0] = '.'
    grid = [''.join(row) for row in grid]
    # 房间命名
    room_names = rng.sample(
        ['门厅', '书房', '地窖', '钟塔', '温室', '画廊', '锅炉房', '阁楼', '密档室'], rooms_n)
    rooms = {}
    for i, cell in enumerate(room_cells):
        rooms[f'room_{i}'] = {'pos': cell, 'name': room_names[i],
                              'desc': f'{room_names[i]}：尘封的{i+1}号房间。'}
    entrance = 'room_0'
    exit_room = f'room_{rooms_n - 1}'
    # 物品：钥匙 → 放在 entrance；密码容器 → 中部房间
    mid = f'room_{rooms_n // 2}'
    key_pos = room_cells[0][:]
    code_pos = room_cells[rooms_n // 2][:]
    objects = {
        'key_bronze': {'pos': key_pos, 'name': '铜钥匙', 'desc': '一把泛绿的铜钥匙。'},
        'code_box': {'pos': code_pos, 'name': '上锁的密码盒', 'desc': '需要钥匙打开的盒子。'},
    }
    # 槽位模板谜题链：入口→钥匙→密码→顺序→出口
    code_answer = f'{rng.randint(100, 999)}'
    seq_n = min(3 + diff, 5)
    seq_answer = rng.sample(['红', '蓝', '绿', '黄', '紫'], seq_n)
    riddle = {
        'id': 'pz_final', 'type': 'riddle',
        'question': '我有城市却无房屋，有森林却无树木，有河流却无水。我是什么？',
        'answer_keywords': ['地图', '一张地图', 'map'],
    }
    puzzles = [
        {'id': 'pz_key', 'type': 'item', 'requires': 'key_bronze', 'answer': 'key_bronze',
         'question': '找到能打开密码盒的东西', 'room': entrance},
        {'id': 'pz_code', 'type': 'code', 'requires': 'code_box', 'answer': code_answer,
         'question': f'密码盒上需要输入 3 位数字（提示藏在 {room_names[rooms_n // 2]}）', 'room': mid,
         'prereq': ['pz_key']},
        {'id': 'pz_seq', 'type': 'sequence', 'answer': seq_answer,
         'question': f'依次扳动 {seq_n} 个彩色机关（顺序至关重要）', 'room': exit_room,
         'prereq': ['pz_code']},
        dict(riddle, room=exit_room, prereq=['pz_seq']),
    ]
    # 难度1 不放 riddle（每局 ≤1 且低难度减负）
    if diff == 1:
        puzzles = puzzles[:3]
    doors = {'door_exit': {'pos': _door_pos(grid), 'leads_to': exit_room}}
    return {
        'level_id': f'gen-{seed}-{diff}',
        'theme': theme, 'difficulty': diff,
        'grid': grid, 'rooms': rooms, 'objects': objects,
        'puzzles': puzzles, 'doors': doors, 'exit_room': exit_room,
        'entrance_room': entrance,
        'meta': {'generator': 'escape_solver.procedural_v1', 'slot_chain': [p['id'] for p in puzzles]},
    }


def _door_pos(grid):
    """把出口门放在地图右下角边界内侧可行走格。"""
    H, W = len(grid), len(grid[0])
    for r in range(H - 1, -1, -1):
        for c in range(W - 1, -1, -1):
            if grid[r][c] == '.':
                return [r, c]
    return [1, 1]


# ---------- CLI 自测：10 好 10 坏（策划案 P1 验收） ----------
def _good_levels():
    """10 个好关卡：9 个程序生成（不同 seed/难度/主题）+ 1 个手写最小关。"""
    levels = []
    for i in range(9):
        diff = (i % 3) + 1
        levels.append(generate_level(seed=1000 + i, difficulty=diff,
                                     theme=['古堡钟楼', '太空舱', '末班地铁'][i % 3]))
    hand = {
        'level_id': 'hand-01', 'theme': '手写测试', 'difficulty': 2,
        'grid': ['#####', '#...#', '#.#.#', '#####'],
        'rooms': {'r0': {'pos': [2, 1], 'name': '起点'},
                  'r1': {'pos': [1, 3], 'name': '终点'}},
        'objects': {'gem': {'pos': [2, 1], 'name': '宝石'}},
        'puzzles': [{'id': 'p1', 'type': 'item', 'requires': 'gem', 'answer': 'gem',
                     'question': '拿到宝石', 'prereq': []}],
        'doors': {}, 'exit_room': 'r1', 'entrance_room': 'r0',
    }
    levels.append(hand)
    return levels


def _bad_levels():
    """10 个坏关卡：每个命中一类校验错误。"""
    g = generate_level(seed=99, difficulty=2)

    def mut(fn):
        import copy
        lv = copy.deepcopy(g)
        fn(lv)
        return lv

    def set_grid_char(lv): lv['grid'][1] = lv['grid'][1].replace('.', 'A', 1)
    def non_rect(lv): lv['grid'] = lv['grid'] + [lv['grid'][0][:2]]
    def obj_oob(lv): lv['objects']['key_bronze']['pos'] = [99, 99]
    def obj_in_wall(lv): lv['objects']['key_bronze']['pos'] = [0, 0]
    def obj_overlap(lv): lv['objects']['code_box']['pos'] = list(lv['objects']['key_bronze']['pos'])
    def bad_room_ref(lv): lv['exit_room'] = 'room_ghost'
    def bad_type(lv): lv['puzzles'][0]['type'] = 'magic'
    def bad_item_ref(lv): lv['puzzles'][0]['requires'] = 'ghost_item'
    def two_riddles(lv):
        lv['puzzles'].append(dict(lv['puzzles'][-1], id='pz_riddle2'))
    def cycle(lv):
        lv['puzzles'][0]['prereq'] = ['pz_seq']
    def dup_id(lv): lv['puzzles'][1]['id'] = lv['puzzles'][0]['id']
    def missing_field(lv): del lv['difficulty']
    def riddle_no_keywords(lv):
        if lv['puzzles'] and lv['puzzles'][-1].get('type') == 'riddle':
            lv['puzzles'][-1]['answer_keywords'] = []
        else:
            lv['puzzles'].append({'id': 'pr', 'type': 'riddle', 'question': '?'})

    return [mut(f) for f in (set_grid_char, non_rect, obj_oob, obj_in_wall, obj_overlap,
                             bad_room_ref, bad_type, bad_item_ref, two_riddles, cycle,
                             dup_id, missing_field, riddle_no_keywords)]


def selftest():
    good, bad = _good_levels(), _bad_levels()
    g_fail = [(i, e) for i, lv in enumerate(good) for ok, e in [validate_level(lv)] if not ok]
    b_fail = [i for i, lv in enumerate(bad) if validate_level(lv)[0]]
    log.info(f'好关卡: {len(good) - len(g_fail)}/{len(good)} 通过')
    for i, e in g_fail:
        log.info(f'  ✗ 好关卡 #{i} 误报: {e}')
    log.info(f'坏关卡: {len(bad) - len(b_fail)}/{len(bad)} 被正确拦截，漏网 {len(b_fail)} 个')
    for i in b_fail:
        log.info(f'  ✗ 坏关卡 #{i} 漏网！')
    ok = not g_fail and not b_fail
    # 程序生成关卡 50 个 seed 压测：全部必过
    stress_fail = sum(1 for s in range(50)
                      for lv in [generate_level(seed=s, difficulty=(s % 3) + 1)]
                      if not validate_level(lv)[0])
    log.info(f'生成压测: 50 seed 中 {50 - stress_fail} 个通过')
    ok = ok and stress_fail == 0
    log.info('%s %s', 'SELFTEST', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    demo = generate_level(seed=7, difficulty=2)
    log.info(json.dumps(demo, ensure_ascii=False, indent=1)[:1200])
