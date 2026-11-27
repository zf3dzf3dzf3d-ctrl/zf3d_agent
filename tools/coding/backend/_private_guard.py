# -*- coding: utf-8 -*-
"""_private_guard.py - 智能体工具的私有目录读防护（列目录 / 检索 / 遍历类工具的统一入口）。

private/ 是应用自己的隐私与凭据目录：密钥库、对话数据库、记忆、日志、配对令牌都在里面。
密钥库在盘上是 DPAPI 密文，但其余内容（对话原文、记忆、port.json 里的 auth_token）是明文。
此前只有 read 工具过 security.is_blocked_system_path；列目录 / 目录树 / 找文件 / 内容检索
这几类工具对 private/ 完全没有防护——检索一遍就能把私有目录里的明文带进模型上下文。

规则：is_private(path) 为 True 的路径，任何“会返回其内容或目录结构”的工具都不得处理，
也不得把它作为搜索根或继续向下遍历。这里**不设白名单例外**：
  - private/记忆 虽允许 read 工具按专用通道读取，但不等于可以用通用检索工具翻查；
  - private/api_keys.json 密钥库原文件，任何读取类工具都不可读（要看配置走掩码接口）。

判定用 os.path.realpath 解析后的路径比较：项目里的目录联接 / 符号链接指向私有目录时同样拦住。
config 模块不可用时（工具包脱离 server 单独加载）退化为纯路径名判断——只要路径里有一级目录叫
private 就拦。宁可多拦，不可漏拦。
"""
import os

_WIN_PREFIX_UNC = '\\\\?\\unc\\'
_WIN_PREFIX_DEV = '\\\\?\\'


def _private_roots():
    """应用自身的私有目录（绝对路径，小写，无尾分隔符）。config 不可用时返回空列表。"""
    try:
        from config import BASE_DIR
    except ImportError:
        return []
    out = []
    for rel in (('private',), ('server', 'private')):
        out.append(os.path.abspath(os.path.join(BASE_DIR, *rel)).rstrip('\\/').lower())
    return out


def _real(path):
    """绝对化 + 解析联接/链接 + 归一大小写 + 剥离 Win32 命名空间前缀。算不出来返回 None。"""
    try:
        p = os.path.normcase(os.path.realpath(os.path.abspath(str(path or ''))))
    except (TypeError, ValueError, OSError):
        return None
    if p.startswith(_WIN_PREFIX_UNC):
        p = '\\\\' + p[len(_WIN_PREFIX_UNC):]
    elif p.startswith(_WIN_PREFIX_DEV):
        p = p[len(_WIN_PREFIX_DEV):]
    return p.rstrip('\\/')


def is_private(path):
    """该路径是否位于应用的私有目录内（或其本身就是私有目录）。"""
    p = _real(path)
    if p is None:
        return True                      # 路径算不出来：按私有处理
    roots = _private_roots()
    if not roots:
        return 'private' in p.replace('\\', '/').split('/')
    for r in roots:
        if p == r or p.startswith(r + '\\'):
            return True
    return False


def prune_private(dirpath, dirnames):
    """os.walk 原地剪枝：去掉私有目录。用法：dirnames[:] = prune_private(dirpath, dirnames)。"""
    return [d for d in dirnames if not is_private(os.path.join(dirpath, d))]
