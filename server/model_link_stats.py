# -*- coding: utf-8 -*-
"""
model_link_stats.py —— 大模型链路统计（方案A：被动统计，零额外请求）

每次真实上游请求结束时记录：首字延迟（TTFT）、生成速率（tok/s）、成功/失败。
内存保存每模型最近 N 条，并节流落盘到 private/model_link_stats.json。
前端经 /api/model-link-stats 查询，对话框头部徽章显示「通/不通 + 速率」。

设计要点：
- 无后台线程、无探测请求：只在真实请求完成时计一次（不增加任何上游流量）
- 落盘节流：最多每 10 秒写一次磁盘；异常全部吞掉（绝不影响主流程）
- 可关：settings 里 model_link_stats.enabled=false 时 record() 直接返回
"""
import json
import logging
import os
import threading
import time

_MAX_PER_MODEL = 30          # 每模型保留最近 30 条
_DISK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          '..', 'private', 'model_link_stats.json')
_FLUSH_INTERVAL = 10.0       # 落盘节流（秒）

_LOCK = threading.Lock()
_RECORDS = {}                # model -> [ {t, ttft_ms, dur_ms, ctok, ok, err}, ... ]
_LAST_FLUSH = 0.0
_LOADED = False


def _cfg_enabled():
    """设置开关：private/settings.json 的 model_link_stats.enabled，默认 true"""
    try:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         '..', 'private', 'settings.json')
        with open(p, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return bool(cfg.get('model_link_stats', {}).get('enabled', True))
    except Exception:
        return True


def is_enabled():
    """对外暴露开关状态（每次实时读，改 settings.json 立即生效）"""
    return _cfg_enabled()


def _load():
    global _LOADED, _RECORDS
    if _LOADED:
        return
    _LOADED = True
    try:
        with open(_DISK_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            _RECORDS = data
    except Exception:
        _RECORDS = {}


def _flush_locked():
    """节流落盘（调用方已持锁）。异常吞掉。"""
    global _LAST_FLUSH
    now = time.time()
    if now - _LAST_FLUSH < _FLUSH_INTERVAL:
        return
    _LAST_FLUSH = now
    try:
        os.makedirs(os.path.dirname(_DISK_PATH), exist_ok=True)
        tmp = _DISK_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(_RECORDS, f, ensure_ascii=False)
        os.replace(tmp, _DISK_PATH)
    except Exception:
        logging.debug('[model_link_stats] flush skip', exc_info=True)


def record(model, ok, ttft_ms=None, dur_ms=None, completion_tokens=None, err=''):
    """记录一次上游请求结果。任何异常静默——绝不影响主流程。"""
    try:
        if not _cfg_enabled():
            return
        if not model:
            model = 'unknown'
        entry = {
            't': round(time.time(), 3),
            'ok': bool(ok),
            'ttft_ms': int(ttft_ms) if ttft_ms is not None else None,
            'dur_ms': int(dur_ms) if dur_ms is not None else None,
            'ctok': int(completion_tokens) if completion_tokens else None,
            'err': str(err or '')[:120],
        }
        if entry['ok'] and entry['ttft_ms'] is None:
            entry['ttft_ms'] = entry['dur_ms']  # 非流式：首字≈总耗时
        with _LOCK:
            _load()
            lst = _RECORDS.setdefault(model, [])
            lst.append(entry)
            del lst[:-_MAX_PER_MODEL]
            _flush_locked()
    except Exception:
        logging.debug('[model_link_stats] record skip', exc_info=True)


class Timer(object):
    """上下文管理器：with Timer(model, payload=..) as t: ... ; t.mark_first()"""
    def __init__(self, model):
        self.model = model
        self.t0 = time.time()
        self.t_first = None
        self.ok = False
        self.err = ''
        self.completion_tokens = None

    def mark_first(self):
        if self.t_first is None:
            self.t_first = time.time()

    def finish(self, ok, err='', completion_tokens=None):
        self.ok = bool(ok)
        self.err = err
        self.completion_tokens = completion_tokens
        try:
            dur_ms = (time.time() - self.t0) * 1000.0
            ttft = ((self.t_first or time.time()) - self.t0) * 1000.0
            record(self.model, self.ok,
                   ttft_ms=ttft if self.t_first else None,
                   dur_ms=dur_ms,
                   completion_tokens=self.completion_tokens,
                   err=self.err)
        except Exception:
            pass

    # 支持 with 用法但 finish 需显式调（流式场景首字在中途标记）
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc and not self.ok:
            self.finish(False, err=str(exc))
        return False


def summary(model=None):
    """给前端的摘要。model=None 时返回全部模型的摘要。
    每模型：{ok, state, ttft_ms, tps, last_ts, err, recent:[...最近5条]}"""
    with _LOCK:
        _load()
        models = {model: _RECORDS.get(model, [])} if model else dict(_RECORDS)
    out = {}
    for m, lst in models.items():
        if not lst:
            out[m] = {'state': 'unknown', 'ttft_ms': None, 'tps': None,
                      'last_ts': None, 'err': '', 'recent': []}
            continue
        last = lst[-1]
        oks = [e for e in lst if e.get('ok') and e.get('ctok') and e.get('dur_ms')]
        tps = None
        if oks:
            e = oks[-1]
            tps = round(e['ctok'] / (e['dur_ms'] / 1000.0), 1)
        ttfts = [e['ttft_ms'] for e in lst if e.get('ok') and e.get('ttft_ms')]
        out[m] = {
            'state': 'ok' if last.get('ok') else 'fail',
            'ttft_ms': ttfts[-1] if ttfts else None,
            'tps': tps,
            'last_ts': last.get('t'),
            'err': (last.get('err') or '') if not last.get('ok') else '',
            'recent': [
                {'t': e.get('t'), 'ok': e.get('ok'),
                 'ttft_ms': e.get('ttft_ms'), 'tps': _e_tps(e)}
                for e in lst[-5:]
            ],
        }
    return out


def _e_tps(e):
    try:
        if e.get('ok') and e.get('ctok') and e.get('dur_ms'):
            return round(e['ctok'] / (e['dur_ms'] / 1000.0), 1)
    except Exception:
        pass
    return None
