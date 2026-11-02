# -*- coding: utf-8 -*-
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
d = json.load(open('_sec_scan.json', encoding='utf-8'))
for k in ('shell_true', 'hardcoded_key', 'eval', 'child_process', 'send_file', 'secret_assign'):
    v = d['lines'].get(k, [])
    print('=====', k, len(v))
    for x in v[:10]:
        print('  ', x)
