# -*- coding: utf-8 -*-
"""M1.0 验证的 ACL 布置/清理（对 AppContainer SID）。

用法：
  py apply_acl.py grant <AC_SID>   # 根 RX + 代码目录 M + private/.git/执法文件 全拒
  py apply_acl.py revoke <AC_SID>  # 移除本验证加过的全部 ACE
  py apply_acl.py verify <AC_SID>  # 抽查 deny 是否在位
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CODE_DIRS = ('server', 'plugins', 'tools', 'tests', 'public', 'scripts', 'tmp', 'docs', 'extensions')


def icacls(*args):
    # CREATE_NO_WINDOW：无控制台的父进程链（run_checks→test_acl_m16）每次 spawn icacls
    # 都会闪一个可见黑窗；加此标志仅后台执行，输出仍照常捕获（2026-11-24 用户实测）
    no_window = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    r = subprocess.run(['icacls'] + list(args), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', creationflags=no_window)
    return r.returncode, (r.stdout + r.stderr).strip()


def enf_files():
    sys.path.insert(0, os.path.join(ROOT, 'server'))
    from util_enforcement import ENFORCEMENT_READONLY, ENFORCEMENT_CRITICAL
    for rel in ENFORCEMENT_READONLY + ENFORCEMENT_CRITICAL:
        yield os.path.join(ROOT, *rel.split('/'))


def grant(ac):
    rc, out = icacls(ROOT, '/grant', '*%s:(OI)(CI)RX' % ac)
    print('根 RX:', rc, out[:60])
    for d in CODE_DIRS:
        rc, out = icacls(os.path.join(ROOT, d), '/grant', '*%s:(OI)(CI)M' % ac)
        print('M %s:' % d, rc)
    for sub in ('private', '.git'):
        rc, out = icacls(os.path.join(ROOT, sub), '/deny', '*%s:(OI)(CI)F' % ac)
        print('deny %s:' % sub, rc, out[:40])
    n = 0
    bad = 0
    for f in enf_files():
        # AppContainer 包 SID 不参与常规 DACL 判定（deny ACE 对它无效），写权限由中央检查
        # 按“有没有授给包 SID 的允许 ACE”决定。server/ 目录授了 M 且会继承下来，所以
        # 对执法文件必须：切断继承（把继承 ACE 固化为显式）→ 移除包 SID 条目 → 显式只授 RX。
        rc1, _ = icacls(f, '/inheritance:d')
        rc2, _ = icacls(f, '/remove', '*%s' % ac)
        rc3, out = icacls(f, '/grant', '*%s:RX' % ac)
        n += 1
        if rc1 != 0 or rc2 != 0 or rc3 != 0:
            bad += 1
            print('RX-only 失败:', f, out[:60])
    print('执法文件 RX-only: %d 个（失败 %d）' % (n, bad))


def revoke(ac):
    targets = [ROOT] + [os.path.join(ROOT, d) for d in CODE_DIRS] + \
        [os.path.join(ROOT, 'private'), os.path.join(ROOT, '.git')] + list(enf_files())
    bad = 0
    for t in targets:
        rc, out = icacls(t, '/remove', '*%s' % ac)
        if rc != 0:
            bad += 1
            print('remove 失败:', t, out[:60])
    print('revoke 完成（失败 %d）' % bad)


def verify(ac):
    # 【M1.1 移交项②修复 2026-11-24 alpha】判定精度升级：icacls 输出里包 SID 出现
    # 不足以区分 deny ACE 与 grant ACE（两者都会让 SID 命中字符串）。改为解析 SID 行
    # 后的权限形态：(OI)(CI)(DENY)…=deny 在位；(RX)/(M)…=授权残留（private/.git 应为
    # deny，tmp 应为 M，执法文件应只有 RX——RX 残留在 deny 目录上无害但单列可见）。
    import re as _re
    def _ace_kind(out, sid):
        for ln in out.splitlines():
            if sid in ln:
                tail = ln.split(sid, 1)[1]
                if _re.search(r'DENY', tail, _re.I):
                    return 'deny'
                if _re.search(r'\((RX|M|F|W|R)\)', tail, _re.I):
                    return 'grant'
                return 'sid-only'
        return 'absent'
    for rel in ('private', '.git', 'server' + os.sep + 'engines' + os.sep + 'common' + os.sep + 'syscall.py'):
        rc, out = icacls(os.path.join(ROOT, *rel.split('/')))
        kind = _ace_kind(out, ac)
        print('%-42s deny在位=%s（ACE形态=%s）' % (rel, kind == 'deny', kind))
    rc, out = icacls(os.path.join(ROOT, 'tmp'))
    kind = _ace_kind(out, ac)
    print('%-42s M授权在位=%s（ACE形态=%s）' % ('tmp', kind == 'grant', kind))


if __name__ == '__main__':
    action, ac = sys.argv[1], sys.argv[2]
    {'grant': grant, 'revoke': revoke, 'verify': verify}[action](ac)
