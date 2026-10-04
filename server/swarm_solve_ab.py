# -*- coding: utf-8 -*-
"""只重跑 A/B 两只蜜蜂。"""
import os, sys, time, json, re, subprocess
BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import dispatch_swarm as swarm

ROOT = r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\评测\AI横屏题目8_朱峰智能体改进01'
Q = os.path.join(ROOT, '1问题')
OUT = os.path.join(ROOT, '考卷结果')
PY = r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\python\python.exe'

qa = open(os.path.join(Q, '赛题A_纯数学', '题目.txt'), encoding='utf-8').read()
qb = open(os.path.join(Q, '赛题B_纯数学', '题目.txt'), encoding='utf-8').read()
COMMON = ('你可以输出 Python 代码块（```python ... ```），主控会提取并实际运行验证。'
          '代码必须自包含、可直接运行、打印最终答案。注意控制运行时间在 2 分钟内。')

tasks = [
    {'goal': '解下面这道数学题。先给出严谨算法思路，再给出完整 Python 代码求出精确答案。\n' + qa + '\n' + COMMON},
    {'goal': '解下面这道概率期望题。先给出严谨算法思路（答案保留 8 位小数），再给出完整 Python 代码。\n' + qb + '\n' + COMMON},
]

t0 = time.time()
bid = swarm.submit(tasks)
res = swarm.collect(bid, wait_sec=1200)

def extract_code(text):
    blocks = re.findall(r'```python\n(.*?)```', text, re.S) or re.findall(r'```\n(.*?)```', text, re.S)
    return max(blocks, key=len) if blocks else ''

for i, t in enumerate(res['tasks']):
    name = ['A_solve', 'B_solve'][i]
    with open(os.path.join(OUT, name + '.md'), 'w', encoding='utf-8') as f:
        f.write('# 赛题%s 蜂群结果\n\n状态: %s 耗时: %ss 模型: %s\n\n%s'
                % (name[0], t['status'], t.get('elapsed'), t.get('model'), t['output']))
    print(name, t['status'], t.get('elapsed'), 'output_len:', len(t['output']), flush=True)
    if t['status'] == 'failed':
        print('ERR:', t['output'][:500], flush=True)
        continue
    code = extract_code(t['output'])
    if code:
        p = os.path.join(OUT, name + '.py')
        open(p, 'w', encoding='utf-8').write(code)
        try:
            r = subprocess.run([PY, p], capture_output=True, text=True,
                               encoding='utf-8', errors='ignore', timeout=900, cwd=OUT)
            print(name, 'run exit', r.returncode, flush=True)
            print((r.stdout or '')[-600:], flush=True)
            if r.returncode != 0:
                print((r.stderr or '')[-400:], flush=True)
        except subprocess.TimeoutExpired:
            print(name, 'RUN TIMEOUT', flush=True)
print('TOTAL %.1fs' % (time.time() - t0))
