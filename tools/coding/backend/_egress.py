#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
_egress.py - P2 接线桥：tools/coding/backend 各 handler 调用 server/egress_gate 的统一入口。

自动向上查找 server/egress_gate.py（兼容 tools 包从任意 cwd 加载）。
失败语义【fail-closed】：出域闸门属数据防泄漏的授权类检查——闸门不可用、
自身异常或返回值异常时一律拒绝。原实现为 fail-open（放行），意味着只要让
闸门出错（损坏 egress_gate.py / audit_chain.py 即可）就能绕过出域扫描，已更正。
"""

import os
import sys

_cached = None
_searched = False


def _gate():
    global _cached, _searched
    if _searched:
        return _cached
    _searched = True
    here = os.path.dirname(os.path.abspath(__file__))
    seen = set()
    d = here
    for _ in range(8):
        cand = os.path.join(d, 'server', 'egress_gate.py')
        if cand not in seen and os.path.exists(cand):
            if d not in sys.path:
                sys.path.insert(0, d)
            try:
                import egress_gate
                _cached = egress_gate
            except Exception:
                _cached = None
            break
        seen.add(cand)
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return _cached


def check(channel, target, text='', actor='tool'):
    """返回 (decision, reason)。decision: 'allow' / 'block'。绝不抛错。

    fail-closed：闸门不可用 / 执行异常 / 返回值不是 allow|block，一律返回 block。
    只有闸门明确给出 allow 才放行。"""
    g = _gate()
    if g is None:
        return 'block', ('EGRESS_GATE_UNAVAILABLE: 出域闸门不可用，fail-closed 拒绝'
                         '（请检查 server/egress_gate.py 及其依赖 audit_chain 是否可导入）')
    try:
        r = g.check(channel, target, text=text, actor=actor)
        if not isinstance(r, dict) or r.get('decision') not in ('allow', 'block'):
            return 'block', 'EGRESS_GATE_MALFORMED: 闸门返回值异常，fail-closed 拒绝(%r)' % (r,)
        return r['decision'], str(r.get('reason', ''))
    except Exception as e:
        return 'block', 'EGRESS_GATE_ERROR: 闸门执行异常，fail-closed 拒绝(%s)' % e
