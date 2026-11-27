# -*- coding: utf-8 -*-
"""M1.6 自保护 ACL 回归（2026-11-24）。

验收口径（策划案 M1.6）：沙箱内进程对执法文件/policy/.git 的写入全部失败；用户会话可写。
覆盖：
  A ensure 幂等（二次运行 skip）+ 布置状态抽查（执法文件对包 SID 是 RX-only、无 M/F）
  B 真实 AppContainer 子进程 E2E：执法文件/私库/.git 写全拒、工作区可写、子进程可派生、
    解释器兼容（ctypes 自证）
  C 用户会话不受影响（执法文件 append 正常）
  D revoke 撤除复原（ACE 清空、继承恢复、用户访问完好）
  E 收官：重新 ensure——最终保持保护位（这是 M1.6 的交付状态，不是测试残留）

说明：B 用 tools/sandbox/launcher.ps1 启动真实 AppContainer 子进程跑探针（约 20s）。
AC profile 'ZF.Sandbox.Validate' 由 util_acl.ensure() 创建/复用。

用法：py tests/test_acl_m16.py   （退出码 0 = 全过）
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import util_acl  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:150]))
    if not cond:
        _fail.append(name)


# ===== A ensure 幂等 + 状态 =====
r1 = util_acl.ensure()
check('A1 ensure 成功', r1.get('ok') is True, r1)
r2 = util_acl.ensure()
check('A2 二次运行 skip（签名一致）', r2.get('skipped') is True, r2)
st = util_acl.status()
check('A3 执法文件抽样 RX-only（无 M/F）', st.get('enf_sample_rx_only') is True, st)
check('A4 签名最新', st.get('signature_current') is True, st)
check('A5 执法文件数 > 90', (st.get('enf_files') or 0) > 90, st.get('enf_files'))

# ===== B 真实 AppContainer 子进程 E2E =====
out_path = os.path.join(ROOT, 'tmp', 'zfsbx', 'ac_probe_m16.txt')
cmd = ['powershell', '-ExecutionPolicy', 'Bypass', '-File',
       os.path.join(ROOT, 'tools', 'sandbox', 'launcher.ps1'),
       '-Mode', 'appcontainer', '-AcName', 'ZF.Sandbox.Validate', '-Cwd', ROOT]
env = dict(os.environ)
env['ZF_PROBE_OUT'] = out_path
t0 = time.time()
r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                   errors='replace', timeout=90)
elapsed = time.time() - t0
probe_line = ''
for line in (r.stdout or '').splitlines():
    if line.startswith('PROBE:'):
        probe_line = line
        break
check('B0 AC 子进程 90s 内完成且探针有输出', probe_line != '', 'elapsed=%.1fs' % elapsed)
if probe_line:
    d = json.loads(probe_line[6:])
    for k in ('write_enforcement_ro', 'write_enforcement_crit', 'write_private_keys', 'write_git'):
        check('B1 %s 在 AC 内被拒' % k, d[k].get('denied') is True, d[k])
    check('B2 工作区可写（AC 内）', d['write_workspace'].get('ok') is True, d['write_workspace'])
    check('B3 子进程可派生（AC 内）', d['spawn_child'].get('ok') is True, d['spawn_child'])
    check('B4 解释器兼容（ctypes 自证）', d['import_ctypes'].get('ok') is True, d['import_ctypes'])
else:
    _fail.extend(['B1', 'B2', 'B3', 'B4'])

# ===== C 用户会话不受影响 =====
ok_all = True
for rel in ('server/engines/common/syscall.py', 'server/security.py', 'server/updater.py'):
    p = os.path.join(ROOT, *rel.split('/'))
    try:
        fd = os.open(p, os.O_WRONLY | os.O_APPEND)
        os.close(fd)
    except OSError as e:
        ok_all = False
        print('   用户写入异常:', rel, e)
check('C1 用户对执法文件 append 正常（用户会话可写）', ok_all)

# ===== D revoke 撤除复原 =====
rv = util_acl.revoke()
check('D1 revoke 完成', rv.get('ok') is True, rv)
try:
    fd = os.open(os.path.join(ROOT, 'server', 'engines', 'common', 'syscall.py'),
                 os.O_WRONLY | os.O_APPEND)
    os.close(fd)
    check('D2 撤除后用户写入完好', True)
except OSError:
    check('D2 撤除后用户写入完好', False)
rc, out = util_acl._icacls([os.path.join(ROOT, 'server', 'engines', 'common', 'syscall.py')])
sid = util_acl._ac_sid(util_acl.AC_PROFILE_NAME)
check('D3 撤除后执法文件无 AC ACE', sid not in out)

# ===== E 收官：重新布置（交付状态 = 保护在位）=====
r3 = util_acl.ensure()
check('E1 重新布置成功（保护位保持）', r3.get('ok') is True and r3.get('applied') is True, r3)
st2 = util_acl.status()
check('E2 抽查 RX-only 恢复', st2.get('enf_sample_rx_only') is True, st2)

print('== M1.6 自保护 ACL 回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
