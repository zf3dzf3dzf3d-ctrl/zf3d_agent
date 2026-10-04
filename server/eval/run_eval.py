# -*- coding: utf-8 -*-
"""
server/eval/ - 最小评测集（C1）
================================
目标：每次改动后一键跑分，量化验证没有引入回归。

分两类：
1. offline（默认跑）：纯本地、零 API 消耗
   - 单元用例：预算函数 _budget_usage / _budget_check、快照保存、
     converge_validator 冲突检测、self_check 运行时数据识别
   - 内核用例：mock 引擎跑 run_agent_loop（假上游，验证循环/工具回填/终止条件）
2. live（--live 才跑）：真实调上游 API 的端到端用例（消耗 token，谨慎用）

用法：
    python server/eval/run_eval.py              # 跑全部 offline 用例
    python server/eval/run_eval.py -k budget    # 按关键词过滤
    python server/eval/run_eval.py --live       # 追加 live 用例

输出：每条用例 PASS/FAIL + 末尾汇总（通过率、耗时），退出码 0=全过 1=有挂。
"""
import os
import sys
import json
import time
import argparse
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.dirname(HERE)
ROOT = os.path.dirname(SERVER)
sys.path.insert(0, SERVER)

from engines.common import agent_loop  # noqa: E402

CASES = []  # (name, fn, kind)


def case(name, kind='offline'):
    def deco(fn):
        CASES.append((name, fn, kind))
        return fn
    return deco


def expect(cond, msg=''):
    if not cond:
        raise AssertionError(msg or 'expect failed')


# ============ 单元：预算 ============

@case('budget.usage_with_usage_field')
def _():
    expect(agent_loop._budget_usage({'usage': {'total_tokens': 123}}) == 123)
    expect(agent_loop._budget_usage({'usage': {'prompt_tokens': 10, 'completion_tokens': 5}}) == 15)


@case('budget.usage_fallback_estimate')
def _():
    # 缺 usage：按 message 文本估算，不得为 0（防预算偏松）
    r = {'choices': [{'message': {'content': '你好世界' * 100}}]}
    v = agent_loop._budget_usage(r)
    expect(v >= 100, '估算值应显著大于0, got %s' % v)
    # 完全空响应也要有最小兜底
    expect(agent_loop._budget_usage({}) >= 1)


@case('budget.check_env')
def _():
    os.environ['ZF_TOKEN_BUDGET'] = '5000'
    expect(agent_loop._budget_check() == 5000)
    os.environ['ZF_TOKEN_BUDGET'] = 'abc'
    expect(agent_loop._budget_check() == 0)
    del os.environ['ZF_TOKEN_BUDGET']


@case('budget.snapshot_roundtrip')
def _():
    eng = 'eval_mock_engine'
    msgs = [{'role': 'user', 'content': '评测快照'}]
    p = agent_loop._budget_snapshot_save(eng, msgs, spent=111, budget=222)
    expect(p and os.path.isfile(p), '快照文件未落盘')
    with open(p, 'r', encoding='utf-8') as f:
        data = json.load(f)
    expect(data.get('resume_messages') == msgs, 'resume_messages 缺失')
    expect(data.get('spent_tokens') == 111 and data.get('budget') == 222)
    os.remove(p)


# ============ 单元：收敛校验器 ============

@case('converge.detect_conflicts')
def _():
    spec = __import__('importlib').import_module('converge_validator') \
        if os.path.isfile(os.path.join(SERVER, 'converge_validator.py')) else None
    expect(spec is not None, 'converge_validator.py 不存在')
    branches = {
        'A': '任务完成，已写入 server/a.py，成功率 95%',
        'B': '任务失败，改动了 server/a.py 但报错，成功率 60%',
    }
    rep = spec.validate_convergence(branches, context='评测')
    expect(rep.get('conflict') and rep.get('items'), '应检出冲突: %s' % rep)
    rules = {it['rule'] for it in rep['items']}
    expect('file_write_conflict' in rules, '应检出文件写入冲突')


# ============ 内核：mock 引擎跑循环 ============

class MockEngine:
    """假引擎：脚本化回复序列，验证内核循环行为，零 API 消耗。"""

    def __init__(self, script=None):
        self.script = list(script or [])   # 每轮要返回的 (content, tool_calls)
        self.executed = []

    def compact_messages(self, messages):
        return messages

    def get_tool_schemas(self):
        return [{'type': 'function', 'function':
                 {'name': 'echo', 'description': '回显',
                  'parameters': {'type': 'object', 'properties': {'text': {'type': 'string'}}}}}]

    def execute_tool_calls(self, tool_calls, ctx):
        out = []
        for tc in tool_calls:
            self.executed.append(tc.get('function', {}).get('name'))
            out.append({'tool_call_id': tc.get('id'), 'role': 'tool',
                        'content': 'echo-ok', '_ok': True})
        return out


def _fake_upstream(script):
    """构造 fake _call_upstream；并返回如何 patch：函数 __globals__ 指向 exec 的 _NS，
    所以必须 patch run_agent_loop.__globals__['_call_upstream']，而不是模块属性。"""
    state = {'i': 0}

    def fake_call(ctx, payload):
        i = min(state['i'], len(script) - 1)
        state['i'] += 1
        content, tool_calls = script[i]
        msg = {'role': 'assistant', 'content': content}
        if tool_calls:
            msg['tool_calls'] = tool_calls
        return {'choices': [{'message': msg}],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 5}}

    return fake_call


def _patch_upstream(fake):
    G = agent_loop.run_agent_loop.__globals__
    G['_call_upstream'] = fake


@case('kernel.loop_with_tool_roundtrip')
def _():
    tc = {'id': 'c1', 'type': 'function',
          'function': {'name': 'echo', 'arguments': '{"text":"hi"}'}}
    eng = MockEngine()
    G = agent_loop.run_agent_loop.__globals__
    orig = G.get('_call_upstream')
    _patch_upstream(_fake_upstream([('调用工具', [tc]), ('任务完成', None)]))
    try:
        resp = agent_loop.run_agent_loop(
            'eval_mock', eng, [{'role': 'user', 'content': '跑一下'}], {'target_url': '', 'headers': {}})
        expect(resp['choices'][0]['message']['content'] == '任务完成')
        expect(eng.executed == ['echo'], '工具应被执行一次: %s' % eng.executed)
    finally:
        G['_call_upstream'] = orig


@case('kernel.loop_max_rounds_hard_stop')
def _():
    tc = {'id': 'c2', 'type': 'function',
          'function': {'name': 'echo', 'arguments': '{}'}}
    eng = MockEngine()
    G = agent_loop.run_agent_loop.__globals__
    orig = G.get('_call_upstream')
    # 无限回工具：必须被 MAX_ROUNDS 硬截断而非死循环
    _patch_upstream(_fake_upstream([('继续', [tc])] * 9999))
    try:
        os.environ['ZF_MAX_ROUNDS'] = '5'
        import importlib
        importlib.reload(agent_loop)
        _patch_upstream(_fake_upstream([('继续', [tc])] * 9999))
        t0 = time.time()
        resp = agent_loop.run_agent_loop(
            'eval_mock', eng, [{'role': 'user', 'content': '死循环?'}], {'target_url': '', 'headers': {}})
        expect(time.time() - t0 < 30, '循环未在时限内终止')
        expect(resp and resp.get('choices'), '应返回强制总结响应而非挂死')
        expect(eng.executed.count('echo') <= 8, '工具执行次数应受限')
    finally:
        del os.environ['ZF_MAX_ROUNDS']
        importlib.reload(agent_loop)
        G['_call_upstream'] = orig


# ============ B1：向量记忆检索 ============

@case('vecmem.hybrid_search')
def _():
    from engines.common.vector_memory import search_memory
    r = search_memory('预算超限快照续跑')
    expect(r.get('_ok'), '检索失败: %s' % r)
    hits = r.get('hits') or []
    expect(hits, '记忆库非空但零命中')
    expect(hits[0]['score'] >= hits[-1]['score'], '得分未降序')
    # 空查询拒绝
    expect(not search_memory('  ').get('_ok'), '空 query 应拒绝')


# ============ D1：链路追踪 ============

@case('trace.roundtrip_and_span')
def _():
    import trace_core
    t = trace_core.Trace()
    with t.span('subtask', name='eval/s1') as s:
        pass
    recs = trace_core.query(t.trace_id)
    events = [r.get('event') for r in recs]
    expect('start' in events and 'end' in events, 'span 应成对记录(start/end): %s' % events)
    end = [r for r in recs if r.get('event') == 'end'][0]
    expect(end.get('status') == 'ok', 'span 默认结束状态应为 ok')
    expect(end.get('duration_ms') is not None, 'end 记录应带 duration_ms')
    # 负样本：未知 trace_id 查询不抛错
    expect(isinstance(trace_core.query('sw-nonexistent'), list))


@case('trace.swarm_batch_carries_trace_id')
def _():
    import time as _t
    import dispatch_swarm as dsw
    import trace_core
    bid = dsw.submit([{'goal': 'eval-trace-smoke'}])
    _t.sleep(1.5)
    b = dsw._BATCHES.get(bid)
    expect(b is not None, '批次未注册')
    tid = b.get('trace_id')
    expect(bool(tid), '批次应携带 trace_id')
    recs = trace_core.query(tid)
    kinds = [r.get('type') for r in recs]
    expect('swarm' in kinds and 'subtask' in kinds,
           'trace 应含 batch+subtask 记录: %s' % kinds)


# ============ D2：Key 体检 ============

@case('keyaudit.no_plaintext_in_report')
def _():
    import key_audit as ka
    r = ka.audit_keys()
    blob = json.dumps(r, ensure_ascii=False)
    expect('sk-' not in blob, '体检报告不得包含 sk- 明文')
    for it in r['items']:
        expect(len(it.get('hash8', '')) == 8, '指纹应为8位短哈希')


@case('keyaudit.tmp_detects_plain_and_leak')
def _():
    import tempfile
    import key_audit as ka
    import secure_store
    d = tempfile.mkdtemp(prefix='eval_ka_')
    kf = os.path.join(d, 'api_keys.json')
    json.dump({'_meta': {'encrypted': True},
               'keys': {'jm': secure_store.encrypt_value('sk-eval-enc'),
                        'mw': 'sk-eval-plain'}},
              open(kf, 'w', encoding='utf-8'))
    mf = os.path.join(d, 'models.json')
    json.dump({'models': [{'name': 'jd', 'key': 'sk-eval-leak'}]},
              open(mf, 'w', encoding='utf-8'))
    _sv = (ka._KEYS_FILE, ka._MODELS_FILE, ka._SECRET_FILE, ka._AUDIT_FILE)
    ka._KEYS_FILE, ka._MODELS_FILE = kf, mf
    ka._SECRET_FILE = os.path.join(d, 'none.txt')
    ka._AUDIT_FILE = os.path.join(d, 'none.jsonl')
    try:
        r = ka.audit_keys()
        ws = '|'.join(r['warnings'])
        expect('mw' in ws and 'jd' in ws, '应同时检出明文Key与公开区夹带')
        expect(not r['ok'], '有警告时 ok 应为 False')
        expect('sk-eval-plain' not in ws and 'sk-eval-leak' not in ws,
               '警告文本不得包含Key明文')
    finally:
        (ka._KEYS_FILE, ka._MODELS_FILE, ka._SECRET_FILE, ka._AUDIT_FILE) = _sv


# ============ 预算兜底补充 ============

@case('budget.max_turns_alias_takes_min')
def _():
    # ZF_MAX_ROUNDS 为 MAX_TURNS 别名：取两者更低者（seg1 顶部逻辑）
    os.environ['ZF_MAX_ROUNDS'] = '4'
    try:
        import importlib
        importlib.reload(agent_loop)
        expect(agent_loop.MAX_TURNS == 4,
               'ZF_MAX_ROUNDS=4 应把 MAX_TURNS 压到 4, got %s' % agent_loop.MAX_TURNS)
    finally:
        os.environ.pop('ZF_MAX_ROUNDS', None)
        importlib.reload(agent_loop)


# ============ 收敛校验补充 ============

@case('converge.no_conflict_pass')
def _():
    spec = __import__('importlib').import_module('converge_validator')
    branches = {
        'A': '任务完成，已写入 server/x1.py，成功率 90%',
        'B': '任务完成，未改任何文件，成功率 88%',
    }
    rep = spec.validate_convergence(branches, context='评测')
    rules = {it['rule'] for it in rep.get('items', [])}
    expect('file_write_conflict' not in rules, '无写冲突场景不应误报')


# ============ D4：记忆老化 ============

@case('vecmem.aging_decay_and_whitelist')
def _():
    import time as _t
    import tempfile
    import engines.common.vector_memory as vm
    tmp = os.path.join(tempfile.gettempdir(), 'eval_aging_%d' % os.getpid())
    os.makedirs(tmp, exist_ok=True)
    content = '# 评测记忆\n预算超限快照续跑机制，token 花费控制。' * 20
    open(os.path.join(tmp, '旧文件.md'), 'w', encoding='utf-8').write(content)
    open(os.path.join(tmp, '白名单.md'), 'w', encoding='utf-8').write(content)
    old_ts = _t.time() - 180 * 86400
    os.utime(os.path.join(tmp, '旧文件.md'), (old_ts, old_ts))
    _sv = (vm.MEM_DIRS, vm.INDEX_PATH, vm.AGING_ON, vm.AGING_WHITELIST)
    vm.MEM_DIRS, vm.INDEX_PATH = [tmp], os.path.join(tmp, '_idx.json')
    vm.AGING_ON, vm.AGING_WHITELIST = True, {'白名单.md'}
    try:
        r = vm.search_memory('预算超限快照续跑')
        hits = {h['file']: h for h in r['hits']}
        expect('旧文件.md' in hits and '白名单.md' in hits, '两文件都应命中')
        expect(hits['旧文件.md']['score'] < hits['白名单.md']['score'], '旧文件应降权')
        expect(hits['旧文件.md'].get('aged') == 0.25, '180天/30天半衰期应衰减到0.25')
        expect('aged' not in hits['白名单.md'], '白名单不应降权')
        vm.AGING_ON = False
        r2 = vm.search_memory('预算超限快照续跑')
        h2 = {h['file']: h['score'] for h in r2['hits']}
        expect(h2['旧文件.md'] == h2['白名单.md'], '关闭老化后得分应一致')
    finally:
        (vm.MEM_DIRS, vm.INDEX_PATH, vm.AGING_ON, vm.AGING_WHITELIST) = _sv
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


# ============ runner ============

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-k', default='', help='用例名关键词过滤')
    ap.add_argument('--live', action='store_true', help='附带 live 用例（耗 API）')
    args = ap.parse_args()

    picked = [(n, f, k) for n, f, k in CASES
              if args.k in n and (args.live or k == 'offline')]
    passed = failed = 0
    t0 = time.time()
    for name, fn, kind in picked:
        try:
            fn()
            print('PASS  %s' % name)
            passed += 1
        except Exception as e:
            print('FAIL  %s  -> %s' % (name, e))
            traceback.print_exc(limit=2)
            failed += 1
    total = passed + failed
    print('-' * 46)
    print('通过 %d/%d  耗时 %.1fs  (%s)' % (passed, total, time.time() - t0,
                                            'live+offline' if args.live else 'offline only'))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
