# -*- coding: utf-8 -*-
"""chat_gate AIMD 自适应参数回归（工程基建总纲 P2.1 核心资产安全网 20261123）。

钉死 v4/v4.7 的行为契约（chat_gate._note_result）：
  1) 网络级失败 -> 车道间隔 ×2，封顶 max_gap_mult；
  2) 业务类失败（402 余额/鉴权/参数）不收紧（v4.7 事故回归：402 连乘曾把车道
     逼到 16 倍间隔，上游恢复后因成功样本稀疏恢复极慢）；
  3) __force_recover__ 强制回收不动 AIMD；
  4) 成功回落：>2.0 时 ×0.5，否则 ×0.75，下限 1.0；
  5) 慢判定（v4.10 token 速度版，蜂群 20261123 升级）：样本 ≥5 且 tok_s ≤ 滚动
     中位速度 × slow_speed_ratio(0.3) 且 ≤ 12 tok/s 上限 -> ×1.5；
  6) 历史滚动窗口 ≤20。
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

import chat_gate as g  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def near(a, b):
    return abs(a - b) < 1e-9


_orig_adjust = g._last_lane_adjust
g._last_lane_adjust = time.time()   # 冷却期内，防 _maybe_adjust_lanes 动车道注册表
_orig_auto = dict(g._auto_cfg)
g._auto_cfg.update({'enabled': True, 'max_gap_mult': 4.0, 'slow_mult': 2.5})
try:
    lane = 70701      # 车道 id 契约为 int（生产车道注册表即 int 键）
    lane2 = 70702

    def mult():
        return g._lane_gap_mult.get(lane, 1.0)

    # 1) 网络失败 ×2，封顶 max_gap_mult
    g._note_result(lane, False, 1.0, error='connection reset by peer')
    check('net-fail x2', near(mult(), 2.0), 'mult=%s' % mult())
    g._note_result(lane, False, 1.0, error='connection refused')
    check('net-fail x4', near(mult(), 4.0), 'mult=%s' % mult())
    g._note_result(lane, False, 1.0, error='connection reset again')
    check('cap at max_gap_mult', near(mult(), 4.0), 'mult=%s' % mult())

    # 2) 业务失败不收紧（v4.7 事故回归）
    m0 = mult()
    g._note_result(lane, False, 1.0, error='HTTP 402 余额不足')
    check('402 not congestion', near(mult(), m0), 'mult=%s' % mult())
    g._note_result(lane, False, 1.0, error='__force_recover__')
    check('force_recover not congestion', near(mult(), m0), 'mult=%s' % mult())

    # 3) 成功回落：>2.0 x0.5 -> x0.75 -> 下限 1.0
    g._note_result(lane, True, 0.1)
    check('recover x0.5 (>2.0)', near(mult(), 2.0), 'mult=%s' % mult())
    g._note_result(lane, True, 0.1)
    check('recover x0.75', near(mult(), 1.5), 'mult=%s' % mult())
    g._note_result(lane, True, 0.1)
    check('recover x0.75 again', near(mult(), 1.125), 'mult=%s' % mult())
    g._note_result(lane, True, 0.1)
    check('floor 1.0', mult() == 1.0, 'mult=%s' % mult())

    # 4) 慢判定（v4.10 token 速度版，20261123 蜂群升级）：>=5 样本，
    #    tok_s <= 中位速度 x slow_speed_ratio(0.3) 且 <= _SLOW_TOK_S_CEIL -> x1.5
    #    （tok_s = out_tokens/run_s，需过 64tok/1s 下限才可判——防短输出误判）
    g._lane_speed_hist[lane] = [10.0, 10.0, 10.0, 10.0, 10.0]   # 中位速度 10 tok/s
    g._note_result(lane, True, 100.0, out_tokens=300)            # tok_s=3.0 <= 0.3*10 → slow
    check('slow x1.5 (v4.10 speed)', near(mult(), 1.5), 'mult=%s' % mult())
    g._note_result(lane, True, 0.1)
    g._note_result(lane, True, 0.1)
    check('floor 1.0 (v4.10)', mult() == 1.0, 'mult=%s' % mult())

    # 4b) 长而快不算慢——本次升级要解决的问题：旧法拿总 run_s 比中位数，正常的长回答
    #     也会被判慢并收紧间隔（回放当天 712 次真实调用：旧法判慢 92 次，中位速度 49 tok/s）
    g._lane_speed_hist[lane] = [45.0] * 5
    g._note_result(lane, True, 60.0, out_tokens=3000)            # 50 tok/s：run_s 再长也不收紧
    check('long-but-fast not slow', near(mult(), 1.0), 'mult=%s' % mult())

    # 4c) token 数未知（调用方没传 out_tokens）-> 不判慢（宁漏勿误）
    g._lane_run_hist[lane] = [0.1, 0.1, 0.1, 0.1, 0.1]
    g._note_result(lane, True, 60.0)
    check('unknown tokens: no slow verdict', near(mult(), 1.0), 'mult=%s' % mult())

    # 4d) 绝对上限：速度高于 12 tok/s 一律不算慢，即使远低于该车道中位速度
    g._lane_speed_hist[lane2] = [100.0] * 5
    g._note_result(lane2, True, 5.0, out_tokens=100)             # 20 tok/s
    check('above 12 tok/s never slow', g._lane_gap_mult.get(lane2, 1.0) == 1.0)

    # 4e) 输出太短（<64 token）不判慢：首字节延迟会淹没生成速度
    g._lane_speed_hist[lane2] = [45.0] * 5
    g._note_result(lane2, True, 10.0, out_tokens=20)
    check('tiny output: no slow verdict', g._lane_gap_mult.get(lane2, 1.0) == 1.0)

    # 5) 样本 <5 不判慢（快速样本不会冤枉正常波动）
    g._lane_speed_hist[lane2] = [10.0, 10.0]
    g._note_result(lane2, True, 100.0, out_tokens=300)
    check('<5 samples no slow', g._lane_gap_mult.get(lane2, 1.0) == 1.0)

    # 6) 历史滚动窗口 <=20
    g._lane_run_hist[lane] = list(range(30))
    g._note_result(lane, True, 0.1)
    check('hist window <=20', len(g._lane_run_hist[lane]) <= 20,
          'len=%s' % len(g._lane_run_hist[lane]))
finally:
    g._auto_cfg.clear()
    g._auto_cfg.update(_orig_auto)
    g._last_lane_adjust = _orig_adjust

print('== AIMD 回归: %d fail ==' % len(_fail))


def test_gate_aimd():
    """pytest 入口（快速优化冲刺 A4 20261123）：模块导入时已完整执行 AIMD 契约回归。"""
    assert not _fail, 'AIMD 回归失败: ' + ', '.join(_fail)


if __name__ == '__main__':
    sys.exit(1 if _fail else 0)
