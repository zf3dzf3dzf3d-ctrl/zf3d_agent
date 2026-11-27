# -*- coding: utf-8 -*-
"""cache_watch —— 前缀缓存命中率观测（重建版 2026-09-15）

原文件在 2026-09-15 的清理中丢失，本文件按调用方接口重建：
  serialize_payload(payload) -> bytes   键排序 + 剔除易变字段的稳定序列化
  prefix_fingerprint(body)   -> str    请求前缀指纹（短哈希）
  record_usage(provider, model, usage, box_id='', fp='') -> None  用量入库
  snapshot()                 -> dict   池状态快照里的 cache_watch 段

存储：private/cache_watch.jsonl（逐行追加，自 tail 截断，坏了即重置）。
"""
import hashlib
import json
import os
import threading
import time

_LOCK = threading.Lock()
_MAX_LINES = 4000          # jsonl 最多保留行数（防止无限膨胀）
_MAX_FPLEN = 64            # fingerprint 长度上限
# 【重要】serialize_payload 的返回值会作为真正发给上游的请求体（pool_worker），
# 这里绝不能剔除任何上游需要的业务字段（messages/tools/stream/max_tokens 等）。
# 只剥离下划线开头的对话私有字段（_engine 等，pool_worker 反正也会 pop）；
# 排序键仅为字节稳定，帮助上游前缀缓存命中。
_VOLATILE_KEYS = ('_turn_id', '_box_id', '_pool_turn_id', '_loop_mode',
                  '_project_path', '_session_id', '_engine')

_DATA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                          'private', 'cache_watch.jsonl')


def _path():
    return os.path.abspath(_DATA_PATH)


# ===== stream_options 降级白名单（不支持该字段的上游会 400，按 host 拉黑后不再注入） =====
_SO_BLOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                              'private', 'cache_watch_so_blocklist.json')


def so_allowed(host):
    """host 是否允许注入 stream_options（未被拉黑）。"""
    try:
        with open(_SO_BLOCK_PATH, 'r', encoding='utf-8') as f:
            return host not in json.load(f)
    except Exception:
        return True


def so_block(host):
    """上游因 stream_options 报 400 → 拉黑该 host（后续请求不再注入）。"""
    try:
        lst = []
        try:
            with open(_SO_BLOCK_PATH, 'r', encoding='utf-8') as f:
                lst = json.load(f)
        except Exception:
            lst = []
        if host and host not in lst:
            lst.append(host)
            with open(_SO_BLOCK_PATH, 'w', encoding='utf-8') as f:
                json.dump(lst, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def serialize_payload(payload):
    """规范化序列化：键排序 + 剔除易变字段 → 字节稳定，前缀缓存更易命中。"""
    if not isinstance(payload, dict):
        return json.dumps(payload, ensure_ascii=True, sort_keys=True).encode('utf-8')
    slim = {k: v for k, v in payload.items() if k not in _VOLATILE_KEYS}
    return json.dumps(slim, ensure_ascii=True, sort_keys=True,
                      separators=(',', ':')).encode('utf-8')


def prefix_fingerprint(body):
    """请求前缀指纹：对整条 messages 的稳定序列化取短哈希（指纹仅用于统计，不影响请求）。

    【2026-11-22 复核】曾计划改为 messages[:-1] 的"去尾指纹"以检测前缀发散，
    予以否决：循环轮次里第 N+1 轮的 messages[:-1] 含第 N 轮的 assistant 回复，
    而它当时尚未发过上游，"去尾相等"永远不成立，语义站不住。发散观测由
    snapshot() 按 box 的 append-only 模拟（top_waste_boxes / heavy_miss_rate）
    承担，本指纹保留"完全相同请求体重发"的检测语义。
    """
    try:
        if isinstance(body, dict):
            msgs = body.get('messages')
            if msgs is None and isinstance(body.get('_body'), dict):
                msgs = body['_body'].get('messages')
        else:
            msgs = body
        data = serialize_payload(msgs if msgs is not None else {})
    except Exception:
        data = b''
    return hashlib.sha1(data).hexdigest()[:_MAX_FPLEN] if data else ''


_SINCE_TRIM = 0        # 距上次行数裁剪的追加条数
_TRIM_EVERY = 500      # 每追加 500 条触发一次裁剪（上限 _MAX_LINES，防止 jsonl 无界膨胀）


def record_usage(provider, model, usage, box_id='', fp='', title=''):
    """追加一条用量观测（含指纹，用于命中率统计）。失败静默（观测不阻断业务）。"""
    global _SINCE_TRIM
    try:
        rec = {'ts': int(time.time()),
               'provider': str(provider or ''), 'model': str(model or ''),
               'box_id': str(box_id or ''), 'fp': str(fp or '')[:_MAX_FPLEN],
               'title': str(title or '')[:120],
               'prompt': int((usage or {}).get('prompt_tokens') or 0),
               'completion': int((usage or {}).get('completion_tokens') or 0),
               'cached': int((usage or {}).get('cached_tokens') or 0)}
        p = _path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        need_trim = False
        with _LOCK:
            with open(p, 'a', encoding='utf-8') as f:
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            _SINCE_TRIM += 1
            if _SINCE_TRIM >= _TRIM_EVERY:
                _SINCE_TRIM = 0
                need_trim = True
        if need_trim:
            _trim_if_needed()   # 锁外执行（内部自取 _LOCK）
    except Exception:
        pass


def _load_tail(n=2000):
    """读末尾 n 行（文件坏行忽略）。"""
    try:
        p = _path()
        if not os.path.exists(p):
            return []
        with _LOCK:
            with open(p, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()[-n:]
        out = []
        for ln in lines:
            try:
                out.append(json.loads(ln))
            except Exception:
                continue
        return out
    except Exception:
        return []


def snapshot():
    """池状态快照里的 cache_watch 段：最近观测 + 指纹命中率。

    【2026-11-22 增强】新增：
      heavy_miss_rate  重损调用占比（cached/prompt < 0.5，浪费集中度信号）
      top_waste_boxes  按 box 聚合的前缀发散损失 top5（append-only 假设近似）
    """
    recs = _load_tail()
    if not recs:
        return {}
    calls = len(recs)
    cached_sum = sum(r.get('cached', 0) for r in recs)
    prompt_sum = sum(r.get('prompt', 0) for r in recs)
    seen = {}
    repeat_hits = 0
    heavy_calls = 0
    for r in recs:
        fp = r.get('fp') or ''
        if fp:
            if fp in seen:
                repeat_hits += 1
            seen[fp] = True
        p = r.get('prompt', 0)
        if p > 0 and r.get('cached', 0) / p < 0.5:
            heavy_calls += 1
    # 按 box 近似发散损失：append-only 假设下第 i 轮理想可命中
    # = min(prompt_i, 上一轮已见前缀)，与实际 cached 的差即发散/过期损失
    box_seq = {}
    for r in recs:
        box_seq.setdefault(str(r.get('box_id') or '?'), []).append(r)
    box_div = {}
    for box, rs in box_seq.items():
        rs.sort(key=lambda x: x.get('ts', 0))
        prev = 0
        loss = 0
        for i, r in enumerate(rs):
            p, c = r.get('prompt', 0), r.get('cached', 0)
            if i and p:
                loss += max(0, min(p, prev) - c)
            if p or r.get('completion', 0):
                prev = max(prev, p + r.get('completion', 0))
        if loss > 0:
            box_div[box[:32]] = int(loss)
    top = sorted(box_div.items(), key=lambda x: -x[1])[:5]
    return {'observed_calls': calls,
            'window': len(recs),
            'cached_tokens': cached_sum,
            'prompt_tokens': prompt_sum,
            'cache_hit_rate': (round(cached_sum / prompt_sum, 4)
                               if prompt_sum > 0 else None),
            'repeat_prefix_rate': (round(repeat_hits / calls, 4)
                                   if calls > 0 else None),
            'heavy_miss_rate': (round(heavy_calls / calls, 4)
                                if calls > 0 else None),
            'top_waste_boxes': [{'box': b, 'divergence_tokens': d} for b, d in top],
            'last_ts': recs[-1].get('ts')}


def _trim_if_needed():
    """超行数时保留末尾 _MAX_LINES 行。"""
    try:
        p = _path()
        if not os.path.exists(p):
            return
        with _LOCK:
            with open(p, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()
            if len(lines) > _MAX_LINES:
                with open(p, 'w', encoding='utf-8') as f:
                    f.writelines(lines[-_MAX_LINES:])
    except Exception:
        pass
