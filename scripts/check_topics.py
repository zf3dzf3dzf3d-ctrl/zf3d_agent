# -*- coding: utf-8 -*-
"""check_topics.py 课题池巡检脚本（达标触发自动化，纯标准库）
用法: python\\python.exe -X utf8 scripts\\check_topics.py
规则: 提取每课题「复现次数: N」，N>=3 或标注「静态缺陷」即输出达标清单
退出码: 0=无达标 1=有达标课题（可供告警/CI 使用）
"""
import os, re, sys, datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL = os.path.join(ROOT, "private", "记忆", "全局", "进化", "课题池.md")
GATE = 3  # 课题池闸门：复现 >=3 次达标

def main():
    if not os.path.exists(POOL):
        print(f"[FAIL] 课题池路径不存在: {POOL}（巡检脚本自身配置错误）")
        return 1
    with open(POOL, encoding="utf-8", errors="replace") as f:
        text = f.read()
    # 按 ### N 标题切分课题块
    blocks = re.split(r"(?=^###\s*\d+)", text, flags=re.M)
    hits = []
    for b in blocks:
        m = re.match(r"^###\s*(\d+)[^\n]*", b)
        if not m:
            continue
        no = m.group(1)
        title = (re.search(r"^###\s*\d+[^\n]*", b).group(0)).lstrip("# ").strip()
        cnt = re.search(r"复现次数[:：]\s*(\d+)", b)
        static_defect = bool(re.search(r"静态(?:结构性)?缺陷", b))
        n = int(cnt.group(1)) if cnt else 0
        if static_defect or n >= GATE:
            reason = f"复现{n}次>=闸门{GATE}" if n >= GATE else "静态结构性缺陷(按证据量直接治理)"
            hits.append((no, title, reason))
    ts = datetime.datetime.now()
    print(f"课题池巡检 {ts:%Y-%m-%d %H:%M:%S}  闸门: 复现>={GATE} 或 静态缺陷")
    if hits:
        print(f"\n达标课题 {len(hits)} 个（应进入治理流程）:")
        for no, title, reason in hits:
            print(f"  - 课题{no} {title}  [{reason}]")
        return 1
    print("无达标课题。")
    return 0

if __name__ == "__main__":
    sys.exit(main())
