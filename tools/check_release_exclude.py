# -*- coding: utf-8 -*-
"""发布剔除门禁：private/port.json 等敏感文件不得进入发布产物/版本库。
背景（2026-11-20 外部用户安全收口）：private/port.json 含 auth_token 明文，
若随安装包或仓库分发则回环免 token 防线失效（预置共享 token）。
用法：python tools/check_release_exclude.py [发布目录1 发布目录2 ...]
不传目录则只查 git 跟踪面。任一命中即退出码 1，阻断发布。"""
import sys, os

from util_log import get_logger

log = get_logger('check_release_exclude')
SENSITIVE = ("private/port.json", "private\\port.json")

def check_dir(root):
    hits = []
    for dirpath, dirs, files in os.walk(root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), root)
            if rel.replace("\\", "/") in ("private/port.json",):
                hits.append(os.path.join(dirpath, f))
    return hits

def check_git():
    import subprocess
    r = subprocess.run(["git", "ls-files", "private/"],
                       capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l.strip()]

def main():
    bad = []
    for d in sys.argv[1:]:
        if os.path.isdir(d):
            bad += check_dir(d)
        else:
            log.warning(f"[WARN] 目录不存在: {d}")
    tracked = check_git()
    if bad or tracked:
        log.info("[FAIL] 检出敏感文件，禁止发布：")
        for p in bad: log.info("  产物内: " + p)
        for p in tracked: log.info("  git跟踪: " + p)
        sys.exit(1)
    log.info("[PASS] 发布剔除门禁通过：git 无 private/ 跟踪，产物无 port.json。")

if __name__ == "__main__":
    main()
