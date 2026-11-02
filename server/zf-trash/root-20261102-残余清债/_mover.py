# -*- coding: utf-8 -*-
"""区域1残余清债：server 根漏网 tmp/debug/bak 移入 zf-trash 可恢复目录。一次性脚本。"""
import os, shutil
root = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server"
dst = os.path.join(root, "zf-trash", "root-20261102-残余清债")
names = """README.md.bak.20261022_191947_470525 tmp_a2_log.txt tmp_audit_chk.py tmp_clipobj.json
tmp_h3B_log.txt tmp_h3obj.json tmp_h3probe.py tmp_h3probe2.py tmp_h3_run.py tmp_h3_wait.py
tmp_inject_audit_prompt.py tmp_q.json tmp_scan_panel.py tmp_timing.py debug_fix_indent.py
debug_verify_indent.py diag_body_400.log diag_zf3d_login_empty.log succ_probe8560.out
succ_probe8570.py _d_probe.py _probe_tmp.py zf_auth_diag.txt debug_pid.txt zzscan.py""".split()
os.makedirs(dst, exist_ok=True)
moved, missed = [], []
for n in names:
    src = os.path.join(root, n)
    if os.path.exists(src):
        shutil.move(src, os.path.join(dst, n)); moved.append(n)
    else:
        missed.append(n)
d = os.path.join(root, "tmp3o1ftqj4")
if os.path.isdir(d):
    shutil.move(d, os.path.join(dst, "tmp3o1ftqj4")); moved.append("tmp3o1ftqj4/")
print("moved", len(moved))
print("missed:", missed if missed else "none")
# 复查根目录残留
import re
left = [f for f in os.listdir(root) if re.match(r"^(tmp|debug|diag|.*probe|zf_auth_diag)", f, re.I) and not f.endswith(".db")]
print("remaining tmp/debug-like in root:", left if left else 0)
bak = [f for f in os.listdir(root) if re.match(r".*\.bak\.\d{8}_", f)]
print("remaining manual bak:", bak if bak else 0)
