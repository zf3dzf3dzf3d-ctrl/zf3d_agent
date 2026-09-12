# -*- coding: utf-8 -*-
"""T4 最小复现：缩容后 lanes_detail 数量是否正确 + 是否卡死"""
import sys, time, io, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
import chat_gate as g

print('T4 start, lanes=', g._lanes, flush=True)
g.set_lanes(2)
print('after set_lanes(2), lanes=', g._lanes, flush=True)
t0 = time.time()
det = g.status_snapshot()['lanes_detail']
print('shrink detail len =', len(det), 'elapsed=%.1f' % (time.time() - t0), flush=True)
g.set_lanes(4)
det2 = g.status_snapshot()['lanes_detail']
print('grow detail len =', len(det2), flush=True)
print('T4 done OK', flush=True)
