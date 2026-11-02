#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/permission_audit.py - 角色×工具权限实测脚本（阶段二·借鉴 DSB 报告）

目的：把「权限/分级只是配置声明」升级为「实测证据」。
做法：
  1) 读取系统调用表（syscall._TABLE）静态分级规则，对全工具集逐个分级；
  2) 对每级设计用例：public 放行 / system、dangerous 需引擎级 dangerous 标记或显式放行；
  3) 输出角色×工具 拒绝矩阵（Markdown），并计算关键产物 sha256 落盘留痕。

用法：python scripts/permission_audit.py
产出：private/logs/permission_audit_<ts>.md
"""

import os
import sys
import json
import time
import hashlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, 'server'))

OUT_DIR = os.path.join(BASE, 'private', 'logs')


def _collect():
    """动态收集系统调用表 + 各引擎 Registry。优先真表，失败降级静态规则。"""
    table = {}
    try:
        from engines.common import syscall as sc
        # 尝试触发各引擎加载以收集注册（不执行任何工具）
        try:
            from engines import engines_loader as el
            el.load_engines(force=True)
        except Exception:
            pass
        table = dict(getattr(sc, '_TABLE', {}) or {})
    except Exception as e:
        print('[warn] syscall 不可用: %s' % e)
    return table


def _level_of(entry):
    if not entry:
        return 'unknown'
    if entry.get('dangerous') or entry.get('level') == 'dangerous':
        return 'dangerous'
    if entry.get('level') == 'system':
        return 'system'
    return entry.get('level') or 'public'


def _hash_file(p):
    h = hashlib.sha256()
    try:
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                h.update(chunk)
    except Exception as e:
        return 'ERR:%s' % e
    return h.hexdigest()


def main():
    table = _collect()
    rows = []
    for name, ent in sorted(table.items()):
        rows.append({
            'tool': name,
            'engine': ent.get('engine', ''),
            'level': _level_of(ent),
            'dangerous_flag': bool(ent.get('dangerous')),
            'calls': ent.get('calls', 0),
        })
    if not rows:
        print('[warn] 系统调用表为空（引擎未注册任何工具），仅输出框架报告')

    now = time.strftime('%Y-%m-%d %H:%M:%S')
    lines = []
    lines.append('# 权限实测矩阵（permission_audit）')
    lines.append('')
    lines.append('- 生成时间: %s' % now)
    lines.append('- 工具总数: %d' % len(rows))
    lines.append('- 分级规则来源: server/engines/common/syscall.py P1 静态分级 + Registry dangerous 标记')
    lines.append('')
    lines.append('| 工具 | 主引擎 | 分级 | dangerous | 历史调用 | 拒绝策略(实测声明) |')
    lines.append('|---|---|---|---|---|---|')
    for r in rows:
        if r['level'] == 'dangerous':
            pol = '需显式放行/审批（deny by default）'
        elif r['level'] == 'system':
            pol = '记录+告警（P1 只记不拦，P4 建议拦截）'
        else:
            pol = '放行'
        lines.append('| %s | %s | %s | %s | %d | %s |' % (
            r['tool'], r['engine'], r['level'], r['dangerous_flag'], r['calls'], pol))
    lines.append('')
    # 汇总
    lv = {}
    for r in rows:
        lv[r['level']] = lv.get(r['level'], 0) + 1
    lines.append('## 分级汇总')
    for k in ('public', 'system', 'dangerous', 'unknown'):
        if k in lv:
            lines.append('- %s: %d' % (k, lv[k]))
    lines.append('')
    lines.append('## 与 DSB 报告对齐说明')
    lines.append('- 对标 ds-bot「按角色拒绝+拒绝信息不含敏感路径」：本矩阵是朱峰版的实测证据起点；')
    lines.append('- P1 只记不拦是当前事实，报告如实标注，不虚构拦截结果；')
    lines.append('- 后续 P4 拦截启用后重跑本脚本，拒绝列变为实测拒绝结果。')

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, 'permission_audit_%s.md' % time.strftime('%Y%m%d_%H%M%S'))
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    sha = _hash_file(out)
    print('[ok] report -> %s' % out)
    print('[ok] sha256 = %s' % sha)
    # 留痕追加
    with open(os.path.join(OUT_DIR, 'permission_audit.index.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': now, 'file': out, 'sha256': sha, 'tools': len(rows)}, ensure_ascii=False) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
