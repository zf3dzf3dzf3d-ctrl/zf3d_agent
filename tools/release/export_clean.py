# -*- coding: utf-8 -*-
"""本地安全收尾：补 .gitignore + 导出无 .git 纯净版 + 验证（不上传任何东西）"""
import os, re, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # server/logs -> server -> 项目根

# ---------- 1) 幂等追加 .gitignore ----------
gi = os.path.join(BASE, '.gitignore')
with open(gi, 'r', encoding='utf-8', errors='ignore') as f:
    cur = f.read()
MARK = '# === 20261125 安全自检(bravo): 隐私与内部文件永不入库 ==='
if MARK not in cur:
    add = ('\n' + MARK + '\n'
           '/plugins/private/\n'
           '/plugins/data/\n'
           '/server/private/\n'
           '/server/*.db\n'
           '/zf-rc-out.txt\n')
    if not cur.endswith('\n'):
        add = '\n' + add
    with open(gi, 'a', encoding='utf-8', newline='\n') as f:
        f.write(add)
    print('GITIGNORE: 已追加 5 条规则')
else:
    print('GITIGNORE: 规则已存在，跳过')

# ---------- 2) 导出无 .git 纯净版 ----------
SRC = BASE
_m = re.search(r'(\d+\.\d+\.\d+)$', os.path.basename(BASE))  # 去硬编码：版本号从项目根目录名尾部提取，换版本无需改脚本
DST = os.path.join(BASE, 'exports', ('clean_%s_local' % (_m.group(1) if _m else os.path.basename(BASE))))
XD = [
    os.path.join(SRC, '.git'), os.path.join(SRC, 'python'), os.path.join(SRC, 'private'),
    os.path.join(SRC, 'node_modules'), os.path.join(SRC, 'data'), os.path.join(SRC, 'exports'),
    os.path.join(SRC, 'server', 'data'), os.path.join(SRC, 'server', 'logs'),
    os.path.join(SRC, 'server', 'cache'), os.path.join(SRC, 'server', 'private'),
    os.path.join(SRC, 'server', '.zf-trash'), os.path.join(SRC, 'server', 'browser_plugin', 'data'),
    os.path.join(SRC, 'plugins', 'private'), os.path.join(SRC, 'plugins', 'data'),
    os.path.join(SRC, 'system', 'trash'), os.path.join(SRC, 'public', 'canvas', '漫画柜'),
    os.path.join(SRC, 'public', 'uploads'), os.path.join(SRC, 'tools', 'LuckyLillia'),
    os.path.join(SRC, 'server', 'zf3d_chat.db'),
    # 20261125 alpha 补强：目录名匹配=排除所有层级的同名目录（审计临时目录/回收站/字节码缓存）
    'tmp_audit', '.zf-trash', '__pycache__', 'browser_profile', '.zf_bak',
    '.githooks', '.github', '.pytest_cache', '.ruff_cache',  # 20261125 bravo: git 痕迹/缓存目录不随包外发
]
# /XD 只排目录；server/.zf-trash 同时以"文件"形态存在(索引清单)，需 /XF 兜底
XF = ['diag_*', 'tmp_*', '.gitignore', '.env', '*.log', '*.bak', '*.bak.*', '*.pyc', '*.db', '*.db-shm', '*.db-wal', '*.crash', '.zf-trash']  # 20261125 bravo: .gitignore 不随包外发
cmd = ['robocopy', SRC, DST, '/E', '/NFL', '/NDL', '/NJH', '/R:1', '/W:1', '/XD'] + XD + ['/XF'] + XF
r = subprocess.run(cmd, capture_output=True)
tail = r.stdout.decode('gbk', 'ignore').strip().splitlines()[-12:]
print('ROBOCOPY rc=%d' % r.returncode)
print('\n'.join(tail))
if r.returncode >= 8:
    print('EXPORT_FAILED')
    sys.exit(1)

# ---------- 3) 验证纯净版 ----------
bad = []
files_n = size = 0
for dp, dn, fn in os.walk(DST):
    for d in list(dn):
        if d in ('.git', 'private', 'trash', 'browser_profile', 'node_modules', '__pycache__', 'data'):
            # data 单独判：只禁顶层与 server/plugins 下运行时 data，不影响同名普通目录之外——保守起见报告即可
            bad.append(os.path.relpath(os.path.join(dp, d), DST))
    for f in fn:
        files_n += 1
        try:
            size += os.path.getsize(os.path.join(dp, f))
        except Exception:
            pass
print('EXPORT_VERIFY files=%d size=%dMB 可疑残留目录=%s' % (files_n, size // 1048576, bad if bad else '无'))
print('DONE_ALL')
