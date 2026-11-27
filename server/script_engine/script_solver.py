# -*- coding: utf-8 -*-
"""script_solver.py — i剧本杀 可解性门禁（P1，策划案 v2.2）。

CLI:  python script_solver.py <book.json> [book2.json ...]
退出码：0=全部通过；1=有本被拒（打印每条原因）；2=参数/IO错误。

判定规则（SCHEMA.md 第五节）：
 R1 结构完整性（必填/id唯一/恰好1victim+1murderer/prewritten>=2/tasks每角色>=1）
 R2 线索引用完整（implies 指向存在的事实、spot 属于某 scene）
 R3 推凶可达性：每条 is_key 事实要么被公开线索 implies 覆盖，要么其 deps 全部可达
 R4 时间线自洽（id 唯一、who 必须是存在角色或 unknown）
 R5 凶手 secret 字段存在（防自查脱罪的文本规则占位检查）

事实依赖图：timeline 项可选 deps: [fact_id...]；R3 用 BFS 判可达。
覆盖判定：clue.implies 直接命中 fact.id 即覆盖（owner 无关——凶手线归属玩家的
线索在多人都可被搜到/共享的推理环境中视为可公开，MVP 单人局全公开）。
"""
import json
import sys


from util_log import get_logger

log = get_logger('script_solver')
def solve(book):
    """返回错误列表；空列表 = 通过。"""
    errs = []
    if not isinstance(book, dict):
        return ['book is not a dict']

    # ---- R1 结构完整性 ----
    for k in ('id', 'title', 'intro', 'background', 'scenes', 'characters',
              'clues', 'timeline', 'tasks', 'win_conditions'):
        if k not in book:
            errs.append('R1 missing top field: %s' % k)
    if errs:
        return errs

    chars = book['characters']
    scenes = book['scenes']
    clues = book['clues']
    tl = book['timeline']
    tasks = book['tasks']

    def _ids(items, label):
        seen, dups = set(), []
        for it in items:
            i = it.get('id')
            if not i:
                errs.append('R1 %s item missing id' % label)
            elif i in seen:
                dups.append(i)
            seen.add(i)
        for d in dups:
            errs.append('R1 duplicate %s id: %s' % (label, d))
        return seen

    char_ids = _ids(chars, 'character')
    scene_ids = _ids(scenes, 'scene')
    clue_ids = _ids(clues, 'clue')
    fact_ids = _ids(tl, 'timeline')

    victims = [c for c in chars if c.get('is_victim')]
    murderers = [c for c in chars if c.get('is_murderer')]
    if len(victims) != 1:
        errs.append('R1 need exactly 1 victim, got %d' % len(victims))
    if len(murderers) != 1:
        errs.append('R1 need exactly 1 murderer, got %d' % len(murderers))
    else:
        m = murderers[0]
        if m.get('is_victim'):
            errs.append('R1 murderer is also victim')
        if not (m.get('secret') or '').strip():
            errs.append('R5 murderer secret empty')

    for c in chars:
        if len(c.get('prewritten') or []) < 2:
            errs.append('R1 char %s prewritten < 2' % c.get('id'))
        if not (c.get('persona') or '').strip():
            errs.append('R1 char %s persona empty' % c.get('id'))
        own = [t for t in tasks if t.get('char') == c.get('id')]
        if not own and not c.get('is_victim'):
            errs.append('R1 char %s has no task' % c.get('id'))

    # ---- R2 线索引用完整 ----
    spot_owner = {}
    for s in scenes:
        for sp in (s.get('spots') or []):
            if sp in spot_owner:
                errs.append('R2 duplicate spot: %s' % sp)
            spot_owner[sp] = s['id']
    for c in clues:
        if c.get('spot') not in spot_owner:
            errs.append('R2 clue %s unknown spot %s' % (c.get('id'), c.get('spot')))
        imp = c.get('implies') or []
        if not imp:
            errs.append('R2 clue %s implies empty' % c.get('id'))
        for f in imp:
            if f not in fact_ids:
                errs.append('R2 clue %s implies unknown fact %s' % (c.get('id'), f))

    # ---- R4 时间线自洽 ----
    for f in tl:
        who = f.get('who')
        if who not in char_ids and who != 'unknown':
            errs.append('R4 fact %s unknown who: %s' % (f.get('id'), who))
    try:
        sorted(tl, key=lambda x: x.get('t', ''))
    except Exception as e:
        errs.append('R4 timeline not sortable: %s' % e)

    # ---- R3 推凶可达性（核心）----
    # fact 覆盖集：所有 clue.implies 的并集
    covered = set()
    for c in clues:
        covered.update(c.get('implies') or [])
    # 依赖图 BFS：从 covered 出发，沿 deps 反向把被依赖事实也标记可达
    deps = {f['id']: list(f.get('deps') or []) for f in tl if f.get('id')}
    reachable = set(covered)
    queue = list(reachable)
    while queue:
        cur = queue.pop()
        for d in deps.get(cur, []):
            if d not in fact_ids:
                errs.append('R3 fact %s deps unknown fact %s' % (cur, d))
                continue
            if d not in reachable:
                reachable.add(d)
                queue.append(d)
    key_facts = [f for f in tl
                 if f.get('is_key') and not f.get('hidden')
                 and f.get('id') != 'f_murderer']  # 结论事实由 Solver 自己推导，不要求线索覆盖
    if not key_facts:
        errs.append('R3 no is_key facts in timeline')
    for f in key_facts:
        if f['id'] not in reachable:
            errs.append('R3 key fact %s NOT reachable from clues' % f['id'])
    # 凶手的 is_key 事实必须可达
    if murderers:
        mid = murderers[0]['id']
        mkey = [f for f in tl
                if f.get('is_key') and f.get('who') == mid
                and f.get('id') != 'f_murderer']
        for f in mkey:
            if f['id'] not in reachable:
                errs.append('R3 murderer key fact %s NOT reachable' % f['id'])

    return errs


def main(argv):
    if len(argv) < 2:
        log.info('usage: python script_solver.py <book.json> [...]')
        return 2
    rc = 0
    for path in argv[1:]:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                book = json.load(f)
        except Exception as e:
            log.info('[IO ] %s -> %s' % (path, e))
            rc = 2
            continue
        errs = solve(book)
        if errs:
            rc = 1
            log.info('[FAIL] %s (%d problems)' % (path, len(errs)))
            for e in errs:
                log.info('   - ' + e)
        else:
            log.info('[PASS] %s (%s)' % (path, book.get('title', '?')))
    return rc


if __name__ == '__main__':
    sys.exit(main(sys.argv))
