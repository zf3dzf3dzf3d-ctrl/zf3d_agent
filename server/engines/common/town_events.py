# -*- coding: utf-8 -*-
"""i小镇事件总线 v1 实现（S1 纯记录模式）。

事件 schema v1（五字段 JSON 行，一行一事件）：
{"event_id":"town-<UTC毫秒>-<4位随机>","source":"crew_done|dispatch_post",
 "type":"crew_done|dispatch|emit_error","ts":"ISO8601带时区","payload":{...}}
source/type/ts/payload 字段名即机读 schema v1（判据卡 P1-3 引用同一版本；改 schema 须回报用户重裁）。

契约：C1 全吞异常 ｜ C2 失败计数留痕 ｜ C3 内存队列异步刷盘 ｜
     C4 town_enabled 总开关（OFF 时 emit 直接 return）｜ C6 挂点唯一。
注入开关 town_inject_enabled（A/B FAIL 降级：默认 OFF，永久禁注入直至 E3 就绪重判）。
"""
import json
import threading
import time
import random
from datetime import datetime, timezone

# == 模块级常量（审核员刺：勿让契约停留在注释里）==
QUEUE_MAX = 1000          # C3 内存队列上限，满了丢最旧并计一次 fail
FLUSH_BATCH = 100         # C2 每 100 条 fail 攒一条 emit_error 留痕
FLUSH_INTERVAL = 2.0      # 异步刷盘周期（秒）

town_enabled = True           # C4 总开关：事件采集（2026-11-18 用户拍板开启，重启后生效）
town_inject_enabled = False   # 注入开关：A/B FAIL 降级锁定 OFF（P2-2）
town_emit_fail_count = 0

_queue = []                   # C3 内存队列
_lock = threading.Lock()
_flush_thread = None

# 事件流落盘：server 进程直写 jsonl（append-only）。出域闸门只拦 run_code 工具，
# 不拦 server 本体写盘（预演师实测口径修正，2026-11-18 主对话复核）。
import os as _os
_EVENTS_PATH = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.dirname(
    _os.path.dirname(_os.path.abspath(__file__))))), 'private', '记忆', '小镇', 'events.jsonl')


def emit(source, etype, payload):
    """C1/C3：入队即返回，永不上抛、零同步 IO。"""
    global town_emit_fail_count
    if not town_enabled:
        return
    try:
        ev = {
            'event_id': 'town-%d-%04d' % (int(time.time() * 1000), random.randint(0, 9999)),
            'source': source,
            'type': etype,
            'ts': datetime.now(timezone.utc).astimezone().isoformat(),
            'payload': payload if isinstance(payload, dict) else {'raw': str(payload)[:500]},
        }
        with _lock:
            if len(_queue) >= QUEUE_MAX:
                _queue.pop(0)
                town_emit_fail_count += 1
            _queue.append(ev)
    except Exception:
        town_emit_fail_count += 1  # C2：全吞+计数，绝不上抛


def _flush_once():
    """后台刷盘线程：批量写 project_record 通道；失败计数，禁上抛（C1）。"""
    global town_emit_fail_count
    batch = []
    with _lock:
        if _queue:
            batch = _queue[:]
            _queue[:] = []
    for ev in batch:
        try:
            _os.makedirs(_os.path.dirname(_EVENTS_PATH), exist_ok=True)
            with open(_EVENTS_PATH, 'a', encoding='utf-8') as f:
                f.write(json.dumps(ev, ensure_ascii=False) + '\n')
            # S2.5 自知层（策划案 v4 §8.1/§8.7）：事件驱动经验值+1，经验值来自事件 payload.role。
            try:
                from engines.common.town_state import bump_xp as _bump_xp
                _pl = ev.get('payload') or {}
                _role = str(_pl.get('role') or _pl.get('crew') or _pl.get('member') or '').strip()
                if not _role:
                    # crew_done 事件无 role：用 crew_id:window_id 作为村民身份（施工队工人级村民）
                    _c, _w = str(_pl.get('crew_id') or '').strip(), str(_pl.get('window_id') or '').strip()
                    if _c and _w:
                        _role = _c + ':' + _w
                    elif _c or _w:
                        _role = _c or _w
                if _role:
                    _bump_xp(_role, 1, note='%s %s' % (ev.get('type', ''), ev.get('ts', '')))
            except Exception:
                pass  # 全吞，状态卡失败不影响事件流
        except Exception:
            town_emit_fail_count += 1


def _flush_loop():
    while town_enabled:
        time.sleep(FLUSH_INTERVAL)
        try:
            _flush_once()
        except Exception:
            pass


def ensure_flusher():
    """惰性启动刷盘线程（emit 首次入队后调用，幂等）。"""
    global _flush_thread
    if not town_enabled or _flush_thread is not None:
        return
    _flush_thread = threading.Thread(target=_flush_loop, daemon=True, name='town-events-flush')
    _flush_thread.start()
