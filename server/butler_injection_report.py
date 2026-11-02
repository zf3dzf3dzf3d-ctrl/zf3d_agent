#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
butler_injection_report - 员工知识注入日志消费方（v3 第2轮收口裁决：课题⑥）
读取 private/记忆/员工知识注入日志.jsonl，输出近 24h 四行摘要：
  1) 注入次数（总 / 命中 / 空命中比例）
  2) Top 命中员工（按命中次数）
  3) 平均注入长度
  4) 可疑信号（超长注入 >6000 或异常高频员工）
用法：python butler_injection_report.py   （退出码恒 0，故障输出 <no data>）
供 6h 无头巡检调用；近 24h 零命中时输出 WARN 行提醒（防僵尸日志）。
"""
import os
import sys
import json
import time
from collections import Counter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # 保证任意 CWD 下可 import butler_knowledge
LOG = os.path.join(BASE, 'private', '记忆', '员工知识注入日志.jsonl')
WINDOW_MS = 24 * 3600 * 1000
MAX_EXPECT_INJECT = __import__('butler_knowledge').MAX_TOTAL   # 引用唯一真源，勿再硬编码 v3 上限


def report():
    now = int(time.time() * 1000)
    recs = []
    try:
        with open(LOG, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if now - r.get('ts', 0) <= WINDOW_MS:
                    recs.append(r)
    except FileNotFoundError:
        print('[injection-report] <no log file>')
        return
    except OSError as e:
        print('[injection-report] read error: %s' % e)
        return

    if not recs:
        print('[injection-report] WARN: 近24h注入日志零命中（无人触发或日志断流，请核查）')
        return

    hits = [r for r in recs if r.get('inject_len', 0) > 0]
    empty_ratio = 1.0 - len(hits) / len(recs)
    top = Counter(r.get('employee', '?') for r in hits).most_common(3)
    avg_len = sum(r.get('inject_len', 0) for r in hits) / len(hits) if hits else 0
    sus = [r for r in hits if r.get('inject_len', 0) > MAX_EXPECT_INJECT]
    freq = Counter(r.get('employee', '?') for r in recs)

    print('[injection-report] 1) 近24h注入 %d 次 / 命中 %d 次 / 空命中率 %.0f%%'
          % (len(recs), len(hits), empty_ratio * 100))
    print('[injection-report] 2) Top命中员工: %s'
          % (', '.join('%s=%d' % t for t in top) if top else '无'))
    print('[injection-report] 3) 平均注入长度: %d 字' % avg_len)
    print('[injection-report] 4) 可疑信号: 超长注入 %d 条; 最高频员工 %s (%d 次/24h)'
          % (len(sus), freq.most_common(1)[0][0] if freq else '-', max(freq.values()) if freq else 0))


if __name__ == '__main__':
    try:
        report()
    except Exception as e:
        print('[injection-report] error: %s' % e)
