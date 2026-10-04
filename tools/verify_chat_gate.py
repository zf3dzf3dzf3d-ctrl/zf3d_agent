# -*- coding: utf-8 -*-
"""运行时验证：import chat_gate 后检查所有原对外符号存在且可调用/可用。"""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server')
sys.path.insert(0, ROOT)

import chat_gate

# 原文件全部顶层 def/class（从结构清单取）
EXPECT = ['_is_net_error', '_net_backoff', '_load_cfg', 'save_cfg', '_lane_of',
          '_lane_for', '_ensure_lanes', '_retire_overflow_lanes', 'acquire',
          'force_recover', 'release', 'GateRejected', '_eff_gap',
          '_prio_providers_locked', '_pick_ticket_locked', '_lane_worker_loop',
          '_slow_by_history', '_note_result', '_maybe_adjust_lanes',
          '_set_lanes_inmem', '_refresh_queue_positions', '_record',
          'status_snapshot', '_provider_lane_count', '_provider_groups_view',
          '_lanes_health_view', 'active_snapshot', 'set_enabled', 'set_gap',
          'set_lanes', 'set_auto', 'set_box_allowed', '_prio_of',
          'set_box_priority', 'priorities_view', 'clear_history',
          '_load_probe_cfg', '_save_probe_cfg', 'get_max_parallel',
          '_resolve_model_for', '_probe_one', '_probe_round', '_probe_worker',
          'start_probe', 'probe_snapshot']
# 外部引用的关键状态/常量
EXTRA = ['_LOCK', '_enabled', '_gap', '_lanes', '_auto_cfg', '_box_rules',
         '_GATE_CFG', '_GATE_DIR']

missing = [s for s in EXPECT + EXTRA if not hasattr(chat_gate, s)]
print('missing:', missing or 'NONE')
assert not missing

# 门面 exec 分段源码而非 import 分段模块 → 无双重实例问题；
# 只需确认全项目无人直接 import _gate_*（由外部 grep 保证）。

# 冒烟：状态快照可生成
snap = chat_gate.status_snapshot()
print('status_snapshot keys:', sorted(snap.keys())[:8])
print('VERIFY OK')
