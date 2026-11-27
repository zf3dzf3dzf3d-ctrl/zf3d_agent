# -*- coding: utf-8 -*-
"""CSS 注释配对 · 线性状态机防线（小队收口第2轮，2026-11-13 立项）

为什么需要它：
  本仓库两次真实事故（style-canvas-clean.css 的 TOPBAR-BRAND 真源块、style-filetree.css 的
  .ft-panel-overlay 基础规则）都是「注释结构破坏 → 选择器被解析器连声明块一起吞掉 = 死代码」，
  表现为「改了 CSS 完全不生效」，肉眼和 diff 都看不出来。
  计数法（数 /* 和 */ 的个数是否相等）**结构上检不出** canvas-clean 那种「开闭数量相等但内层
  提前闭合」的错位，因此本脚本用线性状态机扫描，并作为 CSS 改动的验收门禁。

检测三类缺陷（均为浏览器会丢规则的结构问题）：
  STRAY_CLOSE         不在注释中遇到 */            —— 非法 token，污染紧随的选择器
  NESTED_EARLY_CLOSE  在注释中又遇到 /*            —— CSS 无嵌套，此处即提前闭合，后续变裸文本
  UNCLOSED            文件结束仍在注释中            —— 之后全部 CSS 被吞

用法：
  python scripts/check_css_comments.py             # 扫描全部 CSS，有问题退出码 1
  python scripts/check_css_comments.py --sync      # 额外做 public/ 与 server/public/ 双副本内容比对

口径说明（收口第2轮定案）：
  ① 本脚本的硬门禁只有「注释结构状态机」一条（退出码 1）。
  ② --sync 为【提示级】，不判失败：server/public/ 已于 2026-11-10「双副本消灭」裁决中停用
     同步、降级为退役归档（见 server/server_runtime.py:536-541，静态服务只读根 public/，
     config.PUBLIC_DIR = BASE_DIR/public）。因此双副本漂移是预期状态，不是缺陷；等
     server/public 跑满一天无 404 验收门通过后会被 git rm，届时删掉本 --sync 分支即可。
  ③ 若要比较 index.html 双副本，绝不能用 fc /b：两份行尾已分叉（根 LF / server CRLF），
     逐字节必报 DIFF；本脚本按「文本行内容」归一口径比较。
"""
import hashlib
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
SRV_PUB = os.path.join(ROOT, "server", "public")
CSS_DIRS = [
    ("public/css", os.path.join(PUB, "css")),
    ("public/css/splits", os.path.join(PUB, "css", "splits")),
    ("server/public/css", os.path.join(SRV_PUB, "css")),
    ("server/public/css/splits", os.path.join(SRV_PUB, "css", "splits")),
]


def scan_comments(path):
    """线性状态机：返回缺陷列表（行号 1-based）。"""
    s = io.open(path, encoding="utf-8-sig", errors="replace").read()
    i, n = 0, len(s)
    inside = False
    start = 0
    line = 1
    issues = []
    while i < n:
        c = s[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        two = s[i:i + 2]
        if not inside:
            if two == "/*":
                inside, start, i = True, line, i + 2
                continue
            if two == "*/":
                issues.append((line, "STRAY_CLOSE"))
                i += 2
                continue
            i += 1
        else:
            if two == "*/":
                inside, i = False, i + 2
                continue
            if two == "/*":
                # 浏览器语义：CSS 注释不可嵌套，内层 /* 前的 */ 已把注释关掉；
                # 这里显式记录「提前闭合点」，等价于原事故现场 L128/L129 那种写法。
                issues.append((line, "NESTED_EARLY_CLOSE(block@%d)" % start))
                inside, i = False, i + 2
                continue
            i += 1
    if inside:
        issues.append((line, "UNCLOSED(block@%d)" % start))
    return issues


def check_css():
    fails, total = [], 0
    for label, d in CSS_DIRS:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".css"):
                continue
            total += 1
            p = os.path.join(d, fn)
            for ln, kind in scan_comments(p):
                fails.append("[注释结构] %s:%d %s" % (label, ln, kind))
    return total, fails


def _norm_text(p):
    """按文本口径归一（行尾无关），供 HTML 双副本比对。"""
    return io.open(p, encoding="utf-8-sig", errors="replace").read().replace("\r\n", "\n").replace("\r", "\n")


def check_mirror():
    """【提示级·非门禁】server/public 是退役归档（2026-11-10 双副本消灭裁决），
       与根 public 漂移属预期，故只报不判失败。真源恒为根 public/。"""
    notes = []
    if not os.path.isdir(SRV_PUB):
        return notes
    for sub in ("css", "js"):
        d1, d2 = os.path.join(PUB, sub), os.path.join(SRV_PUB, sub)
        if not os.path.isdir(d2):
            continue
        for dirpath, _dirs, files in os.walk(d1):
            for fn in sorted(files):
                if not fn.endswith("." + sub):
                    continue
                p1 = os.path.join(dirpath, fn)
                rel = os.path.relpath(p1, d1)
                p2 = os.path.join(d2, rel)
                if not os.path.isfile(p2):
                    notes.append("[归档无此文件] server/public/%s/%s" % (sub, rel.replace("\\", "/")))
                elif hashlib.md5(open(p1, "rb").read()).digest() != hashlib.md5(open(p2, "rb").read()).digest():
                    notes.append("[归档漂移-预期] %s/%s 与根版不一致（真源=根 public）" % (sub, rel.replace("\\", "/")))
    h1, h2 = os.path.join(PUB, "index.html"), os.path.join(SRV_PUB, "index.html")
    if os.path.isfile(h1) and os.path.isfile(h2):
        if _norm_text(h1) != _norm_text(h2):
            diff = [x for x in zip(_norm_text(h1).split("\n"), _norm_text(h2).split("\n")) if x[0] != x[1]]
            notes.append("[归档漂移-预期] index.html 文本差 %d 行（真源=根 public）" % len(diff))
    return notes


if __name__ == "__main__":
    total, fails = check_css()
    notes = check_mirror() if "--sync" in sys.argv else []
    if notes:
        print("[check_css_comments] 归档提示（server/public 为退役归档，不判失败）：")
        for x in notes[:20]:
            print("  ~", x)
        if len(notes) > 20:
            print("  ~ ...（共 %d 条）" % len(notes))
    if fails:
        print("[check_css_comments] FAIL（状态机扫描 %d 个 CSS）" % total)
        for x in fails:
            print("  -", x)
        sys.exit(1)
    print("[check_css_comments] PASS（状态机扫描 %d 个 CSS，注释结构无缺陷）" % total)
