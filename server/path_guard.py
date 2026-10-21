# -*- coding: utf-8 -*-
"""
path_guard.py — AI 工具写路径硬约束（随安装包分发，对所有用户生效）

三层防护的代码层兜底：
1. brain/swarm 的 write_file 已有 _safe_path 前缀校验（目录穿越已防住）
2. 本模块补最大缺口：run_code 任意 shell 可绕过守卫直写任意位置
3. 供 supervisor R1 复用的统一路径判定

规则：
- 禁写区：C盘运行环境代码目录（安装目录下的 server/python 等）
- 白名单（run_code 只拦截"明显危险"的写操作，不限制正常项目内命令）：
  拦截目标为 禁写区/其他盘符绝对路径/项目根之外 的 写、删、移动类命令片段
"""
import os
import re

# 禁写区：安装/运行环境目录（含 python 解释器、server 代码）。
# 由启动方注入 ZF_RUNTIME_ROOT，或自动探测：本文件所在盘的安装布局。
def _detect_runtime_root():
    env = os.environ.get('ZF_RUNTIME_ROOT')
    if env and os.path.isdir(env):
        return os.path.normcase(os.path.normpath(env))
    # 自动探测：path_guard.py 位于 <runtime>\server\path_guard.py
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normcase(os.path.normpath(os.path.dirname(here)))


RUNTIME_ROOT = _detect_runtime_root()

# 危险命令模式：写/删/移动 + 目标路径提取（宽松启发式，宁误报提示不漏报放行）
_DANGER_PATTERNS = [
    # 重定向写：> path / >> path（排除 >NUL 等设备）
    re.compile(r'(?:^|[\s&|(])>{1,2}\s*("?)([^"&|<>\s][^"&|<>]*)', re.IGNORECASE),
    # cmd copy/move/del/rd/rmdir/mkdir 到目标
    re.compile(r'\b(?:copy|move|del|erase|rd|rmdir)\s+[^&|>]*?[\s"](/[a-z]\s+)*("[^"]+"|[^&|>\s][^&|>]*)', re.IGNORECASE),
    # powershell Out-File / Set-Content / Add-Content / Remove-Item
    re.compile(r'\b(?:Out-File|Set-Content|Add-Content|Remove-Item|New-Item)\b[^&|>]*?[\s"]("[^"]+"|[^&|>\s][^&|>]*)', re.IGNORECASE),
]

_PROG_LANG_HINT = re.compile(r'\b(python|py|node|npm|git|pip)\b', re.IGNORECASE)


def _safe_abs(p, base=None):
    try:
        p = str(p or '')
        p = os.path.expandvars(p)
        if not os.path.isabs(p) and base:
            p = os.path.join(base, p)
        return os.path.normcase(os.path.normpath(os.path.abspath(p)))
    except Exception:
        return ''


def check_write_target(path, project_root):
    """判定一个写目标路径。
    返回 (ok, reason)。ok=False 时 reason 含可给 AI 的指引。
    """
    project_root = _safe_abs(project_root or '')
    p = _safe_abs(path, project_root)
    if not p:
        return True, ''
    # 白名单1：项目根内
    if project_root and (p == project_root or p.startswith(project_root + os.sep)):
        return True, ''
    # 白名单2：系统临时目录
    tmp = _safe_abs(os.environ.get('TEMP') or '')
    if tmp and p.startswith(tmp + os.sep):
        return True, ''
    # 禁写区：运行环境目录（C盘安装目录）
    if p == RUNTIME_ROOT or p.startswith(RUNTIME_ROOT + os.sep):
        return False, ('目标 "%s" 位于运行环境目录（%s），该目录禁止 AI 修改。'
                       '请改为写入当前项目根目录内的路径。' % (path, RUNTIME_ROOT))
    # 项目根之外的其他绝对路径
    if os.path.isabs(str(path or '')):
        return False, ('目标 "%s" 在当前项目根目录（%s）之外，禁止写入。'
                       '请把产出写入项目根目录内。' % (path, project_root))
    return True, ''


def scan_code_for_writes(code):
    """静态扫描 shell 命令中的写/删/移动目标，返回可疑路径列表。"""
    hits = []
    for pat in _DANGER_PATTERNS:
        for m in pat.finditer(code or ''):
            target = (m.group(2) if m.lastindex and m.lastindex >= 2 else (m.group(1) or '')) or ''
            target = target.strip().strip('"').strip("'")
            # 排除设备名/纯开关
            if not target or target.lower() in ('nul', 'con', 'prn') or target.startswith('/'):
                continue
            if target.lower().endswith(('nul',)) :
                continue
            hits.append(target)
    # 删除类命令：逐 token 检查（del/rd/rmdir/erase 后面全是受害目标）
    for m in re.finditer(r'\b(?:del|erase|rd|rmdir)\s+([^&|>\n]+)', code or '', re.IGNORECASE):
        for tok in m.group(1).split():
            tok = tok.strip().strip('"').strip("'")
            if not tok or tok.startswith('/'):
                continue
            hits.append(tok)
    return hits


def guard_run_code(code, project_root):
    """run_code 守卫入口。返回 (allow, message)。
    allow=False 时 message 为拒绝原因+指引（直接回给 AI）。
    """
    code = str(code or '')
    if not code.strip():
        return True, ''
    # 只关心含明显写/删语义的命令；纯查询/构建类放行
    targets = scan_code_for_writes(code)
    for t in targets:
        ok, reason = check_write_target(t, project_root)
        if not ok:
            return False, ('⛔ 路径守卫拦截：%s\n'
                           '（本守卫防止 AI 误改运行环境或项目外文件，所有产出应写入当前项目根目录内。）' % reason)
    return True, ''
