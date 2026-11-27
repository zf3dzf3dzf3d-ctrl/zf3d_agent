# -*- coding: utf-8 -*-
"""提交门禁硬拦截 + 带到期时间的豁免 + 保护性快照放行（2026-11-24）。

背景：提交钩子第三棒此前对反模式上涨只软警告，拦不住回潮——2026-11-23 全天九项指标持平，
当夜至次日清晨蜂群新增代码带入 +8 宽泛捕获 / +2 静默吞异常 / +5 print 而无人察觉。
现改为：正式提交上涨即拒绝；保护性快照放行并留痕；豁免须带 ceiling 与 until，到期自动失效。

钉死的契约：
  A 豁免判定 load_waivers：生效 / 过期 / 非法 / 同指标取最宽松 / today 可注入
  B 对比表 report：干净放行、上涨拦截、豁免期内放行、上限不够拦截、过期拦截
  C 钩子 main：正式提交拒绝、保护性快照放行并留痕、--soft 放行并留痕、豁免放行留痕
  D 快照识别 is_snapshot_commit：读 git 一次性配置项 zf.snapshot（不起子进程提交）
  E 保护性提交路径都带 zf.snapshot=1 标记，正式提交路径不带

全程不执行 git commit；留痕写临时文件。
用法：py tests/test_gate_waivers.py   （退出码 0 = 全过）
"""
import importlib.util
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, str(ROOT / rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tmp = Path(tempfile.mkdtemp(prefix='zf_gate_test_'))     # 系统临时目录：不含计数器会跳过的目录名
TODAY = '2026-11-24'


def fresh_counter():
    zc = load('zc_%d' % len(_fail) + str(id(tmp)), 'tools/quality/count_antipatterns.py')
    zc.WAIVERS = tmp / ('waivers_%d.json' % id(zc))
    zc.BASELINE = tmp / ('baseline_%d.json' % id(zc))
    return zc


def write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding='utf-8')


# ===== A 豁免判定 =====
zc = fresh_counter()
write_json(zc.WAIVERS, {'waivers': [
    {'metric': 'except_exception', 'ceiling': 3930, 'until': '2026-11-30', 'reason': '在期内', 'by': 't'},
    {'metric': 'print_stmt', 'ceiling': 200, 'until': '2026-01-01', 'reason': '已过期', 'by': 't'},
    {'metric': 'except_pass', 'ceiling': 1300, 'until': '不是日期', 'reason': '日期非法', 'by': 't'},
    {'metric': '不存在的指标', 'ceiling': 1, 'until': '2026-12-31', 'reason': '指标非法', 'by': 't'},
    {'metric': 'exec_call', 'ceiling': 5, 'until': '2026-12-31', 'reason': '', 'by': 't'},
    {'metric': 'html_mojibake', 'ceiling': True, 'until': '2026-12-31', 'reason': 'ceiling 是布尔', 'by': 't'},
    {'metric': 'except_exception', 'ceiling': 3925, 'until': '2026-12-05', 'reason': '更紧但更久', 'by': 't'},
    '不是对象的条目',
]})
active, expired, invalid = zc.load_waivers(TODAY)
check('A1 生效中的豁免只含合法条目', set(active) == {'except_exception'}, repr(sorted(active)))
check('A2 已过期的豁免被单列、不生效', expired == [('print_stmt', '2026-01-01')], repr(expired))
check('A3 非法条目全部被拒：日期格式 / 指标名 / 缺理由 / 布尔上限 / 非对象',
      len(invalid) == 5, repr([w for _, w in invalid]))
check('A4 同指标多条生效时取最宽松（上限最大）', active.get('except_exception', {}).get('ceiling') == 3930,
      repr(active.get('except_exception')))
check('A5 没有豁免文件时返回三个空结果', fresh_counter().load_waivers(TODAY) == ({}, [], []))
zc.WAIVERS.write_text('{坏的 json', encoding='utf-8')
check('A6 豁免文件损坏时按“无豁免”处理（不抛错、不放行）', zc.load_waivers(TODAY) == ({}, [], []))

# ===== B 对比表 =====
def run_report(zc, now, label):
    out = io.StringIO()
    with redirect_stdout(out):
        rc, info = zc.report(now)
    return rc, info, out.getvalue()


zc = fresh_counter()
M = zc.METRIC_ORDER
clean = {m: 10 for m in M}
clean.update({'_files_scanned': 1})
write_json(zc.BASELINE, clean)
rc, info, text = run_report(zc, dict(clean), 'B1')
check('B1 无上涨 → 退出码 0', rc == 0 and info['blocked'] == [] and info['waived'] == {}, (rc, info))

now = dict(clean); now['except_exception'] = 12
rc, info, _ = run_report(zc, now, 'B2')
check('B2 有上涨且无豁免 → 退出码 1，列出被拦指标', rc == 1 and info['blocked'] == ['except_exception']
      and info['exceeded'] == {'except_exception': (10, 12)}, (rc, info))

write_json(zc.WAIVERS, {'waivers': [{'metric': 'except_exception', 'ceiling': 12, 'until': '2026-12-01', 'reason': '期内', 'by': 't'}]})
rc, info, text = run_report(zc, now, 'B3')
check('B3 上涨恰在豁免上限内 → 放行，并标明豁免', rc == 0 and 'except_exception' in info['waived'] and 'WAIVED' in text, (rc, info))

now2 = dict(now); now2['except_exception'] = 13
rc, info, _ = run_report(zc, now2, 'B4')
check('B4 超出豁免上限 → 拦截（新增量不在豁免内）', rc == 1 and info['blocked'] == ['except_exception'], (rc, info))

write_json(zc.WAIVERS, {'waivers': [{'metric': 'except_exception', 'ceiling': 99, 'until': '2026-01-01', 'reason': '早就过期', 'by': 't'}]})
rc, info, text = run_report(zc, now, 'B5')
check('B5 豁免已过期 → 拦截，并提示已失效', rc == 1 and info['expired'] == [('except_exception', '2026-01-01')]
      and '已到期失效' in text, (rc, info.get('expired')))

now3 = dict(now); now3['print_stmt'] = 11; now3['html_mojibake'] = 11
rc, info, _ = run_report(zc, now3, 'B6')
check('B6 多项同时上涨 → 全部列出', rc == 1 and set(info['blocked']) == {'except_exception', 'print_stmt', 'html_mojibake'},
      repr(info['blocked']))

zc.BASELINE = tmp / 'does_not_exist.json'
rc, info, _ = run_report(zc, now, 'B7')
check('B7 缺基线文件 → 退出码 2（不静默放行）', rc == 2, rc)

# ===== C / D 提交钩子 =====
gate = load('zf_pc_gate_test', 'tools/hooks/pre_commit_gate.py')
gate.EXEMPTION_LOG = tmp / 'gate_exemptions.jsonl'
gate.check_staging = lambda: 0                       # 暂存区卫生不在本文件范围
CALLS = {'n': 0}


def run_gate(counter_result, snapshot, argv=()):
    CALLS['n'] += 1
    gate.check_counter = lambda: counter_result
    gate.is_snapshot_commit = lambda: snapshot
    saved = sys.argv
    sys.argv = ['pre_commit_gate.py'] + list(argv)
    out = io.StringIO()
    try:
        with redirect_stdout(out):
            rc = gate.main()
    finally:
        sys.argv = saved
    return rc, out.getvalue()


EXCEEDED = {'exceeded': {'except_exception': (3914, 3922)}, 'waived': {}, 'blocked': ['except_exception'], 'expired': []}
WAIVED = {'exceeded': {}, 'waived': {'except_exception': {'ceiling': 3922, 'until': '2026-12-01'}}, 'blocked': [], 'expired': []}
CLEAN = {'exceeded': {}, 'waived': {}, 'blocked': [], 'expired': []}


def log_records():
    if not gate.EXEMPTION_LOG.exists():
        return []
    return [json.loads(x) for x in gate.EXEMPTION_LOG.read_text(encoding='utf-8').splitlines() if x.strip()]


rc, text = run_gate((1, EXCEEDED), snapshot=False)
check('C1 正式提交 · 有上涨 → 拒绝（退出码 1）', rc == 1 and '提交被拒绝' in text, rc)
rc, text = run_gate((1, EXCEEDED), snapshot=True)
recs = log_records()
check('C2 保护性快照 · 有上涨 → 放行并留痕 kind=snapshot', rc == 0 and recs and recs[-1]['kind'] == 'snapshot'
      and recs[-1]['exceeded'] == {'except_exception': [3914, 3922]}, (rc, recs[-1:] ))
rc, text = run_gate((1, EXCEEDED), snapshot=False, argv=['--soft'])
recs = log_records()
check('C3 --soft 应急 → 放行并留痕 kind=soft', rc == 0 and recs[-1]['kind'] == 'soft', (rc, recs[-1:]))
rc, text = run_gate((0, WAIVED), snapshot=False)
recs = log_records()
check('C4 上涨在豁免期内 → 放行并留痕 kind=waiver', rc == 0 and recs[-1]['kind'] == 'waiver'
      and recs[-1]['waived'] == {'except_exception': {'ceiling': 3922, 'until': '2026-12-01'}}, (rc, recs[-1:]))
rc, text = run_gate((0, CLEAN), snapshot=False)
n = len(log_records())
check('C5 干净的正式提交 → 放行且不留痕', rc == 0 and len(log_records()) == n, rc)
rc, text = run_gate((2, dict(CLEAN)), snapshot=False)
check('C6 计数器自身出错（缺基线）→ 不放行', rc == 2, rc)
gate.check_staging = lambda: 1
rc, _ = run_gate((0, CLEAN), snapshot=True)
check('C7 豁免不是“免检”：暂存区卫生失败时，连保护性快照也一律拒绝', rc == 1, rc)
gate.check_staging = lambda: 0

# D 快照识别：用 git 的环境变量配置通道模拟 `git -c zf.snapshot=1`，不执行任何提交
gate2 = load('zf_pc_gate_test2', 'tools/hooks/pre_commit_gate.py')
for k in ('GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'):
    os.environ.pop(k, None)
check('D1 普通提交 → is_snapshot_commit 为 False', gate2.is_snapshot_commit() is False)
os.environ['GIT_CONFIG_COUNT'] = '1'
os.environ['GIT_CONFIG_KEY_0'] = 'zf.snapshot'
os.environ['GIT_CONFIG_VALUE_0'] = '1'
try:
    check('D2 git -c zf.snapshot=1 → is_snapshot_commit 为 True', gate2.is_snapshot_commit() is True)
    os.environ['GIT_CONFIG_VALUE_0'] = 'yes'
    check('D3 值不是精确的 "1" → 不认', gate2.is_snapshot_commit() is False)
finally:
    for k in ('GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'):
        os.environ.pop(k, None)

# ===== E 保护性提交路径的标记 =====
def src(rel):
    return (ROOT / rel).read_text(encoding='utf-8', errors='replace')


sc = src('tools/coding/backend/self_check.py')
check('E1 快照守护的 3 处提交都带 zf.snapshot=1', sc.count("'-c', 'zf.snapshot=1', 'commit'") == 3, sc.count("zf.snapshot=1"))
check('E2 快照守护没有不带标记的 commit 调用', "['commit'," not in sc)
check('E3 切换分支前的保护性收起带标记', "zf.snapshot=1', 'commit', '-m', 'WIP-noise" in src('server/git_branch_api.py'))
check('E4 流水线工作区的保护性提交带标记', "'zf.snapshot=1', 'commit', '-m', '[wt] pipeline worker changes'" in src('server/swarm_pipeline.py'))
check('E5 正式提交路径（看板提交 / 提交接口）不带标记',
      "zf.snapshot" not in src('server/engines/common/crew_board.py')
      and "_git(['commit', '-m', msg, '--'] + files" in src('server/git_branch_api.py'))

# ===== F 线上的豁免文件本身合法 =====
zc = load('zc_real', 'tools/quality/count_antipatterns.py')
active, expired, invalid = zc.load_waivers(TODAY)
real = json.loads((ROOT / 'tools/quality/waivers.json').read_text(encoding='utf-8'))
check('F1 线上 waivers.json 每条都合法、在期内、带理由与批准人（按登记日 2026-11-24 判定）',
      len(active) == len(real['waivers']) and not invalid and not expired
      and all(w.get('reason') and w.get('by') for w in real['waivers']), (sorted(active), invalid, expired))
base = json.loads((ROOT / 'tools/quality/baseline.json').read_text(encoding='utf-8'))
check('F2 每条豁免的上限都不低于基线（低于基线的豁免毫无意义，说明是写错的）',
      all(isinstance(w.get('ceiling'), int) and w['ceiling'] >= base.get(w['metric'], 0) for w in real['waivers']),
      [(w['metric'], w.get('ceiling'), base.get(w['metric'])) for w in real['waivers']])

import shutil
shutil.rmtree(tmp, ignore_errors=True)

print('== 提交门禁硬拦截与豁免回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
