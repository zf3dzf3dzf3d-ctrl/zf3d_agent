# -*- coding: utf-8 -*-
"""
trace_core.py —— 结构化可观测（零依赖）
每次对话/蜂群批次生成 trace_id，LLM调用、工具调用、蜂群事件统一写 JSONL。
文件: data/traces/trace-YYYYMMDD.jsonl，每行: {ts, trace_id, span_id, parent_span, type, name, status, duration_ms, meta}
用法:
    t = Trace('conv-123'); span = t.span('llm', name='chat'); ... span.end(status='ok', meta={...})
"""
import json
import os
import threading
import time
import uuid
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRACE_DIR = os.path.join(BASE_DIR, 'data', 'traces')
_wlock = threading.Lock()


def new_trace_id(prefix='trace'):
    return '%s-%s' % (prefix, uuid.uuid4().hex[:12])


def _write(record):
    try:
        os.makedirs(TRACE_DIR, exist_ok=True)
        fn = os.path.join(TRACE_DIR, 'trace-%s.jsonl' % datetime.now().strftime('%Y%m%d'))
        with _wlock:
            with open(fn, 'a', encoding='utf-8') as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + '\n')
    except Exception:
        pass  # 观测永不抛错影响主流程


class Span:
    def __init__(self, trace, stype, name='', parent=''):
        self.trace_id = trace.trace_id if hasattr(trace, 'trace_id') else str(trace)
        self.span_id = uuid.uuid4().hex[:10]
        self.parent = parent
        self.type = stype
        self.name = name
        self.status = 'running'
        self.meta = {}
        self.t0 = time.time()
        _write(self._rec('start'))

    def _rec(self, ev):
        return {'ts': datetime.now().isoformat(timespec='milliseconds'), 'event': ev,
                'trace_id': self.trace_id, 'span_id': self.span_id, 'parent_span': self.parent,
                'type': self.type, 'name': self.name, 'status': self.status,
                'duration_ms': round((time.time() - self.t0) * 1000, 1) if ev == 'end' else None,
                'meta': self.meta}

    def end(self, status='ok', **meta):
        self.status = status
        if meta:
            self.meta.update(meta)
        _write(self._rec('end'))

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.status == 'running':
            self.end(status='error' if exc else 'ok',
                     error=str(exc) if exc else None)


class Trace:
    def __init__(self, trace_id=None):
        self.trace_id = trace_id or new_trace_id()

    def span(self, stype, name='', parent=''):
        return Span(self, stype, name, parent)

    def event(self, stype, name='', status='ok', parent='', **meta):
        s = Span(self, stype, name, parent)
        if meta:
            s.meta.update(meta)
        s.end(status)


def query(trace_id=None, date=None, limit=200):
    """按 trace_id 或日期查 trace 记录（供诊断工具/页面使用）。"""
    import glob as _g
    pats = [os.path.join(TRACE_DIR, 'trace-%s.jsonl' % date)] if date else \
           _g.glob(os.path.join(TRACE_DIR, 'trace-*.jsonl'))
    out = []
    for p in sorted(pats, reverse=True):
        try:
            with open(p, encoding='utf-8') as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if trace_id and r.get('trace_id') != trace_id:
                        continue
                    out.append(r)
                    if len(out) >= limit:
                        return out
        except OSError:
            continue
    return out


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    t = Trace()
    with t.span('llm', name='chat') as s:
        time.sleep(0.05)
        s.end(meta={'model': 'glm-4', 'tokens': 120})
    with t.span('tool', name='search') as s:
        pass
    t.event('swarm', name='batch-b1', status='ok', subtasks=3)
    print('written, query:', len(query(t.trace_id)), 'records for', t.trace_id)
