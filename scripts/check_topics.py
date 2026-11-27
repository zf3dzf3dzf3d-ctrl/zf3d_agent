# -*- coding: utf-8 -*-
"""check_topics.py 课题池巡检脚本 v2（达标触发自动化，纯标准库）
用法: python\\python.exe -X utf8 scripts\\check_topics.py [--no-encoding]
规则: 提取每课题「复现次数: N」，N>=3 或标注「静态缺陷」即输出达标清单
格式兼容: 同时支持「### N 标题」块 与 「- 课题：...」/「**课题：...」行式条目（2026-11-10 v2 修复解析失明）
退出码: 0=无达标 1=有达标课题 3=解析到0条但文件含课题关键词（巡检失明自检,禁止静默通过）
接线: 默认末尾附带运行 tools/check_encoding.py 编码门禁（--no-encoding 跳过），其非0退出码会传导为总退出码
v3(2026-11-10 第4轮): 解析数自检加独立双口径交叉校验（A列表项 vs C任意行，不一致即告警）；
     课题池写规程：append-only 追加 + 写后回读字节数确认（写规程固化，防多窗静默分裂）
"""
import os, re, sys, datetime, subprocess

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL = os.path.join(ROOT, "private", "记忆", "全局", "进化", "课题池.md")
ENC = os.path.join(ROOT, "tools", "check_encoding.py")
GATE = 3  # 课题池闸门：复现 >=3 次达标

def parse_topics(text):
    """兼容两种格式，返回 [(编号或序号, 标题, 复现次数, 是否静态缺陷)]"""
    topics = []
    # 格式A: ### N 标题块
    blocks = re.split(r"(?=^###\s*\d+)", text, flags=re.M)
    for b in blocks:
        m = re.match(r"^###\s*(\d+)[^\n]*", b)
        if not m:
            continue
        title = m.group(0).lstrip("# ").strip()
        cnt = re.search(r"复现次数[:：]\s*(\d+)", b)
        sd = bool(re.search(r"静态(?:结构性)?缺陷", b))
        topics.append((m.group(1), title, int(cnt.group(1)) if cnt else 0, sd))
    # 格式B: 行式条目「- 课题：」或「**课题：」或「1. **课题：」
    seen = {t[0] for t in topics}
    idx = 0
    for line in text.splitlines():
        m = re.search(r"课题[:：]\s*(.+?)(?:｜|$)", line)
        if not m:
            continue
        idx += 1
        key = f"L{idx}"
        if key in seen:
            continue
        cnt = re.search(r"复现次数[:：]\s*(\d+)", line)
        sd = bool(re.search(r"静态(?:结构性)?缺陷", line))
        topics.append((key, m.group(1).strip()[:60], int(cnt.group(1)) if cnt else 0, sd))
    return topics

def main():
    skip_enc = "--no-encoding" in sys.argv
    if not os.path.exists(POOL):
        print(f"[FAIL] 课题池路径不存在: {POOL}（巡检脚本自身配置错误）")
        return 1
    with open(POOL, encoding="utf-8", errors="replace") as f:
        text = f.read()
    topics = parse_topics(text)
    # v3 交叉校验：解析数与独立口径（含"课题："的行数）比对，不一致说明正则漏抓/重抓
    c_lines = sum(1 for line in text.splitlines() if '课题：' in line or '课题:' in line)
    if len(topics) != c_lines:
        print(f"[WARN] 交叉校验不一致: 解析器={len(topics)} vs 独立口径(含'课题：'的行)={c_lines} —— 正则可能漏抓或重抓，需人工核对")
    # 自检门槛：解析到 0 条但文件确实在谈课题 = 巡检失明，必须报错
    if not topics and re.search(r"课题", text):
        print(f"[FAIL] 巡检解析到 0 条课题，但课题池含课题关键词 —— 格式失配或解析器坏，禁止静默通过")
        return 3
    hits = [(no, t, f"复现{n}次>=闸门{GATE}" if n >= GATE else "静态结构性缺陷(按证据量直接治理)")
            for (no, t, n, sd) in topics if sd or n >= GATE]
    ts = datetime.datetime.now()
    print(f"课题池巡检 {ts:%Y-%m-%d %H:%M:%S}  闸门: 复现>={GATE} 或 静态缺陷  解析课题数: {len(topics)}")
    rc = 0
    if hits:
        print(f"\n达标课题 {len(hits)} 个（应进入治理流程）:")
        for no, title, reason in hits:
            print(f"  - 课题{no} {title}  [{reason}]")
        rc = 1
    else:
        print(f"无达标课题（共解析 {len(topics)} 条）。")
    # 接线编码门禁
    if not skip_enc and os.path.exists(ENC):
        print("\n-- 编码门禁 check_encoding --")
        r = subprocess.run([sys.executable, "-X", "utf8", ENC], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        tail = (r.stdout or "").strip().splitlines()[-3:]
        for ln in tail:
            print("  " + ln)
        if r.returncode not in (0,):
            print(f"  [门禁FAIL] check_encoding 退出码 {r.returncode}，问题未归零")
            rc = max(rc, 2)
    return rc

if __name__ == "__main__":
    sys.exit(main())
