# -*- coding: utf-8 -*-
# 临时验证脚本：模拟 mixin_static.py 修复后的穿越拦截逻辑
from urllib.parse import unquote
import os

PUBLIC_DIR = os.path.abspath('public')

def check(raw_path):
    path = unquote(raw_path)
    # 第一道：unquote 后二次 '..' 检查（本次修复新增）
    if '..' in path or '\\..' in path:
        return 'BLOCKED(403)'
    # 终检：realpath 前缀校验（本次修复新增）
    file_path = os.path.normpath(os.path.join(PUBLIC_DIR, path.lstrip('/')))
    fp_real = os.path.realpath(file_path)
    pd_real = os.path.realpath(PUBLIC_DIR)
    if not (fp_real == pd_real or fp_real.startswith(pd_real + os.sep)):
        return 'BLOCKED(403)'
    return 'PASS'

cases = [
    ('/%2e%2e%2fprivate%2femail_config.json', 'BLOCKED'),
    ('/%2e%2e/private/port.json', 'BLOCKED'),
    ('/%2e%2e%5c..%5cprivate%5csecret.txt', 'BLOCKED'),
    ('/js/app.js', 'PASS'),
    ('/index.html', 'PASS'),
    ('/css/style.css', 'PASS'),
]
ok = True
for raw, expect in cases:
    got = check(raw)
    status = 'OK' if got.startswith(expect) else 'FAIL'
    if status == 'FAIL': ok = False
    print('%-45s expect=%-8s got=%-14s %s' % (raw, expect, got, status))
print('ALL-PASS' if ok else 'HAS-FAIL')
