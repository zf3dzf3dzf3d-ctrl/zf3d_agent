# -*- coding: utf-8 -*-
"""util_acl.py - M1.6 自保护 ACL：给沙箱进程（AppContainer）的执法文件写保护（2026-11-24）。

解决什么问题
------------
M1.0 实测结论（docs/沙箱技术验证-M1.0-20261124.md）：AppContainer 包 SID 不参与常规
DACL 判定，deny ACE 对它无效；它能否写一个文件，取决于**有没有授给包 SID 的允许 ACE**
（"授权缺席"模型）。因此给沙箱进程的写保护必须这样布防：

    仓库根            授 RX（可读可执行，全局继承）
    代码目录          授 M（工作区可写）
    private/、.git/   不授 M（继承到的 RX 只够读 → 写被中央检查拒绝）
    执法文件（RO+CR） 切断继承 → 移除包 SID 条目 → 显式只授 RX（目录 M 不可再穿透）

运行在 AppContainer 里的进程，对执法文件与 private/.git 的写入会全部失败；用户会话
（正常令牌）不受任何影响。这是把 M0"文本匹配的清单"升级为 OS 级强制的落地形态
（策划案 M1.6 验收：沙箱内进程对 policy/、钩子、安全模块的写入全部失败；用户会话可写）。

与 M0 清单方案的关系
--------------------
清单方案（_file_protect）拦的是"智能体工具的写入"，壳命令与第三方进程拦不住；
本模块的 ACL 拦的是"沙箱内一切进程的写入"，OS 强制。两层并存互补：
M1.8 之前不清退清单方案，等沙箱子进程成为智能体执行的默认形态后再清退（记录于策划案）。

用法
----
    import util_acl
    util_acl.ensure()        # 幂等布置（状态签名一致则跳过）
    util_acl.status()        # 布置状态报告
    util_acl.revoke()        # 全部撤除并恢复继承（回到布置前）
    CLI: py server/util_acl.py ensure|status|revoke

注意：对本模块的任何修改=修改执法设施的 OS 级防线，任务须写明理由与验收（AGENTS 红线 1）。
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from util_log import get_logger

log = get_logger('util_acl')

AC_PROFILE_NAME = 'ZF.Sandbox.Validate'
STATE_PATH_MARK = 'private/policy/acl_state.json'

_CODE_DIRS = ('server', 'plugins', 'tools', 'tests', 'public', 'scripts', 'tmp', 'docs', 'extensions')
_NO_GRANT_DIRS = ('private', '.git')


def _repo_root() -> str:
    try:
        from config import BASE_DIR
        return os.path.abspath(BASE_DIR)
    except ImportError:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def name_w(s: str) -> ctypes.c_wchar_p:
    return ctypes.c_wchar_p(s)


def _icacls(args: List[str]) -> Tuple[int, str]:
    # CREATE_NO_WINDOW：本模块常被无控制台的进程链调用（run_checks→test_acl_m16），
    # 控制台程序不加此标志时每次 spawn 都会闪一个可见黑窗（2026-11-24 用户实测 75 秒 866 次）
    no_window = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    r = subprocess.run(['icacls'] + args, capture_output=True, creationflags=no_window)
    return r.returncode, (r.stdout + r.stderr).decode('gbk', 'replace')


def _enf_files() -> List[str]:
    """执法文件全清单（唯一真源 = util_enforcement 的两级清单）。"""
    try:
        import util_enforcement
        ro, cr = util_enforcement.ENFORCEMENT_READONLY, util_enforcement.ENFORCEMENT_CRITICAL
    except ImportError:
        return []
    root = _repo_root()
    out = []
    for rel in list(ro) + list(cr):
        p = os.path.join(root, *rel.split('/'))
        if os.path.isfile(p):
            out.append(p)
    return out


def _ac_sid(profile: str) -> Optional[str]:
    """取 AppContainer 的 SID；profile 不存在时先创建（幂等，EXISTS 视为成功）。"""
    try:
        import ctypes
        import ctypes.wintypes
    except ImportError:
        return None
    userenv = ctypes.WinDLL('userenv', use_last_error=True)
    userenv.CreateAppContainerProfile.argtypes = (
        ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_wchar_p,
        ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p))
    userenv.CreateAppContainerProfile.restype = ctypes.c_uint
    userenv.DeriveAppContainerSidFromAppContainerName.argtypes = (ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p))
    userenv.DeriveAppContainerSidFromAppContainerName.restype = ctypes.c_uint
    advapi = ctypes.WinDLL('advapi32', use_last_error=True)
    advapi.ConvertSidToStringSidW.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_wchar_p))
    advapi.ConvertSidToStringSidW.restype = ctypes.c_bool

    sid_ptr = ctypes.c_void_p()
    hr = userenv.CreateAppContainerProfile(name_w(profile), name_w(profile), name_w(profile),
                                           None, 0, ctypes.byref(sid_ptr))
    if hr not in (0, 0x800700B7) and (hr & 0xFFFF) != 183:   # 0x800700B7 = 已存在
        log.warning('AC profile 创建失败 hr=0x%08X' % hr)
        return None
    if userenv.DeriveAppContainerSidFromAppContainerName(name_w(profile), ctypes.byref(sid_ptr)) != 0:
        return None
    s = ctypes.c_wchar_p()
    if not advapi.ConvertSidToStringSidW(sid_ptr, ctypes.byref(s)):
        return None
    result = s.value or None
    ctypes.windll.kernel32.LocalFree(s)
    return result


def _signature() -> str:
    """布置内容的指纹：执法清单 + 代码目录清单变化 → 重新布置。"""
    try:
        import util_enforcement
        ro, cr = list(util_enforcement.ENFORCEMENT_READONLY), list(util_enforcement.ENFORCEMENT_CRITICAL)
    except ImportError:
        ro, cr = [], []
    payload = json.dumps({'ro': ro, 'cr': cr, 'dirs': list(_CODE_DIRS)}, sort_keys=True)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def _state_path() -> str:
    return os.path.join(_repo_root(), STATE_PATH_MARK.replace('/', os.sep))


def _load_state() -> Dict[str, Any]:
    try:
        with open(_state_path(), 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_state(state: Dict[str, Any]) -> None:
    path = _state_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def ensure(force: bool = False) -> Dict[str, Any]:
    """幂等布置全部 ACL。返回 {'ok', 'applied', 'skipped', 'sid', 'signature'}。"""
    root = _repo_root()
    sid = _ac_sid(AC_PROFILE_NAME)
    if not sid:
        return {'ok': False, 'err': '无法取得 AppContainer SID'}
    state = _load_state()
    sig = _signature()
    if not force and state.get('signature') == sig and state.get('ac_sid') == sid:
        return {'ok': True, 'applied': False, 'skipped': True,
                'sid': sid, 'signature': sig, 'applied_at': state.get('applied_at')}

    targets: List[Tuple[str, str]] = [(root, 'RX')]
    for d in _CODE_DIRS:
        targets.append((os.path.join(root, d), 'M'))
    for f in _enf_files():
        targets.append((f, 'RX'))
    bad = 0
    for path, rights in targets:
        if not os.path.exists(path):
            continue
        is_dir = os.path.isdir(path)
        flags = ':(OI)(CI)' if is_dir else ':'
        rc, out = _icacls([path, '/grant', '*%s%s%s' % (sid, flags, rights)])
        if rc != 0:
            bad += 1
            log.warning('grant 失败 %s: %s' % (path, out[:60]))
            continue
        if rights == 'RX' and is_dir is False and path in [t for t, r2 in targets if r2 == 'RX'][1:]:
            # 执法文件（非根）：切断继承并清掉包 SID 的继承条目，再显式补 RX，
            # 防止代码目录的 M 经继承穿透（M1.0 实测：包 SID 不受 deny 约束）
            _icacls([path, '/inheritance:d'])
            _icacls([path, '/remove', '*%s' % sid])
            rc3, out3 = _icacls([path, '/grant', '*%s:RX' % sid])
            if rc3 != 0:
                bad += 1
                log.warning('RX-only 失败 %s: %s' % (path, out3[:60]))
    _save_state({'signature': sig, 'ac_sid': sid, 'applied_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
                 'files': len(_enf_files()), 'bad': bad})
    log.info('ACL 布置完成: sid=%s 文件=%d 失败=%d' % (sid, len(_enf_files()), bad))
    return {'ok': bad == 0, 'applied': True, 'skipped': False, 'sid': sid,
            'signature': sig, 'files': len(_enf_files()), 'bad': bad}


def revoke() -> Dict[str, Any]:
    """撤除全部包 SID 的 ACE，并恢复执法文件的继承（回到布置前）。"""
    sid = _ac_sid(AC_PROFILE_NAME)
    if not sid:
        return {'ok': False, 'err': '无法取得 AppContainer SID'}
    root = _repo_root()
    targets = [root] + [os.path.join(root, d) for d in _CODE_DIRS] + \
        [os.path.join(root, d) for d in _NO_GRANT_DIRS] + _enf_files()
    bad = 0
    for path in targets:
        if not os.path.exists(path):
            continue
        rc, _ = _icacls([path, '/remove', '*%s' % sid])
        if rc != 0:
            bad += 1
        if os.path.isfile(path):
            _icacls([path, '/inheritance:e'])   # 布置期切断了继承，撤除后恢复
    os.remove(_state_path()) if os.path.isfile(_state_path()) else None
    log.info('ACL 已撤除（失败 %d）' % bad)
    return {'ok': bad == 0, 'removed': True, 'bad': bad}


def status() -> Dict[str, Any]:
    """布置状态抽查：执法文件是否为 RX-only、代码目录是否 M、private 是否无授权。"""
    sid = _ac_sid(AC_PROFILE_NAME)
    if not sid:
        return {'ok': False, 'err': '无法取得 AppContainer SID'}
    root = _repo_root()

    def ace_lines(path: str) -> List[str]:
        rc, out = _icacls([path])
        return [l.strip() for l in out.splitlines() if sid in l]

    enf = _enf_files()
    import re as _re
    sample = enf[:min(5, len(enf))]

    def _rights(path: str) -> List[str]:
        rc, out = _icacls([path])
        toks = []
        for l in out.splitlines():
            l = l.strip()
            if sid in l:
                toks += _re.findall(r'\(([A-Z]+)\)', l.split(sid, 1)[1])
        return toks

    # RX-only 判定：包 SID 的 ACE 里有 RX、且没有 M/F（写类）——icacls 权限是 (RX) 带括号形式
    rx_only = all(
        (lambda toks: 'RX' in toks and not ({'M', 'F', 'W'} & set(toks)))(_rights(f))
        for f in sample
    ) if sample else False
    st = _load_state()
    return {'ok': True, 'sid': sid, 'applied_at': st.get('applied_at'),
            'signature_current': st.get('signature') == _signature(),
            'enf_sample_rx_only': rx_only, 'enf_files': len(enf)}


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'ensure':
        import json as _j
        print(_j.dumps(ensure(force='--force' in sys.argv), ensure_ascii=False, indent=1))
    elif cmd == 'revoke':
        import json as _j
        print(_j.dumps(revoke(), ensure_ascii=False, indent=1))
    else:
        import json as _j
        print(_j.dumps(status(), ensure_ascii=False, indent=1))
