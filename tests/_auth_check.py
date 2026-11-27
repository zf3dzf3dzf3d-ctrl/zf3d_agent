# -*- coding: utf-8 -*-
"""临时验证：kernel 级统一认证（PluginContext.verify_admin_token）两态。跑完可删。"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import kernel  # noqa: E402

ctx = kernel.PluginContext(kernel.Kernel(), {"id": "manager.zf-console", "capabilities": ["plugin.manage"]})
ctx_no_cap = kernel.PluginContext(kernel.Kernel(), {"id": "x.y", "capabilities": []})

class H:
    def __init__(self, tok):
        self.headers = {'X-Plugin-Token': tok}

_old = sys.stdout
sys.stdout = io.StringIO()
try:
    r_no_cap = None
    try:
        ctx_no_cap.verify_admin_token(H('x'))
    except PermissionError:
        r_no_cap = 'PermissionError'
    r1 = ctx.verify_admin_token(H('wrong'))
    r2 = ctx.verify_admin_token(H(kernel.get_admin_token()))
finally:
    sys.stdout = _old

print('AUTH no-cap ->', r_no_cap, '| wrong ->', r1, '| valid ->', r2)
assert r_no_cap == 'PermissionError' and r1 is False and r2 is True, 'AUTH FAIL'
print('AUTH 3/3 PASS')
