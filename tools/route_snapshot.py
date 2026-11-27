# -*- coding: utf-8 -*-
"""
路由快照护栏（裁决固化的门禁级工具，2026-11-10 第4轮收口）
用法:
    python tools/route_snapshot.py save [输出文件]   # 保存当前路由快照（默认 tmp/route_snapshot_baseline.json）
    python tools/route_snapshot.py diff 基线 新快照  # 对比两份快照，全等退出码0，有差异退出码1并打印差异
原理：静态扫描 server/**/*.py 中所有 `if path == '...'` 分支，提取去重路由清单（含出现文件），
作为路由注册表化迁移前后的等价性验收依据——diff 全等才放行（无护栏不迁移）。
"""
import re, sys, os, glob, json

from util_log import get_logger

log = get_logger('route_snapshot')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAT = re.compile(r"if\s+path\s*==\s*['\"]([^'\"]+)['\"]")

def scan():
    routes = {}
    for f in glob.glob(os.path.join(ROOT, 'server', '**', '*.py'), recursive=True):
        rel = os.path.relpath(f, ROOT).replace('\\', '/')
        txt = open(f, encoding='utf-8', errors='ignore').read()
        for m in PAT.finditer(txt):
            routes.setdefault(m.group(1), []).append(rel)
    return {'total': len(routes), 'routes': routes}

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'save'
    if cmd == 'save':
        out = os.path.join(ROOT, sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'tmp', 'route_snapshot_baseline.json')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        d = scan()
        json.dump(d, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        log.info(f'[route_snapshot] 已保存 {d["total"]} 条去重路由 -> {out}')
        return 0
    if cmd == 'diff':
        base, new = (os.path.join(ROOT, p) for p in sys.argv[2:4])
        a, b = json.load(open(base, encoding='utf-8')), json.load(open(new, encoding='utf-8'))
        ra, rb = set(a['routes']), set(b['routes'])
        lost, added = ra - rb, rb - ra
        moved = {p for p in ra & rb if sorted(a['routes'][p]) != sorted(b['routes'][p])}
        if lost or added or moved:
            log.info(f'[route_snapshot] 不等! 丢失{len(lost)} 新增{len(added)} 定义位置变化{len(moved)}')
            for p in sorted(lost): log.info('%s %s', '  LOST  ', p)
            for p in sorted(added): log.info('%s %s', '  ADDED ', p)
            for p in sorted(moved): log.info(f'  MOVED {p}: {a["routes"][p]} -> {b["routes"][p]}')
            return 1
        log.info(f'[route_snapshot] 全等 ({a["total"]} 条路由)，放行。')
        return 0
    log.info(__doc__); return 2

if __name__ == '__main__':
    sys.exit(main())
