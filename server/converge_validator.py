# -*- coding: utf-8 -*-
"""
converge_validator.py - A2 分支收敛校验器（v5.4.7，规则版，零新依赖）

用途：≥2 个分支（赛马/蜂群小弟）产出需要收敛合并前，先跑一遍规则校验，
输出 JSON 冲突报告。【只标记，不改判】——合并与否、采纳哪支由上层/用户裁决。

用法：
    from converge_validator import validate_convergence
    report = validate_convergence({'分支A': '结论文本A', '分支B': '结论文本B'})
    # report: {'conflict': bool, 'items': [...], 'summary': str}

规则（全部规则式，可解释）：
1. 结论互斥：两分支对同一"目标文件/同一动作"给出不同最终值（如各自声称改了同一文件的不同内容、结论成功/失败相反）
2. 状态冲突：一支报完成/成功、另一支报失败/无法完成
3. 文件写入冲突：两支均声称写入/修改同一路径
4. 数字/参数分歧：对同名参数给出不同数值（宽松启发：同 key 不同 value）
"""
import json
import re
import time

# 声称"完成/成功"与"失败"的正则（中英文常见表述）
_OK_PAT = re.compile(r'(完成|成功|done|success|已完成|已通过|已落盘)', re.I)
_FAIL_PAT = re.compile(r'(失败|无法|不能完成|failed|error|拒绝|报错|未完成)', re.I)
# 提取文件路径（简单启发：盘符路径 / server\xxx / docs/xxx 等）
_PATH_PAT = re.compile(r'[A-Za-z]:\\[\w\-\\./\u4e00-\u9fa5]+|[\w\-]+(?:/[\w\-.]+){1,6}\.(?:py|md|json|js|txt|html|css)', re.I)


def _extract_paths(text):
    """粗提文本中出现的文件路径集合（小写归一）。"""
    return {p.lower().replace('\\', '/') for p in _PATH_PAT.findall(str(text or ''))}


def _extract_key_values(text):
    """提取 key=value / key: value 形式的参数对（宽松启发，供数字分歧检测）。"""
    kv = {}
    for m in re.finditer(r'([\w\u4e00-\u9fa5]{2,20})\s*[=:：]\s*(\d+(?:\.\d+)?)', str(text or '')):
        kv[m.group(1)] = float(m.group(2))
    return kv


def _status_of(text):
    """返回 'ok' / 'fail' / None（两者都命中则 None，不误报）。"""
    ok = bool(_OK_PAT.search(text))
    fail = bool(_FAIL_PAT.search(text))
    if ok and not fail:
        return 'ok'
    if fail and not ok:
        return 'fail'
    return None


def validate_convergence(branches, context=''):
    """
    branches: {分支名: 结论文本}，至少 2 个才校验。
    返回 JSON 兼容 dict 冲突报告；只标记不改判。
    """
    names = list((branches or {}).keys())
    base = {
        'checked_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'context': str(context or '')[:200],
        'branch_count': len(names),
        'conflict': False,
        'items': [],
        'summary': '',
    }
    if len(names) < 2:
        base['summary'] = '分支数 <2，不触发收敛校验'
        return base

    items = []

    # 规则1/3：文件写入冲突 + 路径映射
    path_owner = {}
    for n in names:
        for p in _extract_paths(branches[n]):
            path_owner.setdefault(p, set()).add(n)
    for p, owners in sorted(path_owner.items()):
        if len(owners) >= 2:
            items.append({'rule': 'file_write_conflict', 'target': p,
                          'branches': sorted(owners),
                          'detail': '多分支均声称涉及同一路径，合并前需确认最终内容与先后顺序'})

    # 规则2：状态冲突（成功 vs 失败）
    statuses = {n: _status_of(branches[n]) for n in names}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            sa, sb = statuses[a], statuses[b]
            if sa and sb and sa != sb:
                items.append({'rule': 'status_conflict',
                              'branches': [a, b],
                              'detail': '%s 判定=%s，%s 判定=%s，结论相反，需人工裁决' % (a, sa, b, sb)})

    # 规则4：同名参数数值分歧
    kvs = {n: _extract_key_values(branches[n]) for n in names}
    seen = set()
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            for k in set(kvs[a]) & set(kvs[b]):
                if kvs[a][k] != kvs[b][k]:
                    key = (k, a, b)
                    if key not in seen:
                        seen.add(key)
                        items.append({'rule': 'param_divergence', 'key': k,
                                      'branches': {a: kvs[a][k], b: kvs[b][k]},
                                      'detail': '同名参数数值不一致'})

    base['items'] = items
    base['conflict'] = bool(items)
    base['summary'] = ('发现 %d 处疑似冲突（只标记不改判，请人工/上层裁决后再合并）' % len(items)
                       if items else '未发现规则级冲突，可进入合并')
    return base


if __name__ == '__main__':
    # 自测：两支互相矛盾的样例
    demo = validate_convergence({
        '分支A': '已完成 server/converge_validator.py 的编写，状态=成功，行数=120',
        '分支B': '编写 server/converge_validator.py 失败：无法创建文件，行数=95',
    }, context='自测样例')
    print(json.dumps(demo, ensure_ascii=False, indent=1))
    assert demo['conflict'], '自测失败：应检出冲突'
    print('self-test OK')
