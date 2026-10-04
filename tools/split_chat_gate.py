# -*- coding: utf-8 -*-
"""一次性拆分脚本：把 chat_gate.py 按行段无改动切成 5 个分段模块。"""
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server')
SRC = os.path.join(ROOT, 'chat_gate.py')

lines = open(SRC, encoding='utf-8').read().splitlines(keepends=True)
n = len(lines)
print('total lines:', n)

# 分段边界（1 基行号，含头不含尾）：
# 1-127    状态/常量/网络退避
# 128-292  配置读写 + 车道管理
# 293-524  acquire/force_recover/release/GateRejected
# 525-1053 worker 循环 + AIMD + 记录 + 快照
# 1054-end 管理 set_* API + probe
SEGS = {
    '_gate_state':   (1, 128),
    '_gate_cfg_io':  (128, 293),
    '_gate_acquire': (293, 525),
    '_gate_worker':  (525, 1054),
    '_gate_admin':   (1054, n + 1),
}
HDR = ('# -*- coding: utf-8 -*-\n'
       '# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，\n'
       '# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。\n')

for name, (a, b) in SEGS.items():
    body = ''.join(lines[a - 1:b - 1])
    with open(os.path.join(ROOT, name + '.py'), 'w', encoding='utf-8') as f:
        f.write(HDR + body)
    print(name, ':', b - a, 'lines written')
print('done')
