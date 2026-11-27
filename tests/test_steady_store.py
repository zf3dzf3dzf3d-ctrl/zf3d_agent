# -*- coding: utf-8 -*-
"""steady_store 可移植模块独立测试——不依赖服务器上下文，任何电脑任何 cwd 可直接跑。

    py tests/test_steady_store.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'server'))

from engines.common.steady_store import JobStore, is_terminal, TERMINAL_STATES  # noqa: E402

td = tempfile.mkdtemp(prefix='steady_store_test_')
st = JobStore(os.path.join(td, 'jobs.json'))

# S1 阶段态 + meta 合并 + 原子写无残留
assert st.update('j1', 'claimed', role='r', task='任务', meta={'tid': 't1', 'source': 'trustee'})
assert st.update('j1', 'working')
rec = st.snapshot()[0]
assert rec['tid'] == 't1' and rec['source'] == 'trustee' and rec['state'] == 'working'
assert st.update('j1', 'done', review_state='done', result='完成')
assert st.snapshot()[0]['state'] == 'done'
assert not os.path.exists(st.path + '.tmp')
print('S1 阶段态+meta+原子写 OK')

# S2 心跳节流
assert st.touch('j1') is False  # 30s 窗口内跳过
assert st.touch('j1', min_gap=0) is True  # min_gap=0 立即刷
print('S2 心跳节流 OK')

# S3 损坏文件容错（黑匣子坏了不许炸）
with open(st.path, 'w', encoding='utf-8') as f:
    f.write('{"jobs": [半截损坏')
assert st.load() == {} and st.snapshot() == []
assert st.update('j2', 'claimed', task='重建')  # 损坏后仍可重建
print('S3 损坏容错 OK')

# S4 mark_stale_dead + 预算复活 + 不套娃 + prepare/skip
st2 = JobStore(os.path.join(td, 'jobs2.json'))
st2.update('a1', 'working', role='旧角色', task='单A', meta={'tid': 'ta', 'source': 'trustee'})
st2.update('a2', 'reviewing', role='r2', task='单B')
st2.update('a3', 'done')
dead = st2.mark_stale_dead()
assert len(dead) == 2 and all(d['state'] == 'dead' for d in dead)
assert st2.snapshot()[0]['state'] == 'done'  # 终态不动（快照最新在头部，a3 是最新）
calls = []
def _dispatch(role, task, meta):
    calls.append((role, task, meta))
    return {'ok': True, 'job_id': 'new-%d' % len(calls)}
def _prepare(rec):
    role = rec.get('role') or ''
    if role == '旧角色':
        role = '换人'  # 模拟失踪村民换人
    return role, rec.get('task') or {}, {'tid': rec.get('tid'),
                                          'source': rec.get('source') or 'assign',
                                          'revived_from': rec.get('job_id')}
n = st2.revive(reversed(dead), dispatch=_dispatch, budget=1, prepare=_prepare)
assert n == 1 and len(calls) == 1
assert calls[0][0] == '换人' and calls[0][2]['revived_from'] == 'a1'  # FIFO 旧单先
snap = {j['job_id']: j for j in st2.snapshot()}
assert snap['a1']['revived_as'] == 'new-1' and snap['a2']['state'] == 'dead'
# 复活单再死不套娃（a2 首轮已定性 dead 是终态；补一张新单 a4 对照）
st2.update('new-1', 'working', role='换人', task='单A',
           meta={'revived_from': 'a1'})
st2.update('a4', 'working', role='r4', task='单D')
dead2 = st2.mark_stale_dead()
calls.clear()
n2 = st2.revive(dead2, dispatch=_dispatch, budget=5,
                skip=lambda j: bool(j.get('revived_from')))
assert n2 == 1 and len(calls) == 1 and calls[0][2]['revived_from'] == 'a4'  # new-1 被 skip，只复活 a4
print('S4 复活预算/不套娃/prepare换人 OK')

# S5 active 在途探测（含阈值）
st3 = JobStore(os.path.join(td, 'jobs3.json'))
st3.update('z1', 'working', task='t')
assert st3.active() == 1
st3.update('z1', 'failed', result='x')
assert st3.active() == 0
assert is_terminal('dead') and not is_terminal('working') and TERMINAL_STATES == ('done', 'failed', 'dead')
print('S5 active 探测 OK')

# S6 上限裁剪
for i in range(230):
    st3.update('b%d' % i, 'done', result='x')
assert len(st3.snapshot()) == 200
print('S6 上限裁剪 OK')

print('\nsteady_store: ALL 6 TEST GROUPS PASSED')
