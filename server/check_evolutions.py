# -*- coding: utf-8 -*-
"""进化信号检查（DSH v2.1 P1-④）。

扫描 audit_scores.jsonl（P0-② 分数台账），找出满足「自动进化信号」的
能力节点，输出 evidence 建议清单（不直接写树，人工/进化师确认后调用
capability_tree evidence，防刷分裁决落地）。

防刷分规则（v2.1 裁决）：
1. 同一 subject 需 ≥3 次评分全部 ≥90；
2. ≥3 次须来自 ≥2 个不同 role（交叉评分，单角色刷分无效）；
3. ≥3 次须来自 ≥2 个不同 actor（防同一评分者伪造多个 role 分饰多角）；
   同一 (subject, role, actor) 组合只计一次，重复评分不去重数量只去重身份；
4. 每 20 条满足条件的信号抽 1 条标记 manual_check=True（人工确认）。

用法：
    python check_evolutions.py            # 扫描并输出信号 JSON
    python check_evolutions.py --apply    # 预留：后续接入 capability_tree API
"""
import json
import io
import os
from collections import defaultdict

from util_log import get_logger

log = get_logger('check_evolutions')
SCORE_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         'private', 'logs', 'audit_scores.jsonl')
THRESHOLD = 90
MIN_COUNT = 3
SAMPLE_EVERY = 20  # 每 20 条信号抽 1 条人工确认


def scan():
    if not os.path.exists(SCORE_LOG):
        return []
    by_subject = defaultdict(list)
    with io.open(SCORE_LOG, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get('kind') != 'score':
                continue
            if float(r.get('score', 0)) >= THRESHOLD:
                by_subject[r.get('subject', '')].append(r)

    signals = []
    for subject, recs in by_subject.items():
        # 防分饰多角：同一 (role, actor) 组合只计 1 条，
        # 且有效评分须来自 ≥2 个不同 actor（单 actor 伪造多 role 无效）
        seen_combo = set()
        unique_recs = []
        for r in recs:
            combo = (r.get('role', ''), r.get('actor', ''))
            if combo in seen_combo:
                continue
            seen_combo.add(combo)
            unique_recs.append(r)
        recs = unique_recs
        if len(recs) < MIN_COUNT:
            continue
        roles = {r.get('role', '') for r in recs}
        actors = {r.get('actor', '') for r in recs}
        if len(roles) < 2:  # 防刷分：单角色无效
            continue
        if len(actors) < 2:  # 防刷分：单 actor 分饰多角色无效
            continue
        signals.append({
            'subject': subject,
            'scores': [(r.get('role'), r.get('score')) for r in recs],
            'roles': sorted(roles),
            'avg': round(sum(r.get('score', 0) for r in recs) / len(recs), 1),
            'manual_check': False,
        })
    # 抽样人工确认
    for i, s in enumerate(signals):
        if (i + 1) % SAMPLE_EVERY == 0:
            s['manual_check'] = True
    return signals


def main():
    signals = scan()
    log.info(json.dumps({'ok': True, 'signals': len(signals),
                      'items': signals}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
