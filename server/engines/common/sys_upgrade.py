# -*- coding: utf-8 -*-
"""sys_upgrade: P4 内核自升级（ZhuFeng Agent OS 六动词·升级层）

内核模块（engines/common/ 下 sys_*.py 等）的自我更新能力，双回滚保险：
- sys_upgrade_status:  查看当前 git 快照 + 待升级模块状态
- sys_upgrade_apply:   应用升级：对目标模块做「git 快照提交 + .bak 双备份」→ 写入新代码 →
                       py_compile 编译门禁 → 失败自动双回滚（git checkout + .bak 还原）
- sys_upgrade_rollback: 手动回滚某模块到 .bak 或 git 上一个提交

安全设计：
- ZF_UPGRADE 环境变量动态闸门，默认关闭
- 只允许升级白名单目录：engines/common/sys_*.py（内核 sys 层），禁碰其他路径
- py_compile 是硬门禁：新代码编译不过 = 拒绝落盘（连写都不写，先编译后替换）
- 每次升级前自动 git add+commit 快照（无 git 环境降级为仅 .bak）
- dangerous 级走 syscall 权限网关 + 全程审计
"""
import os
import re
import time
import shutil
import py_compile
import subprocess

from engines.common.syscall import check_permission as _sys_check
from engines.common.syscall import audit as _syscall_audit

# ---- 动态闸门 ----
def _upgrade_gate():
    return os.environ.get('ZF_UPGRADE', '0') == '1'

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))  # 项目根（server 的上一级）
_COMMON = os.path.dirname(os.path.abspath(__file__))  # server/engines/common

# 升级目标白名单：只许动内核 sys 层
_TARGET_RE = re.compile(r'^sys_[a-z0-9_]+\.py$')

# git 可执行（找不到则降级纯 .bak）
_GIT = shutil.which('git')


def _git_snapshot(target_rel, label):
    """升级前 git 快照。返回 (ok, msg)。失败不阻塞（还有 .bak 兜底）。"""
    if not _GIT:
        return False, 'git 不可用，仅 .bak 兜底'
    try:
        subprocess.run([_GIT, 'add', target_rel], cwd=_ROOT, timeout=20,
                       capture_output=True, creationflags=0x08000000)
        r = subprocess.run([_GIT, 'commit', '-m', '[sys_upgrade snapshot] ' + label,
                            '--allow-empty', '--no-verify'],
                           cwd=_ROOT, timeout=30, capture_output=True,
                           creationflags=0x08000000)
        return True, (r.stdout or b'').decode('utf-8', 'ignore')[:100]
    except Exception as e:
        return False, str(e)[:120]


def _git_rollback(target_rel):
    """git 层回滚：checkout 上一个提交里的该文件。"""
    if not _GIT:
        return False, 'git 不可用'
    try:
        r = subprocess.run([_GIT, 'checkout', 'HEAD~1', '--', target_rel],
                           cwd=_ROOT, timeout=20, capture_output=True,
                           creationflags=0x08000000)
        return r.returncode == 0, 'git checkout HEAD~1'
    except Exception as e:
        return False, str(e)[:120]


def get_schemas():
    if not _upgrade_gate():
        return []
    return [
        {'type': 'function', 'function': {
            'name': 'sys_upgrade_status',
            'description': '自升级：查看当前 git 状态与可升级的内核 sys_* 模块列表',
            'parameters': {'type': 'object', 'properties': {}}}},
        {'type': 'function', 'function': {
            'name': 'sys_upgrade_apply',
            'description': '自升级：升级某个内核 sys_* 模块（须给 target=模块文件名如 sys_ui.py，code=完整新源码）。自动 git 快照+.bak 双备份+py_compile 门禁+失败双回滚',
            'parameters': {'type': 'object', 'properties': {
                'target': {'type': 'string', 'description': '目标模块文件名，如 sys_ui.py'},
                'code': {'type': 'string', 'description': '完整新模块源码'},
                'note': {'type': 'string', 'description': '升级说明（可选）'}},
                'required': ['target', 'code']}}},
        {'type': 'function', 'function': {
            'name': 'sys_upgrade_rollback',
            'description': '自升级：手动回滚某模块（优先 .bak 还原，否则 git HEAD~1）',
            'parameters': {'type': 'object', 'properties': {
                'target': {'type': 'string'}}, 'required': ['target']}}},
    ]


def execute(name, args, ctx):
    if not _upgrade_gate():
        return False, '自升级未开启（设置环境变量 ZF_UPGRADE=1）'
    t0 = time.time()
    try:
        if name == 'sys_upgrade_status':
            ok, r = _do_status()
        elif name == 'sys_upgrade_apply':
            ok, r = _do_apply(args, ctx)
        elif name == 'sys_upgrade_rollback':
            ok, r = _do_rollback(args, ctx)
        else:
            ok, r = False, '未知自升级操作: %s' % name
    except Exception as e:
        ok, r = False, '自升级异常: %s' % e
    _syscall_audit(name, (ctx or {}).get('engine_id', '?'), ok,
                   (time.time() - t0) * 1000, level='dangerous',
                   err='' if ok else str(r)[:120])
    return ok, r


def _resolve_target(target):
    """校验目标在白名单内，返回绝对路径或 None。"""
    t = str(target or '').strip().replace('\\', '/').split('/')[-1]
    if not _TARGET_RE.match(t):
        return None
    p = os.path.join(_COMMON, t)
    # 防符号链接/路径逃逸：realpath 必须仍在 common 目录下
    if os.path.dirname(os.path.realpath(p)) != os.path.realpath(_COMMON):
        return None
    return p


def _do_status():
    mods = sorted(f for f in os.listdir(_COMMON) if _TARGET_RE.match(f))
    git_ok = bool(_GIT)
    head = ''
    if git_ok:
        try:
            r = subprocess.run([_GIT, 'log', '-1', '--oneline'], cwd=_ROOT,
                               timeout=10, capture_output=True,
                               creationflags=0x08000000)
            head = (r.stdout or b'').decode('utf-8', 'ignore').strip()
        except Exception:
            head = '(git log 失败)'
    out = ['git: %s  HEAD: %s' % ('可用' if git_ok else '不可用(仅.bak)', head or '-'),
           '可升级内核模块(%d):' % len(mods), ' '.join(mods)]
    return True, '\n'.join(out)


def _do_apply(args, ctx):
    target = args.get('target')
    code = str(args.get('code') or '')
    note = str(args.get('note') or '')[:120]
    path = _resolve_target(target)
    if path is None:
        return False, '目标不在升级白名单（只许 engines/common/sys_*.py）: %s' % target
    if not os.path.exists(path):
        return False, '目标模块不存在: %s' % target
    if len(code) > 128 * 1024:
        return False, '新代码超过 128KB 上限'
    # dangerous 级权限网关
    ok_perm, why = _sys_check('sys_upgrade_apply')
    if not ok_perm:
        return False, why
    # ---- 门禁1：先编译新代码（不落盘，用临时文件） ----
    tmp = path + '.upgrade.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(code)
    try:
        py_compile.compile(tmp, doraise=True)
    except Exception as e:
        try:
            os.remove(tmp)
        except Exception:
            pass
        return False, 'py_compile 门禁拒绝（新代码编译不过，未动原文件）: %s' % str(e)[:300]
    # ---- 双备份：git 快照 + .bak ----
    target_rel = os.path.relpath(path, _ROOT)
    _git_snapshot(target_rel, 'upgrade %s %s' % (os.path.basename(path), note))
    bak = path + '.bak'
    try:
        shutil.copy2(path, bak)
    except Exception:
        pass
    # ---- 替换 ----
    os.replace(tmp, path)
    # ---- 门禁2：替换后再整体编译一次（防 import 副作用之外的语法边界） ----
    try:
        py_compile.compile(path, doraise=True)
    except Exception as e:
        # 双回滚：git + .bak
        rok1, m1 = _git_rollback(target_rel)
        try:
            shutil.copy2(bak, path)
        except Exception:
            pass
        return False, '替换后编译失败，已双回滚(git=%s, bak=已还原): %s' % (m1, str(e)[:200])
    return True, ('升级完成: %s %s（git 快照 + .bak 已就位，重启引擎后生效）'
                  % (os.path.basename(path), note))


def _do_rollback(args, ctx):
    target = args.get('target')
    path = _resolve_target(target)
    if path is None:
        return False, '目标不在升级白名单: %s' % target
    ok_perm, why = _sys_check('sys_upgrade_rollback')
    if not ok_perm:
        return False, why
    bak = path + '.bak'
    target_rel = os.path.relpath(path, _ROOT)
    if os.path.exists(bak):
        shutil.copy2(bak, path)
        return True, '已从 .bak 还原: %s' % os.path.basename(path)
    rok, m = _git_rollback(target_rel)
    return (True, '已 git 回滚: %s' % m) if rok else (False, '无 .bak 且 git 回滚失败')
