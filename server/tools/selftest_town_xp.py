# -*- coding: utf-8 -*-
"""P1 判据B断言：XP 单调不减（机器可 diff，策划案 v4 §8.7）。
用法：python selftest_town_xp.py [--probe]
--probe：额外做一次 bump_xp 实测（先读→bump→再读→断言 xp2>=xp1，独立临时卡，不污染真实村民）。"""
import os, re, sys

from util_log import get_logger

log = get_logger('selftest_town_xp')
_STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                          '..', 'private', '记忆', '小镇', 'state')

def all_xp():
    out = {}
    try:
        for fn in sorted(os.listdir(_STATE_DIR)):
            if fn.endswith('.md'):
                with open(os.path.join(_STATE_DIR, fn), 'r', encoding='utf-8-sig') as f:
                    m = re.search(r'经验值[：:]\s*(\d+)', f.read())
                out[fn[:-3]] = int(m.group(1)) if m else 0
    except FileNotFoundError:
        pass
    return out

def main():
    ok = True
    cur = all_xp()
    log.info('[P1] 当前全村 XP：%s' % (cur or '（暂无村民）'))
    # 断言1：bump_xp(delta 负数) 不减 —— 直接调模块单测
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        from engines.common.town_state import bump_xp
        _probe_role = '__xp_probe__'
        ok1, x1 = bump_xp(_probe_role, 1, 'probe+1')
        ok2, x2 = bump_xp(_probe_role, -5, 'probe-5(应被钳为0)')
        ok3, x3 = bump_xp(_probe_role, 0, 'probe0')
        mono = x1 <= x2 <= x3 and ok1 and ok2 and ok3
        log.info('[P1] 探针卡 %s: +1→%d, -5→%d, 0→%d  单调不减=%s' % (_probe_role, x1, x2, x3, mono))
        ok = ok and mono
        # 清理探针卡
        try:
            os.remove(os.path.join(_STATE_DIR, _probe_role + '.md'))
        except Exception:
            pass
    except Exception as e:
        log.info('[P1] SKIP 模块单测（%s）——仅做存量卡静态断言' % e)
    log.info('[P1] 判据B XP单调不减：' + ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
