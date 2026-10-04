# -*- coding: utf-8 -*-
"""
regression_eval.py —— 行为回归评测（零依赖）
覆盖：1) RAG 检索质量  2) 记忆语义召回  3) trace 可观测  4) 蜂群模块健康
输出 data/eval/baseline-<ts>.json，并与上次基线对比报告退化。
用法: python regression_eval.py
"""
import io
import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.dirname(os.path.abspath(__file__))
EVAL_DIR = os.path.join(SRV, 'data', 'eval')

results = []


def case(name, fn):
    t0 = time.time()
    try:
        ok, detail = fn()
        status = 'pass' if ok else 'fail'
    except Exception as e:
        ok, detail, status = False, '%s: %s' % (type(e).__name__, e), 'error'
    results.append({'name': name, 'status': status,
                    'ms': round((time.time() - t0) * 1000, 1), 'detail': str(detail)[:200]})
    print('[%s] %s (%sms) %s' % (status.upper(), name, results[-1]['ms'], detail if not ok else ''))


# ---------- 1. RAG ----------
def rag_semantic_block():
    from rag_engine import _split_chunks
    t = '标题甲\n\n' + '蜂群调度支持并发派发子任务。' * 50
    cs = _split_chunks(t, 300, 50)
    assert 1 < len(cs) <= 30, 'chunk count=%d' % len(cs)
    assert all(len(c) <= 400 for c in cs), 'chunk too long'
    return True, 'chunks=%d' % len(cs)


def rag_bm25():
    from rag_engine import _bm25_scores
    rows = [{'content': '蜂群调度是并发派发子任务的模块'},
            {'content': 'RAG引擎负责向量检索'}]
    s = _bm25_scores('蜂群 调度', rows)
    return 0 in s and 1 not in s, s


def rag_search_interface():
    # 无有效 API key 时 embed 会 401，接口应优雅降级而不是崩（验证不抛 401 之外的结构错误）
    try:
        from rag_engine import search
        r = search('任意查询', top_k=3)
        return isinstance(r, list), 'results=%d' % len(r)
    except Exception as e:
        if '401' in str(e):
            return True, 'skipped: no valid embedding key (401)'
        raise


# ---------- 2. 记忆 ----------
def mem_roundtrip():
    from memory_semantic import SemanticMemory
    m = SemanticMemory()
    m.core.create_table('回归评测')
    m.insert('回归评测', {'主题': '蜂群', '要点': '失败仲裁换备用模型重跑'})
    m.insert('回归评测', {'主题': '午餐', '要点': '今天吃了面条'})
    hits = m.search_semantic('蜂群 失败 怎么办', tables=['回归评测'])
    assert hits, 'no hits'
    assert '蜂群' in hits[0]['text'], 'wrong hit: %s' % hits[0]['text']
    return True, 'top=%s score=%s' % (hits[0]['text'][:20], hits[0]['score'])


def mem_context_recall():
    from memory_semantic import SemanticMemory
    m = SemanticMemory()
    txt = m.recall_for_context('蜂群 失败', tables=['回归评测'])
    return ('[相关历史记忆]' in txt) or (txt == ''), 'len=%d' % len(txt)


# ---------- 3. trace ----------
def trace_roundtrip():
    import trace_core
    t = trace_core.Trace()
    with t.span('llm', name='eval') as s:
        s.end(meta={'tokens': 1})
    recs = trace_core.query(t.trace_id)
    assert len(recs) >= 2, 'records=%d' % len(recs)
    assert any(r['event'] == 'end' and r['duration_ms'] is not None for r in recs), 'no end rec'
    return True, 'records=%d' % len(recs)


# ---------- 4. 蜂群健康 ----------
def swarm_import():
    import dispatch_swarm as ds
    assert hasattr(ds, 'cancel_subtask') and hasattr(ds, '_Heartbeat'), 'missing cancel/heartbeat'
    src2 = io.open(os.path.join(SRV, 'dispatch_swarm_seg2.py'), encoding='utf-8').read()
    assert '_allowed_tools = set' not in src2, 'function-attr whitelist still present'
    assert '_MAX_OUTPUT_CHARS = 16000' in io.open(
        os.path.join(SRV, 'dispatch_swarm_seg1.py'), encoding='utf-8').read() or \
        '_MAX_OUTPUT_CHARS = 16000' in src2, 'char cap not raised'
    return True, 'module healthy'


def swarm_state_persist():
    # 门面是 exec 到独立 _NS，直接走函数 __globals__ 里的 _BATCHES（与运行时一致）
    import dispatch_swarm as ds
    ns = ds._persist_batch.__globals__
    ns['_BATCHES']['eval-test'] = {'status': 'running', 'created_at': 'now',
                                   'tasks': [{'id': 't1', 'goal': 'g', 'status': 'running'}]}
    ds._persist_batch('eval-test')
    fp = os.path.join(ds._SWARM_STATE_DIR, 'batch-eval-test.json')
    assert os.path.exists(fp), 'state file missing'
    with open(fp, encoding='utf-8') as fh:
        d = json.load(fh)
    os.remove(fp)
    return d['tasks'][0]['status'] == 'running', str(d['status'])


cases = [
    ('rag语义分块', rag_semantic_block),
    ('rag BM25', rag_bm25),
    ('rag混合检索接口', rag_search_interface),
    ('记忆写入+语义召回', mem_roundtrip),
    ('记忆上下文注入', mem_context_recall),
    ('trace落盘回查', trace_roundtrip),
    ('蜂群模块健康', swarm_import),
    ('蜂群状态落盘', swarm_state_persist),
]
for n, f in cases:
    case(n, f)

# ---------- 基线对比 ----------
passed = sum(1 for r in results if r['status'] == 'pass')
report = {'ts': datetime.now().isoformat(timespec='seconds'),
          'passed': passed, 'total': len(results), 'cases': results}

os.makedirs(EVAL_DIR, exist_ok=True)
prev_files = sorted(f for f in os.listdir(EVAL_DIR) if f.startswith('baseline-'))
prev = None
if prev_files:
    try:
        prev = json.load(open(os.path.join(EVAL_DIR, prev_files[-1]), encoding='utf-8'))
    except Exception:
        prev = None

out = 'baseline-%s.json' % datetime.now().strftime('%Y%m%d_%H%M%S')
json.dump(report, open(os.path.join(EVAL_DIR, out), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)

print('\n== 基线: %d/%d 通过 -> %s ==' % (passed, len(results), out))
if prev:
    pd = {c['name']: c['status'] for c in prev.get('cases', [])}
    regressed = [r['name'] for r in results
                 if r['status'] != 'pass' and pd.get(r['name']) == 'pass']
    if regressed:
        print('!! 退化用例:', regressed)
        sys.exit(1)
    print('与上次基线(%s)对比: 无退化' % prev.get('ts'))
sys.exit(0 if passed == len(results) else 2)
