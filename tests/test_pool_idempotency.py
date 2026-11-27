# -*- coding: utf-8 -*-
"""chat_pool turn_id 幂等回归（工程基建总纲 P2.1 核心资产安全网 20261123）。

钉死 submit() 的幂等契约（Wi-Fi 瞬断重发不重复计费）：
  1) 首投 -> waiting，槽位持有该 turn；
  2) 同 turn_id 在途重投 -> 直接返回现状，绝不铸新轮（对象同一性断言）；
  3) 不同 turn_id 撞上 <8s 幼轮 -> superseded 让位（2026-11-14 幼轮豁免：
     兄弟循环并发 submit 时的"误杀婴儿"死亡风暴回归防线）。

测试全程内存态，_turn_worker 打桩为空，不触网、不进真实 LLM 链。
"""
import os
import sys

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import chat_pool as p  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


p.cfg()
p._cfg['enabled'] = True
_orig_worker = p._turn_worker
p._turn_worker = lambda *a, **k: None   # 打桩：Turn 入池但不执行真实链路
try:
    body = {'_target_url': 'http://127.0.0.1:9/v1/chat/completions', '_box_id': 'T-POOL'}

    r1 = p.submit(dict(body), turn_id='t-A')
    check('首投 waiting', r1.get('ok') and r1.get('turn_id') == 't-A'
          and r1.get('state') == 'waiting', str({k: r1.get(k) for k in ('ok', 'turn_id', 'state')}))
    slot = p._get_slot('T-POOL')
    cur = slot.turn
    check('槽位持有 t-A', bool(cur) and cur.get('turn_id') == 't-A')

    # 幂等 a)：同 turn_id 在途重投 -> 返回现状，不铸新轮
    r2 = p.submit(dict(body), turn_id='t-A')
    check('同 id 重投返回现状', r2.get('ok') and r2.get('turn_id') == 't-A'
          and r2.get('state') == 'waiting')
    check('不铸新轮（对象同一）', slot.turn is cur)

    # 幼轮豁免：不同 id 撞上 <8s 在途轮 -> superseded 让位，原轮不动
    r3 = p.submit(dict(body), turn_id='t-B')
    check('幼轮豁免 superseded', r3.get('superseded') is True,
          str({k: r3.get(k) for k in ('ok', 'superseded', 'error')}))
    check('原轮未被收割', slot.turn is cur and slot.turn.get('turn_id') == 't-A')
finally:
    try:
        p.discard('T-POOL')
    except Exception:
        pass
    p._turn_worker = _orig_worker

print('== chat_pool 幂等回归: %d fail ==' % len(_fail))


def test_pool_idempotency():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行幂等契约回归。"""
    assert not _fail, 'chat_pool 幂等回归失败: ' + ', '.join(_fail)


if __name__ == '__main__':
    sys.exit(1 if _fail else 0)
