#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_mac_compat.py — Mac 版兼容性自检
用法: python3 server/check_mac_compat.py
功能:
  1. 静态扫描 server/ 下 py 文件中的 Windows 专属调用（不含已白名单的兼容层）
  2. 验证 platform_compat 可导入、核心函数在本机可跑
输出报告到 stdout。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WHITELIST = {"platform_compat.py"}   # 兼容层本身允许出现平台分支

# Windows 专属模式（出现即在 mac 上有风险）
PATTERNS = [
    (r"\bos\.startfile", "os.startfile (仅 Windows)"),
    (r"\bimport\s+winreg\b", "import winreg"),
    (r"\bimport\s+winsound\b", "import winsound"),
    (r"\bctypes\.windll\b", "ctypes.windll"),
    (r"\bfrom\s+ctypes\s+import\s+wintypes\b", "ctypes.wintypes"),
    (r"\buser32\b", "user32 (Win32 API)"),
    (r"\bkernel32\b", "kernel32 (Win32 API)"),
    (r"\bpystray\b", "pystray (win 托盘)"),
    (r"\bwin32api\b|\bwin32con\b|\bwin32gui\b", "pywin32"),
    (r"\.bat\b", "调用 .bat 脚本"),
]

# 已有 darwin 分支的文件视为"已兼容"，仍报告但降级
SKIP_DIRS = {"__pycache__", "_archive", "node_modules", ".git", "venv", "public"}


def scan():
    findings = {}   # file -> [(lineno, pattern_desc, line)]
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            if fn in WHITELIST:
                continue
            fpath = os.path.join(dirpath, fn)
            rel = os.path.relpath(fpath, ROOT)
            try:
                text = open(fpath, encoding="utf-8-sig", errors="ignore").read()
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                # 跳过注释与 darwin 分支行
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "darwin" in line or "platform ==" in line or "sys.platform" in line:
                    continue
                for pat, desc in PATTERNS:
                    if re.search(pat, line):
                        findings.setdefault(rel, []).append((i, desc, stripped[:100]))
    return findings


def selftest():
    print("\n===== platform_compat 自检 =====")
    sys.path.insert(0, ROOT)
    import platform_compat as pc
    print("平台:", "mac" if pc.IS_MAC else "win" if pc.IS_WIN else "linux")
    print("machine_guid:", pc.machine_guid())
    print("screen_size:", pc.screen_size())


def main():
    findings = scan()
    if not findings:
        print("✅ 未发现 Windows 专属调用（除兼容层）")
    else:
        total = 0
        for f, items in sorted(findings.items()):
            print(f"\n⚠️ {f}")
            for ln, desc, line in items:
                total += 1
                print(f"   L{ln}  [{desc}]  {line}")
        print(f"\n共 {total} 处潜在平台相关代码")
    selftest()


if __name__ == "__main__":
    main()
