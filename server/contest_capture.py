# -*- coding: utf-8 -*-
"""i大赛分支作答捕获（零新表，2026-11-12）。

chat_pool._emit_with_selfeval 在拦截 result 事件时调用 record()，
按 turn_id 暂存分支作答文本；domain_contest 轮询时用 take() 领取落库。
进程内内存暂存即可（场次轮询秒级进行，无需持久化暂存区）。
"""
import threading
import time

_LOCK = threading.Lock()
_BUF = {}  # turn_id -> {'box':, 'model':, 'text':, 'at':}


def record(turn_id, box_id, model, text):
    if not turn_id or not text:
        return
    with _LOCK:
        _BUF[turn_id] = {'box': str(box_id or ''), 'model': str(model or ''),
                         'text': str(text), 'at': time.time()}


def take(turn_id):
    """领取并移除（幂等：每 turn 只领一次）。"""
    with _LOCK:
        return _BUF.pop(turn_id, None)
