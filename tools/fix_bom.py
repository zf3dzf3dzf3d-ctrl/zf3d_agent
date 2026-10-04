# -*- coding: utf-8 -*-
"""规范化全部分段文件为无 BOM UTF-8（去 U+FEFF）。"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [os.path.join(ROOT, 'server', f) for f in
         ('_gate_state.py', '_gate_cfg_io.py', '_gate_acquire.py',
          '_gate_worker.py', '_gate_admin.py')] + \
        [os.path.join(ROOT, 'server', 'routes', f) for f in
         ('_post_handlers.py', '_post_core_a.py', '_post_core_b.py')]

for p in FILES:
    raw = open(p, 'rb').read()
    if raw.startswith(b'\xef\xbb\xbf'):
        open(p, 'wb').write(raw[3:])
        print('deBOM', os.path.basename(p))
    else:
        print('clean', os.path.basename(p))
print('done')
