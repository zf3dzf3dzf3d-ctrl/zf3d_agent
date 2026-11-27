# -*- coding: utf-8 -*-
"""git 仓库跟随注入模块（自 shell_exec.py 拆出，第 3 步职责分离重构）。

职责：检测 shell 命令中的 git 调用，未显式带 `-C` 的自动注入 `git -C <cwd>`。
对外接口与原 shell_exec 完全一致：
- inject_git_c(cmd, cwd)  （shell_exec._inject_git_c 的别名导出）
"""
import re


def inject_git_c(cmd, cwd):
    """git 仓库跟随强制钩子：
    - 检测 shell 命令中的 git 调用，凡未显式带 `-C` 的，自动注入 `git -C <cwd>`；
    - 显式带 `-C` 的保持不变（由调用方负责路径正确）。
    cwd 为空时原样返回。防止多项目/多仓库场景下 git 操作落到错误的默认目录。
    """
    if not cwd:
        return cmd
    # 字符级扫描切段（&& || ; | & 换行），跳过引号内的分隔符，
    # 只判定每段首 token 是否为 git，避免字符串参数里的 git 词/分隔符被误处理
    _SEG_RE = re.compile(r'(\s*(?:&&|\|\||;|\||&|\n)\s*)')

    def _split_segments(cmd):
        segs, buf, i, quote = [], [], 0, None
        while i < len(cmd):
            ch = cmd[i]
            if quote:
                buf.append(ch)
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in ('"', "'"):
                quote = ch
                buf.append(ch)
                i += 1
                continue
            two = cmd[i:i + 2]
            if two in ('&&', '||') or ch in (';', '|', '&', '\n'):
                segs.append(''.join(buf))
                buf = [two if len(two) == 2 else ch]
                i += 2 if (len(two) == 2 and two in ('&&', '||')) else 1
                segs.append(''.join(buf))
                buf = []
                continue
            buf.append(ch)
            i += 1
        segs.append(''.join(buf))
        return segs

    def _fix_segment(seg):
        s = seg.strip()
        toks = s.split()
        if not toks or toks[0] != 'git':
            return seg
        if len(toks) > 1 and toks[1] in ('-C', '--git-dir', '--work-tree'):
            return seg
        lead = seg[: len(seg) - len(seg.lstrip())]  # 保留前导空白
        tail = seg[len(seg.rstrip()):]              # 保留尾随空白
        return lead + ' '.join(['git -C "%s"' % cwd] + toks[1:]) + tail

    parts = _split_segments(cmd)
    return ''.join(p if _SEG_RE.fullmatch(p) else _fix_segment(p)
                   for p in parts)


# 兼容旧名（shell_exec._inject_git_c 的调用方无感迁移）
_inject_git_c = inject_git_c
