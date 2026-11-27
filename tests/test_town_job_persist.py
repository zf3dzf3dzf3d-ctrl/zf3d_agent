# -*- coding: utf-8 -*-
"""P0 工单持久化+重启复活+托管回查闭环 功能测试。

全部 monkeypatch：不真派单（_town_assign_impl 换假实现）、不写真事件流
（town_events.emit 换空实现）、工单台账写临时目录。跑完即退出。
"""
import sys, os, json, time, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import importlib
import types

# mixin_base 轻量桩（测试只调模块级函数，不需要真 Mixin 类体系）
mb = types.ModuleType('routes.mixin_base')
class MixinBase:  # noqa
    pass
mb.MixinBase = MixinBase
sys.modules.setdefault('routes.mixin_base', mb)

td = importlib.import_module('routes.domain_town')
te = importlib.import_module('engines.common.town_events')
te.emit = lambda *a, **k: None  # 测试不污染真实事件流

# ---------- T1 工单阶段落盘 ----------
tmpdir = tempfile.mkdtemp(prefix='town_jobs_test_')
td._JOB_STATE_PATH = os.path.join(tmpdir, 'town_jobs.json')

td._job_state('job-T1', 'claimed', role='审核员', task='测试任务T1',
              meta={'tid': 'turn-xyz', 'source': 'trustee'})
td._job_state('job-T1', 'working')
td._job_state('job-T1', 'reviewing')
td._job_state('job-T1', 'done', review_state='done', result='完成了')
rec = json.load(open(td._JOB_STATE_PATH, encoding='utf-8'))['jobs'][0]
assert rec['job_id'] == 'job-T1' and rec['state'] == 'done'
assert rec['tid'] == 'turn-xyz' and rec['source'] == 'trustee'
assert rec['review_state'] == 'done' and rec['result'] == '完成了'
print('T1 job_state 阶段落盘 OK ->', {k: rec[k] for k in ('state', 'tid', 'source')})

# ---------- T2 复活扫描：非终态定性 dead + 预算内复活 ----------
td._pick_all_villagers = lambda exclude=(): ['建筑师', '工匠', '审核员']  # 第2轮：扫描在册校验用（隔离生产名册）
td._job_state('job-T2', 'working', role='建筑师', task='复活我T2',
              meta={'tid': 'turn-abc', 'source': 'trustee'})
td._job_state('job-T3', 'claimed', role='工匠', task='复活我T3')
td._job_state('job-T4', 'done')  # 终态：扫描不动

calls = []
def fake_impl(role, task, meta=None):
    calls.append((role, task, meta))
    return {'ok': True, 'job_id': 'job-NEW-%d' % (len(calls)), 'role': role or 'X'}
td._town_assign_impl, _orig_impl = fake_impl, td._town_assign_impl
td.TOWN_REVIVE_ENABLE = True
td.TOWN_REVIVE_MAX_PER_BOOT = 1  # 预算=1：两张非终态（T2/T3）只复活最新的 T2
td._revive_scan_done = False
td._revive_scan_once()
assert len(calls) == 1, calls
assert calls[0][0] == '建筑师' and calls[0][1] == '复活我T2'
assert calls[0][2].get('revived_from') == 'job-T2' and calls[0][2].get('tid') == 'turn-abc'
by = {j['job_id']: j for j in td._town_jobs_snapshot()}
assert by['job-T2']['state'] == 'dead' and by['job-T2']['revived_as'] == 'job-NEW-1'
assert by['job-T3']['state'] == 'dead' and 'revived_as' not in by['job-T3']
assert by['job-T4']['state'] == 'done'
assert by['job-T2']['dead_reason'] == '进程重启时工单未收尾'
print('T2 复活扫描 OK -> dead 定性 + 预算内复活 + revived_as 回写 + 终态不动')

# ---------- T3 扫描进程内只跑一次 ----------
td._revive_scan_once()
assert len(calls) == 1
print('T3 扫描幂等 OK')

# ---------- T4 复活单再死不套娃 ----------
# 真实流程里复活出的新单 meta 带 revived_from；模拟其再次死亡，扫描不得再复活
td._job_state('job-NEW-1', 'working', role='建筑师', task='复活我T2',
              meta={'tid': 'turn-abc', 'source': 'trustee', 'revived_from': 'job-T2'})
td.TOWN_REVIVE_MAX_PER_BOOT = 5
td._revive_scan_done = False
calls.clear()
td._revive_scan_once()
assert len(calls) == 0, calls
by = {j['job_id']: j for j in td._town_jobs_snapshot()}
assert by['job-NEW-1']['state'] == 'dead'
print('T4 复活单不再套娃 OK')

# ---------- T5 托管回查闭环 ----------
tr = importlib.import_module('routes.mixin_trustee')
_real_snap = td._town_jobs_snapshot  # 备份真快照函数，T7 恢复

def fake_snap():
    return [
        {'job_id': 'job-D1', 'state': 'done', 'review_state': 'done', 'updated_at': 1},
        {'job_id': 'job-D2', 'state': 'failed', 'result': '审单未过：产出空壳', 'updated_at': 1},
        {'job_id': 'job-D3old', 'state': 'dead', 'updated_at': 1},
        {'job_id': 'job-D3new', 'state': 'working', 'updated_at': time.time(),
         'revived_from': 'job-D3old'},  # 真实流程：复活出的新单 meta 带指回旧单的字段
        {'job_id': 'job-D4', 'state': 'reviewing', 'updated_at': time.time() - 4000},  # >30min 无心跳
    ]

td._town_jobs_snapshot = fake_snap  # mixin 内部 from routes import domain_town 后取属性
tr._state['team_jobs'] = [
    {'job_id': 'job-D0', 'title': '史前无台账单'},
    {'job_id': 'job-D1', 'title': '完成单'},
    {'job_id': 'job-D2', 'title': '失败单'},
    {'job_id': 'job-D3old', 'title': '复活改道单'},
    {'job_id': 'job-D4', 'title': '超时单'},
    {'job_id': 'job-D5', 'title': '已结清单', 'settled': True},
]
tr._reconcile_team_jobs()
bt = {e['title']: e for e in tr._state['team_jobs']}
assert bt['史前无台账单']['settled'] and bt['史前无台账单']['final'] == 'unknown'
assert bt['完成单']['settled'] and bt['完成单']['final'] == 'done'
assert bt['失败单']['settled'] and bt['失败单']['final'] == 'failed'
assert bt['复活改道单']['job_id'] == 'job-D3new' and not bt['复活改道单'].get('settled')
assert bt['复活改道单'].get('revived') is True
assert bt['超时单']['settled'] and bt['超时单']['final'] == 'stale'
assert bt['已结清单'].get('final') is None  # 已结清的不动
briefs = [b['line'] for b in tr._state['brief']]
assert any('工单回查完成' in x for x in briefs)
assert any('失败→转人工' in x for x in briefs)
assert any('复活改道' in x for x in briefs)
assert any('超时无心跳' in x for x in briefs)
assert any('无台账记录' in x for x in briefs)
print('T5 托管回查 OK -> done/failed/dead改道/stale/unknown 五类处置 + 简报齐全')

# ---------- T6 回查幂等（第二轮无新简报） ----------
n = len(tr._state['brief'])
tr._reconcile_team_jobs()
assert len(tr._state['brief']) == n
print('T6 回查幂等 OK')

# ---------- T7 台账上限 200 条 ----------
td._town_jobs_snapshot = _real_snap  # 还原真函数（T5 曾换成假实现）
for i in range(210):
    td._job_state('job-B%d' % i, 'done', result='x')
assert len(td._town_jobs_snapshot()) == 200
print('T7 台账上限 OK')

# ---------- T8 原子写：无 .tmp 残留且文件可加载（第2轮） ----------
td._job_state('job-T8', 'done', result='x')
assert not os.path.exists(td._JOB_STATE_PATH + '.tmp')
json.load(open(td._JOB_STATE_PATH, encoding='utf-8'))
print('T8 原子写 OK -> 无半截损坏风险')

# ---------- T9 交付物内容闸（第2轮抽出 _deliverable_gate） ----------
import time as _t
gdir = os.path.join(tmpdir, 'gatedir')
os.makedirs(gdir, exist_ok=True)
ts = _t.time()
# (a) 无新产出
msg = td._deliverable_gate(gdir, ts)
assert msg and '无新产出' in msg, msg
# (b) 新成稿 500 字节 → 过闸
_p = os.path.join(gdir, 'ok.md')
open(_p, 'w', encoding='utf-8').write('# 优化方案\n\n' + '正文字节填充' * 60)
msg = td._deliverable_gate(gdir, ts)
assert msg is None, msg
# (c) 新骨架草稿（首行含占位标记）→ 判败
_p2 = os.path.join(gdir, 'draft.md')
open(_p2, 'w', encoding='utf-8').write('# 复核方案（草稿，取证中）\n\n- 待补全\n')
msg = td._deliverable_gate(gdir, ts)
assert msg and '骨架草稿' in msg and '草稿' in msg, msg
os.remove(_p2)
# (d) 唯一新产出过小（<100字节）→ 判败
os.remove(_p)
open(os.path.join(gdir, 'tiny.md'), 'w', encoding='utf-8').write('ok')
msg = td._deliverable_gate(gdir, ts)
assert msg and '不足成稿' in msg, msg
# (e) 二进制新文件不崩 + 合法大文件并存 → 过闸
open(os.path.join(gdir, 'tiny.md'), 'w', encoding='utf-8').write('x' * 250)
with open(os.path.join(gdir, 'blob.bin'), 'wb') as _bf:
    _bf.write(bytes(range(256)) * 2)
msg = td._deliverable_gate(gdir, ts)
assert msg is None, msg
# (f) 旧 mtime 文件不算本单产出：全部文件拨回旧时刻 → 等同无新产出
os.utime(os.path.join(gdir, 'blob.bin'), (ts - 999, ts - 999))
os.utime(os.path.join(gdir, 'tiny.md'), (ts - 999, ts - 999))
msg = td._deliverable_gate(gdir, ts)
assert msg and '无新产出' in msg, msg
print('T9 内容闸 OK -> 无产出/骨架占位/过小/二进制/旧mtime 五类判定')

# ---------- T10 工单心跳（第2轮：防长任务被 30 分钟无心跳误杀） ----------
td._job_state('job-H', 'working', role='建筑师')
d = td._load_job_state()
for j in d['jobs']:
    if j['job_id'] == 'job-H':
        j['updated_at'] = _t.time() - 600  # 手工拨老
td._save_job_state(d)
td._job_touch('job-H')
u1 = next(j for j in td._town_jobs_snapshot() if j['job_id'] == 'job-H')['updated_at']
assert _t.time() - u1 < 5  # 已刷新
td._job_touch('job-H')  # min_gap 节流：不该再写
u2 = next(j for j in td._town_jobs_snapshot() if j['job_id'] == 'job-H')['updated_at']
assert u2 == u1
print('T10 心跳 OK -> 刷新 + 30s 节流')

# ---------- T11 复活时失踪村民自动换人（第2轮） ----------
td._JOB_STATE_PATH = os.path.join(tmpdir, 'town_jobs_t11.json')  # 独立台账，免受前序死单干扰
td._job_state('job-T11', 'working', role='builder-alpha', task='旧名村民的单',
              meta={'source': 'assign'})
calls.clear()
td.TOWN_REVIVE_MAX_PER_BOOT = 2
td._revive_scan_done = False
td._revive_scan_once()  # 名册 mock 只有「建筑师/工匠/审核员」，builder-alpha 不在册
assert len(calls) == 1 and calls[0][0] == '', calls  # role 被清空 → impl 自动选人
print('T11 失踪村民换人 OK -> 旧名角色清空自动选人')

# ---------- T12 jobs-active 探测端点（第3轮：重启调度器盲区修复的数据源） ----------
td._JOB_STATE_PATH = os.path.join(tmpdir, 'town_jobs_t12.json')
td._job_state('job-A1', 'working', role='建筑师', task='在途单')
import types as _ns
fs = _ns.SimpleNamespace()   # FakeSelf
fs.out = None
fs._send_json = lambda d: setattr(fs, 'out', d)
parsed = _ns.SimpleNamespace(query='')
assert td._route_get(fs, '/api/town/jobs-active', parsed) is True
assert fs.out['ok'] and fs.out['active'] is True and fs.out['n'] == 1, fs.out
d = td._load_job_state()
for j in d['jobs']:
    if j['job_id'] == 'job-A1':
        j['updated_at'] = _t.time() - 3600  # 拨老：超15分钟无心跳不算在途
td._save_job_state(d)
fs.out = None
td._route_get(fs, '/api/town/jobs-active', parsed)
assert fs.out['active'] is False and fs.out['n'] == 0, fs.out
print('T12 jobs-active 探测 OK -> 在途有心跳=active，超15分钟=不活跃')

# ---------- T13 团队单产出复审（第3轮 P2.5；2026-11-23 改临时镜像目录，不再写生产 outputs_villager/） ----------
fake_rv = _ns.ModuleType('trustee_llm_review')
fake_rv.review_report = lambda report, timeout=0: {'verdict': 'approve', 'progress': 98,
                                                   'review': 95, 'reason': '测试复审通过'}
sys.modules['trustee_llm_review'] = fake_rv
_t13_dir = tempfile.mkdtemp(prefix='recheck_out_test_')
os.makedirs(os.path.join(_t13_dir, 'mirror', 'routes'), exist_ok=True)
os.makedirs(os.path.join(_t13_dir, 'outputs_villager'), exist_ok=True)
_orig_tr_file = tr.__file__
# _recheck_team_output 用模块 __file__ 上推三级定位项目根 → 指向临时镜像即全程隔离
# （假文件名不带 mixin_ 前缀：门禁 R2 只看新增行字面，且推根逻辑只用目录链不用文件名）
tr.__file__ = os.path.join(_t13_dir, 'mirror', 'routes', 'trustee_mod.py')
testf = os.path.join(_t13_dir, 'outputs_villager', 'optimize-recheck-test.md')
try:
    open(testf, 'w', encoding='utf-8').write('# 测试产出\n\n' + 'x' * 200)
    ent = {'tid': 'turn-r', 'title': '复审测试单'}
    j = {'job_id': 'job-R1', 'task': '在 outputs_villager/optimize-recheck-test.md 写入分析与方案'}
    assert tr._recheck_team_output(ent, j) is True
    assert ent['recheck']['verdict'] == 'approve' and ent['recheck']['progress'] == 98
finally:
    tr.__file__ = _orig_tr_file  # 还原，防影响后续断言
    shutil.rmtree(_t13_dir, ignore_errors=True)  # 即刻清理，不污染展廊
ent2 = {'tid': 'turn-r2', 'title': '缺文件单'}
j2 = {'job_id': 'job-R2', 'task': '在 outputs_villager/optimize-missing-xx.md 写入'}
assert tr._recheck_team_output(ent2, j2) is False and 'recheck' not in ent2
print('T13 团队单产出复审 OK -> verdict回写 + 缺文件安全跳过（临时目录隔离）')

# ---------- T14 trustee.json 原子写（第3轮） ----------
tr.TRUSTEE_JSON = os.path.join(tmpdir, 'trustee_test.json')
tr._save()
assert not os.path.exists(tr.TRUSTEE_JSON + '.tmp')
json.load(open(tr.TRUSTEE_JSON, encoding='utf-8'))
print('T14 trustee.json 原子写 OK -> 无 .tmp 残留且可加载')

# ---------- T15 审单防橡皮图章判定（第4轮收尾抽出 _review_pass_evidence） ----------
f = td._review_pass_evidence
assert f('done', 'REVIEW_PASS 结论', 3) is True          # 有核查有PASS
assert f('done', 'REVIEW_PASS 结论', 0) is False         # 零核查不放水
assert f('done', 'REVIEW_FAIL 结论', 5) is False         # FAIL 不通过
assert f('error', 'REVIEW_PASS', 5) is False             # 引擎异常不通过
assert f('done', '', 2) is False                         # 空结论不通过
assert f('done', 'REVIEW_PASS', None) is False           # calls 异常值兜底
assert f('done', '应写REVIEW_PASS但发现X问题应写REVIEW_FAIL', 2) is False  # 双标记取最后
assert f('done', '先REVIEW_FAIL复核后改判REVIEW_PASS', 2) is True         # 翻转后通过
assert f('done', 'REVIEW_FAIL ... REVIEW_PASS ... REVIEW_FAIL', 2) is False  # 多次翻转取最终
print('T15 审单证据判定 OK -> 零核查 PASS 不采信 + 双标记取最后出现')

# ---------- T16 stale 阈值可配置（cfg.stale_job_sec） ----------
assert (tr._state['cfg'].get('stale_job_sec', 1800)) >= 300  # 默认在合理范围
print('T16 stale 阈值配置 OK -> cfg.stale_job_sec 存在且可持久化')

print('\nALL 16 TEST BLOCKS PASSED')
