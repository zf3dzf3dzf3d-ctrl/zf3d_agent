# -*- coding: utf-8 -*-
"""P1 统一协议网关：call_upstream(ctx, payload, policy=None) 单入口。

- ctx:    {'target_url', 'headers', 'model_cfg', 'api_key', '_prev_response_id', ...}
- payload: OpenAI Chat Completions 形态请求体
- policy: 可选按调用覆盖 {'protocol': 'auto|chat|responses|anthropic',
                          'ctx_mode': 'full|truncate|minimal|mega|auto'}
          不传则回落 get_protocol_policy() 全局配置（兼容两参旧签名）。
- 返回 OpenAI CC 形态归一化响应（含 _reasoning_hint / _response_id 私有字段）。

引擎调用方（agent_loop / mega_task / mixin 线路）统一收敛到本入口，
通过 policy 参数实现按调用灰度切换，不再全局硬编码。
"""
import threading

import common.dual_protocol as _dp

# per-call 覆盖的换入/换出必须串行：_PERCALL_OVERRIDE 是 dual_protocol 模块级全局，
# 并发"读旧值→设置→finally 恢复"会互相踩（A 恢复时抹掉 B 的覆盖，或 B 读到 A 的 prev）
_PERCALL_LOCK = threading.Lock()


def call_upstream(ctx, payload, policy=None):
    policy = policy or {}
    with _PERCALL_LOCK:
        prev = _dp._PERCALL_OVERRIDE
        if policy.get('protocol') or policy.get('ctx_mode'):
            _dp._PERCALL_OVERRIDE = {
                'protocol': policy.get('protocol') or (prev or {}).get('protocol') or 'auto',
                'ctx_mode': policy.get('ctx_mode') or (prev or {}).get('ctx_mode') or 'truncate',
            }
        try:
            return _dp.call_upstream(ctx, payload)
        finally:
            _dp._PERCALL_OVERRIDE = prev
