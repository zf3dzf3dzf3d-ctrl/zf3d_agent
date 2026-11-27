# -*- coding: utf-8 -*-
"""
Git 命令执行纯工具层（自 git_branch_api.py 拆出，2026-11-10 重构 S2）
================================================================
只含无状态、无路由依赖的纯函数与常量，供 git_branch_api.py 及其他模块复用：
  - _git(args, cwd, timeout)          执行 git 命令，返回 (ok, output)
  - _check_repo(path)                 校验 path 是 git 仓库（向上找 .git）
  - _check_branch_name(name)          分支名白名单校验（防命令注入）
  - _is_runtime_noise(relpath)        运行期/临时文件噪音判定
对外接口与拆分前逐字节一致，调用方（git_branch_api.py）行为不变。
"""
import re
import shutil
import subprocess

# 分支名白名单：字母数字 . / _ - （不含空格与特殊字符）
_BRANCH_NAME_RE = re.compile(r'^[A-Za-z0-9._/\-\u4e00-\u9fff]{1,80}$')
_BRANCH_BLACKLIST = ('..', '//', '.lock')

# 运行期/临时文件：永不进功能提交（按路径子串匹配，/ 分隔）
_RUNTIME_NOISE = (
    '__pycache__/', '.pyc', '.log', '.tmp',
    'private/cache_watch', 'private/logs/', 'private/billing/',
    'oldcss.txt', '/data/', '.bak.', '.bak',
)


def _git(args, cwd, timeout=60):
    """执行 git 命令，返回 (ok, output)。"""
    git_exe = shutil.which('git')
    if not git_exe:
        return False, '未找到 git 命令，请先安装 Git for Windows'
    try:
        p = subprocess.run([git_exe] + args, cwd=cwd, capture_output=True,
                           timeout=timeout, encoding='utf-8', errors='replace',
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = (p.stdout or '') + (p.stderr or '')
        return p.returncode == 0, out.strip()
    except subprocess.TimeoutExpired:
        return False, 'git 命令超时'
    except Exception as e:
        return False, 'git 执行异常: %s' % e


def _check_repo(path):
    """校验 path 是一个 git 仓库根（或内部）。返回错误信息或 None。"""
    import os
    if not path or not os.path.isdir(path):
        return '仓库路径不存在: %s' % path
    cur = os.path.abspath(path)
    while True:
        if os.path.isdir(os.path.join(cur, '.git')):
            return None
        parent = os.path.dirname(cur)
        if parent == cur:
            return '该目录不是 git 仓库（未找到 .git）: %s' % path
        cur = parent


def _check_branch_name(name):
    if not name or not _BRANCH_NAME_RE.match(name):
        return '分支名不合法（只允许中英文/数字/._-/，1~80字符）: %r' % name
    for b in _BRANCH_BLACKLIST:
        if b in name:
            return '分支名含非法片段 %s' % b
    if name.startswith('/') or name.endswith('/') or name.endswith('.'):
        return '分支名不能以 / 开头或以 / . 结尾'
    return None


def _is_runtime_noise(relpath):
    """relpath 用 / 分隔的仓库相对路径。"""
    p = relpath.replace('\\', '/')
    low = p.lower()
    for n in _RUNTIME_NOISE:
        if n.lower() in low:
            return True
    return False
