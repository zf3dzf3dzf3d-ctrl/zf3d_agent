# -*- coding: utf-8 -*-
"""全局 token/s 统计注册表（进程级单例）。

目标：跨浏览器标签页 + 服务端后台 LLM 调用，统一在服务端汇总每秒 token 速率。
口径与前端一致：字符数 ÷2 ≈ token 数（中文约 2 字符/token）。

数据结构：_streams[stream_id] = {'at': 首token时刻ms, 'last': 末token时刻ms, 'chars': 累计字符}
summary() 只汇总 1.5s 内仍有 token 到达的活跃流（与前端 __zfTok5Reg 口径一致）。
"""

import threading
import time

_lock = threading.Lock()
_streams = {}
ACTIVE_MS = 1500   # 流活跃判定窗口：1.5s 内有 token 到达才算活跃
MAX_STREAMS = 500  # 防御上限，超过时清最旧


def record(stream_id, chars, now_ms=None):
    """登记一次 token 到达：stream_id 唯一标识一条流（boxId 或 relay 请求指纹）。"""
    if not chars or chars <= 0:
        return
    now_ms = now_ms or int(time.time() * 1000)
    with _lock:
        it = _streams.get(stream_id)
        if it is None:
            if len(_streams) >= MAX_STREAMS:
                # 清掉最旧的流防泄漏
                oldest = min(_streams.items(), key=lambda kv: kv[1]['last'])
                _streams.pop(oldest[0], None)
            _streams[stream_id] = {'at': now_ms, 'last': now_ms, 'chars': int(chars)}
        else:
            it['last'] = now_ms
            it['chars'] += int(chars)


def summary(now_ms=None):
    """返回全局合计 tok/s：只汇总活跃流，各流按自身窗口时长折算后求和。"""
    now_ms = now_ms or int(time.time() * 1000)
    total_tps = 0.0
    active = 0
    stale = []
    with _lock:
        for sid, it in list(_streams.items()):
            if (now_ms - it['last']) >= ACTIVE_MS:
                stale.append(sid)
                continue
            active += 1
            win_ms = max(500, it['last'] - it['at'])
            total_tps += (it['chars'] / 2.0) / (win_ms / 1000.0)
        for sid in stale:
            _streams.pop(sid, None)
    return {'ok': True, 'tok_per_sec': round(total_tps, 1), 'active_streams': active}
