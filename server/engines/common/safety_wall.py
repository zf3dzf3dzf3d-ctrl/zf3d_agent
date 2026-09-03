#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/safety_wall.py - 三层防护墙（5.1.0）

所有引擎工具集共用的安全机制，供各 tools/__init__.py import 使用：

第一层：写前自动备份（backup_before_write）
第二层：危险命令拦截（check_shell_command / check_code）
第三层：大范围操作自检（check_batch_write / check_core_file）

原则：任何一层拒绝都返回 (False, 原因)，调用方直接把原因返给模型，
让模型自己换安全的方式重做——不需要人确认。
"""

import os
import re
import shutil
import time

# ---------------------------------------------------------------- 配置

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

BACKUP_DIR = os.path.join(ROOT, 'backups', 'tool_writes')

# 备份阈值：小于该字节数的文件不备份（临时小文件太多）
BACKUP_MIN_SIZE = 512

# 备份保留数（每个文件最多保留 N 份）
BACKUP_KEEP = 5

# 大范围操作阈值：单次批量写超过该文件数需拆分
BATCH_WRITE_LIMIT = 10

# 核心文件（相对根目录，/ 分隔，统一小写比较）
CORE_FILES = {
    'public/index.html',
    'public/js/app.js',
    'server/server.py',
    'server/handler_base.py',
}

# 大范围删除/修改的通配符（re.search 匹配命令串）
_DANGER_CMD_PATTERNS = [
    r'\brd\s+/s', r'\brmdir\s+/s', r'\brm\s+-rf',          # 递归删除
    r'\bdel\s+/(s|q)\b', r'\bdel\s+\*\.(\w+)\s*$',         # 批量删除
    r'\bformat\b\s+[a-z]:',                                  # 格式化
    r'\bmove\s+.*\*\.(\w+)\s',                               # 批量移动
    r'\bfor\s+%[^%]+%\s+in\s+\(',                           # for 循环改文件
    r'\breg\s+(delete|add)\b.*\s/f',                        # 注册表强删
    r'\bRemove-Item\s+.*-Recurse',                          # PS 递归删除
    r'\bgit\s+push\s+.*--force',                            # 强推
    r'\bgit\s+reset\s+--hard',                              # 硬重置
    r'\bgit\s+clean\s+-fd',                                   # 清空未跟踪
    r'\bgit\s+clean\s+-\w*f',                                 # clean 带 -f 任意组合
    r'\bdrop\s+table\b', r'\bdrop\s+database\b',              # 删库
    r'\bmkfs\b', r'\bdiskpart\b',                             # 磁盘级操作
    r'\bvssadmin\s+delete\s+shadows\b',                       # 删卷影备份
    r'\bcipher\s+/w\b',                                       # 擦除剩余空间
    r'\bicacls\s+.*\s/grant\b.*\beveryone\b',                 # 放开权限
    r'\battrib\s+.*-h.*-s.*\b',                               # 改系统文件属性
]

# PS 变体：-Recurse / -Force 顺序无关
_DANGER_PS_PATTERNS = [
    r'\bRemove-Item\b[^;\n]*\b-Recurse\b',
    r'\bRemove-Item\b[^;\n]*\b-Force\b',
    r'\brm\b[^;\n]*\b-Recurse\b',                             # PS 里 rm 是 Remove-Item 别名
    r'\bri\b[^;\n]*\b-Recurse\b',
]

def _normalize_cmd(c):
    """归一化命令串，防引号/转义/分隔符绕过：
    - 去掉成对引号（'rm' /s -> rm /s）
    - 剥掉所有残余引号（'r'm -> rm，防拆词绕过）
    - 去掉 ^ 和 ` 这类 cmd/PS 转义符（r^d -> rd）
    """
    s = str(c)
    # 直接剥掉所有引号和转义符（防成对解包吞字符、防 'r'm 拆词）
    s2 = s.replace("'", '').replace('"', '')
    s2 = s2.replace('^', '').replace('`', '')
    return s2

# 命令内出现这些正则元字符却没加引号/单引号包裹的典型崩法，直接提示
_PS_META = "`.{}()^$+?[]|\\".replace('`', '`')


# ---------------------------------------------------------------- 第一层：写前备份

def backup_before_write(full_path, tag='write'):
    """写文件前调用。成功返回备份路径，跳过返回 None，永不抛错。
    备份目录：backups/tool_writes/<相对路径折叠>/<name>.<tag>.<ts>"""
    try:
        if not os.path.isfile(full_path):
            return None
        if os.path.getsize(full_path) < BACKUP_MIN_SIZE:
            return None
        rel = os.path.relpath(full_path, ROOT)
        rel = re.sub(r'[<>:"|?*]', '_', rel).replace('\\', '__')
        d = os.path.join(BACKUP_DIR, rel)
        os.makedirs(d, exist_ok=True)
        ts = time.strftime('%Y%m%d_%H%M%S')
        bak = os.path.join(d, '%s.%s.%s.bak' % (os.path.basename(full_path), tag, ts))
        shutil.copy2(full_path, bak)
        _prune(d, os.path.basename(full_path), tag)
        return bak
    except Exception:
        return None


def _prune(d, base, tag):
    try:
        baks = sorted(f for f in os.listdir(d) if f.startswith(base + '.' + tag))
        for f in baks[:-BACKUP_KEEP]:
            os.remove(os.path.join(d, f))
    except Exception:
        pass


# ---------------------------------------------------------------- 第二层：命令/代码拦截

def check_shell_command(code):
    """返回 None 放行；返回字符串则拒绝并作为原因。
    对原始串和归一化串（去引号/转义符）各匹配一遍，防 r''m、r^d 这类绕过。"""
    if not code:
        return None
    c = str(code)
    for target in (c, _normalize_cmd(c)):
        for pat in _DANGER_CMD_PATTERNS + _DANGER_PS_PATTERNS:
            if re.search(pat, target, re.IGNORECASE):
                return ('危险操作被安全墙拦截（第二层）：命令匹配到高风险模式 [%s]。'
                        '如确需执行，请改用更小范围的安全做法（先备份、逐个处理、'
                        '或让用户手动执行）。命令：%s') % (pat, c[:200])
    return None


def check_code(code):
    """Python/JS 代码文本检查：防编码事故。返回 None 放行。"""
    if not code:
        return None
    c = str(code)
    # 写文件不带 encoding= 的 open(...,'w') —— 历史乱码根因
    if re.search(r"open\([^)]*['\"][wa]b?['\"]\s*(,|\))", c) and 'encoding' not in c \
            and re.search(r"[\u4e00-\u9fff]", c) is None:
        # 代码里没中文也要防，但只有代码含中文时才硬拦
        pass
    if re.search(r"[\u4e00-\u9fff]", c):
        # 含中文的代码里有 open 写操作但无 encoding → 硬拦
        if re.search(r"open\([^)]*['\"][wa]b?['\"]\s*(,|\))", c) and 'encoding=' not in c \
                and 'gbk' not in c.lower() and '\\u4e00' not in c:
            return ('危险操作被安全墙拦截（第二层）：代码包含中文且存在未指定 '
                    'encoding= 的 open(...,"w") 写文件操作——这是历次乱码事故的根因。'
                    '请改为 open(path, "w", encoding="utf-8")。')
    return None


# ---------------------------------------------------------------- 第三层：批量/核心文件自检

def is_core_file(full_path):
    try:
        rel = os.path.relpath(full_path, ROOT).replace('\\', '/').lower()
        return rel in CORE_FILES
    except Exception:
        return False


def check_batch_write(paths):
    """paths: 本次计划写入的完整路径列表。
    返回 (ok, message)。超过 BATCH_WRITE_LIMIT 拒绝。"""
    n = len(paths or [])
    if n <= BATCH_WRITE_LIMIT:
        return True, ''
    return False, ('大范围操作被安全墙拦截（第三层）：单次写入 %d 个文件，超过上限 %d。'
                   '请拆成多批、每批不超过 %d 个，每批写完验证再继续。'
                   ) % (n, BATCH_WRITE_LIMIT, BATCH_WRITE_LIMIT)


def core_file_warning(full_path):
    """核心文件被修改时返回提醒文本（放行但附带警告），非核心返回 ''。"""
    if is_core_file(full_path):
        return ('\n[安全墙提示] 这是核心文件（%s）。改动前已自动备份到 backups/tool_writes/。'
                '请确保只做最小改动，写完后用读取工具验证编码与结构。'
                % os.path.relpath(full_path, ROOT).replace('\\', '/'))
    return ''
