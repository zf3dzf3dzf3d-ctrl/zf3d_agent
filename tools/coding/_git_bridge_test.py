#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证沙箱↔git 桥接：写入→undo→redo 均应产生 [sandbox] 开头的 git 提交。"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'server'))
from engines.common import sandbox

f = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_git_bridge_dummy.txt')
with open(f, 'w', encoding='utf-8') as fp:
    fp.write('v1')
op = sandbox.snapshot_before_write(f, tag='gitbridge')
assert op, 'snapshot failed'
with open(f, 'w', encoding='utf-8') as fp:
    fp.write('v2')
ok, msg = sandbox.undo()
assert ok, msg
assert open(f, encoding='utf-8').read() == 'v1', 'undo failed'
ok, msg = sandbox.redo()
assert ok, msg
assert open(f, encoding='utf-8').read() == 'v2', 'redo failed'

commits = sandbox.git_history(5)
for c in commits:
    print(c['commit'], c['msg'])
sando = [c for c in commits if c['msg'].startswith('[sandbox]')]
assert sando, 'no [sandbox] commits found'
print('GIT BRIDGE OK, %d sandbox commits in history' % len(sando))
os.remove(f)
