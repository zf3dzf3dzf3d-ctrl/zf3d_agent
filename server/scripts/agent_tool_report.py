#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agent_tool_report.py - 智能体工具利用率报表（读 SQLite 聚合库 tool_usage.db）

输出：分类/工具 TopN、错误率、平均耗时、低频清单（连续 N 天零调用）。
用法：
    python scripts/agent_tool_report.py            # 全部汇总
    python scripts/agent_tool_report.py --days 7   # 只看最近 7 天
    python scripts/agent_tool_report.py --top 20   # Top 20
"""
import os
import sys
import json
import sqlite3
import argparse
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, 'private', 'data', 'tool_usage.db')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=0, help='只统计最近 N 天（0=全部）')
    ap.add_argument('--top', type=int, default=15)
    ap.add_argument('--json', action='store_true', help='输出 JSON')
    a = ap.parse_args()

    if not os.path.isfile(DB):
        print('暂无数据：%s 不存在（埋点会在工具被调用后自动建库）' % DB)
        return
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    where, args_ = '', []
    if a.days > 0:
        import datetime
        since = (datetime.date.today() - datetime.timedelta(days=a.days - 1)).isoformat()
        where = 'WHERE day >= ?'
        args_ = [since]

    rows = conn.execute(
        'SELECT tool_name, category, SUM(calls) calls, SUM(errors) errors, '
        'SUM(total_ms) total_ms FROM tool_usage_stats %s '
        'GROUP BY tool_name ORDER BY calls DESC' % where, args_).fetchall()
    days_span = conn.execute(
        'SELECT MIN(day) a, MAX(day) b, COUNT(DISTINCT day) n FROM tool_usage_stats').fetchone()

    total_calls = sum(r['calls'] for r in rows)
    if a.json:
        print(json.dumps({
            'span': {'first': days_span['a'], 'last': days_span['b'], 'active_days': days_span['n']},
            'total_calls': total_calls, 'tools': len(rows),
            'rows': [dict(r, avg_ms=round((r['total_ms'] or 0) / max(1, r['calls']), 1),
                          fail_rate=round((r['errors'] or 0) / max(1, r['calls']) * 100, 2))
                     for r in rows]}, ensure_ascii=False, indent=1))
        conn.close()
        return

    print('=== 智能体工具利用率报表 ===')
    print('数据跨度: %s ~ %s（%d 个有调用日） | 工具数 %d | 总调用 %d'
          % (days_span['a'], days_span['b'], days_span['n'], len(rows), total_calls))
    print()
    print('%-4s %-22s %-8s %8s %8s %10s %8s' % ('#', '工具', '分类', '调用', '错误率', '平均ms', '占比'))
    for i, r in enumerate(rows[:a.top], 1):
        print('%-4d %-22s %-8s %8d %7.1f%% %10.1f %7.1f%%' % (
            i, r['tool_name'], r['category'], r['calls'],
            (r['errors'] or 0) / max(1, r['calls']) * 100,
            (r['total_ms'] or 0) / max(1, r['calls']),
            r['calls'] / max(1, total_calls) * 100))

    # 低频清单：有史以来调用极少（<=3 次）的工具
    rare = [r for r in rows if r['calls'] <= 3]
    if rare:
        print()
        print('--- 低频清单（总调用 <=3，候选下线，建议再观察 30 天）---')
        for r in rare:
            print('  %-24s %-8s calls=%d' % (r['tool_name'], r['category'], r['calls']))

    # 按分类汇总
    by_cat = defaultdict(lambda: [0, 0])
    for r in rows:
        by_cat[r['category']][0] += r['calls']
        by_cat[r['category']][1] += r['errors'] or 0
    if by_cat:
        print()
        print('--- 按分类汇总 ---')
        for cat, (c, e) in sorted(by_cat.items(), key=lambda kv: -kv[1][0]):
            print('  %-8s calls=%-7d errors=%-5d fail=%.1f%%' % (cat, c, e, e / max(1, c) * 100))
    conn.close()


if __name__ == '__main__':
    main()
