# -*- coding: utf-8 -*-
"""蜂群解题主控：一次派 4 只蜜蜂并发解题，回收代码并本地执行验证。"""
import os, re, sys, time, json, subprocess

BASE = os.path.dirname(os.path.abspath(__file__))
if BASE not in sys.path:
    sys.path.insert(0, BASE)
import dispatch_swarm as swarm

ROOT = r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\评测\AI横屏题目8_朱峰智能体改进01'
Q = os.path.join(ROOT, '1问题')
OUT = os.path.join(ROOT, '考卷结果')
os.makedirs(OUT, exist_ok=True)
PY = r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\python\python.exe'

def rd(p, limit=None):
    with open(p, encoding='utf-8', errors='ignore') as f:
        s = f.read()
    return s[:limit] if limit else s

# ---------- 准备各蜜蜂的题目材料 ----------
qa = rd(os.path.join(Q, '赛题A_纯数学', '题目.txt'))
qb = rd(os.path.join(Q, '赛题B_纯数学', '题目.txt'))
qc_data_head = rd(os.path.join(Q, '赛题C_文件处理', 'data', 'orders_dirty.txt'), 3000)
qc = rd(os.path.join(Q, '赛题C_文件处理', '题目和提问方法.md'))
qd = rd(os.path.join(Q, '赛题D_调试修复', '题目和提问方法.md'))
qd_code = rd(os.path.join(Q, '赛题D_调试修复', 'sales_report.py'))

COMMON = ('你可以输出 Python 代码块（```python ... ```），主控会提取并实际运行验证。'
          '代码必须自包含、可直接运行、打印最终答案，不要依赖本对话之外的任何状态。')

tasks = [
    {'goal': '解下面这道数学题。先给出严谨算法思路，再给出完整 Python 代码求出精确答案。\n' + qa + '\n' + COMMON,
     'context': ''},
    {'goal': '解下面这道概率期望题。先给出严谨算法思路（注意精度，答案保留 8 位小数），再给出完整 Python 代码。\n' + qb + '\n' + COMMON,
     'context': ''},
    {'goal': ('按题目要求清洗数据并统计。数据文件完整路径: %s\n'
              '输出清洗+统计的完整 Python 代码（用该绝对路径读文件，结果 CSV 写到 %s），'
              '并打印：有效订单总数、总销售额(2位小数)、城市销售额TOP3。\n\n%s\n\n数据文件前3000字符预览：\n%s')
             % (os.path.join(Q, '赛题C_文件处理', 'data', 'orders_dirty.txt'),
                os.path.join(OUT, 'clean_orders.csv'), qc, qc_data_head)},
    {'goal': ('找出下面脚本的 3 处 Bug，逐条说明位置和原因，然后输出修复后的完整代码。\n\n题目说明：\n%s\n\n代码全文：\n%s')
             % (qd, qd_code)},
]

t0 = time.time()
bid = swarm.submit(tasks, shared_context=COMMON)
print('batch:', bid, flush=True)
res = swarm.collect(bid, wait_sec=600)
print('collect done in %.1fs' % (time.time() - t0), flush=True)

# ---------- 落盘 + 提取代码执行 ----------
def extract_code(text):
    blocks = re.findall(r'```python\n(.*?)```', text, re.S)
    if not blocks:
        blocks = re.findall(r'```\n(.*?)```', text, re.S)
    return max(blocks, key=len) if blocks else ''

names = ['A_solve', 'B_solve', 'C_solve', 'D_solve']
summary = []
for i, t in enumerate(res['tasks']):
    name = names[i]
    md = os.path.join(OUT, name + '.md')
    with open(md, 'w', encoding='utf-8') as f:
        f.write('# 赛题%s 蜂群结果\n\n状态: %s 耗时: %ss 模型: %s\n\n%s'
                % (name[0], t['status'], t.get('elapsed'), t.get('model'), t['output']))
    entry = {'task': name, 'status': t['status'], 'elapsed': t.get('elapsed')}
    if t['status'] == 'failed':
        entry['error'] = t.get('output', '')[:800]
        print(name, 'ERROR:', t.get('output', '')[:800], flush=True)
    if t['status'] == 'done':
        code = extract_code(t['output'])
        if code:
            py = os.path.join(OUT, name + '.py')
            with open(py, 'w', encoding='utf-8') as f:
                f.write(code)
            if name in ('C_solve', 'D_solve'):
                cwd = os.path.join(Q, '赛题' + name[0] + '_' + ('文件处理' if name[0] == 'C' else '调试修复'))
            else:
                cwd = OUT
            r = subprocess.run([PY, py], capture_output=True, text=True,
                               encoding='utf-8', errors='ignore', timeout=600, cwd=cwd)
            entry['run_exit'] = r.returncode
            entry['stdout'] = (r.stdout or '')[-1500:]
            if r.returncode != 0:
                entry['stderr'] = (r.stderr or '')[-800:]
    summary.append(entry)
    print(json.dumps({k: v for k, v in entry.items() if k != 'stdout'}, ensure_ascii=False), flush=True)
    if entry.get('stdout'):
        print('--- stdout ---\n' + entry['stdout'], flush=True)

with open(os.path.join(OUT, 'summary.json'), 'w', encoding='utf-8') as f:
    json.dump({'batch': bid, 'total_sec': round(time.time() - t0, 1), 'results': summary},
              f, ensure_ascii=False, indent=2)
print('TOTAL %.1fs' % (time.time() - t0))
