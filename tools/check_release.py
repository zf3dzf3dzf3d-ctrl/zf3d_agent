# -*- coding: utf-8 -*-
"""打包/发布前自检脚本（API Key 与敏感文件防泄露）。

用法:
    python tools/check_release.py [目录]

不传目录时默认检查整个项目根目录（排除 python/ 等运行环境目录）。
发现以下任何一项即报错退出码 1：
  1. private/api_keys.json 或其他 private/ 下的敏感文件混入
  2. 任何 *.bak / *.bak.* 备份文件
  3. 运行时产物：*.pid、*.log、*.jsonl、server.pid、tts_resp.bin 等
  4. private/ 目录整体存在（发布包不应包含）
"""
import os
import sys

SENSITIVE_NAMES = {"api_keys.json", "server.pid", "tts_resp.bin"}
RUNTIME_EXT = {".pid", ".log", ".jsonl", ".bin"}
SKIP_DIRS = {"python", "__pycache__", "node_modules", ".git", "plugins"}


def find_issues(root):
    issues = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = os.path.relpath(dirpath, root)
        # private/ 整体不应出现在发布包
        top = rel_dir.split(os.sep)[0] if rel_dir != "." else ""
        if top == "private":
            for f in filenames:
                issues.append(os.path.join(rel_dir, f))
            continue
        for f in filenames:
            rel = os.path.join(rel_dir, f) if rel_dir != "." else f
            low = f.lower()
            if f in SENSITIVE_NAMES:
                issues.append(rel)
            elif low.endswith(".bak") or ".bak." in low:
                issues.append(rel)
            elif os.path.splitext(low)[1] in RUNTIME_EXT:
                issues.append(rel)
    return issues


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("[check_release] 检查目录:", root)
    issues = find_issues(root)
    if issues:
        print("[check_release] 发现 %d 个不应发布的文件:" % len(issues))
        for p in issues:
            print("  -", p)
        sys.exit(1)
    print("[check_release] PASS: 无敏感/备份/运行时产物文件。")


if __name__ == "__main__":
    main()
