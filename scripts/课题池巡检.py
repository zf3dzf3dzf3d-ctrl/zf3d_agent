# -*- coding: utf-8 -*-
"""课题池达标巡检脚本（课题11 落地）
扫描课题池 markdown，regex 提取各课题「复现次数: N」与静态缺陷标记，
N>=3 或「静态缺陷」即判定达标，输出达标清单。纯标准库，-X utf8 运行。
用法: pythonw.exe -X utf8 scripts/课题池巡检.py [课题池路径]
"""
import io
import re
import sys
from pathlib import Path

DEFAULT_POOL = Path(__file__).resolve().parent.parent / "private" / "记忆" / "全局" / "进化" / "课题池.md"
NUM_RE = re.compile(r"复现次数[:：]\s*(≥?\s*\d+)")
STATIC_RE = re.compile(r"静态缺陷|静态结构性缺陷")


def parse_num(text: str):
    m = NUM_RE.search(text)
    if not m:
        return None
    return int(m.group(1).replace("≥", "").strip())


def inspect(pool_path: Path):
    if not pool_path.exists():
        print(f"[FAIL] 课题池不存在: {pool_path}")
        return 1
    content = pool_path.read_text(encoding="utf-8-sig")
    headers = re.findall(r"^(###\s*.+|- \[[^\]]+\]\s*复现次数.+)$", content, re.M)
    reached = []
    for line in headers:
        n = parse_num(line)
        static = bool(STATIC_RE.search(line))
        if (n is not None and n >= 3) or static:
            reached.append((line.strip(), n, static))
    # 自检：编号重复=撞号复发（课题10 复查）
    ids = re.findall(r"^###\s*(\d+)\.", content, re.M)
    dup = {i for i in ids if ids.count(i) > 1}
    print(f"[课题池巡检] {pool_path}")
    print(f"  课题标题数: {len(headers)} | 编号重复: {sorted(dup) if dup else '无'}")
    if reached:
        print(f"  ⚠ 达标课题 {len(reached)} 项（应触发 P2 立项/提请授权）:")
        for title, n, static in reached:
            tag = f"复现{n}" if n else "静态缺陷"
            print(f"   - {title}  [{tag}]")
    else:
        print("  ✓ 无达标课题")
    if dup:
        print("  ⚠ 编号撞号复发，触发课题10 整改")
        return 2
    return 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_POOL
    sys.exit(inspect(target))
