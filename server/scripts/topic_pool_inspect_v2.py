# -*- coding: utf-8 -*-
"""Topic pool inspector v2. Fix: 0-parsed-topics must fail (exit 3); parse real
format "- topic: ... | recurrence: N"; chain tools/check_encoding.py gate.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_POOL = ROOT / "private" / "记忆" / "全局" / "进化" / "课题池.md"
NUM_RE = re.compile(r"复现次数[:：]\s*(≥?\s*\d+)")
STATIC_RE = re.compile(r"静态缺陷|静态结构性缺陷")
ENTRY_SPLIT = re.compile(r"(?=##\s|- \*\*?课题|- 课题)")


def inspect(pool_path: Path):
    if not pool_path.exists():
        print("[FAIL] no pool: %s" % pool_path)
        return 1
    content = pool_path.read_text(encoding="utf-8-sig")
    chunks = [c for c in ENTRY_SPLIT.split(content) if c]
    reached, parsed = [], 0
    for chunk in chunks:
        if "课题" not in chunk:
            continue
        for line in chunk.splitlines():
            if "课题" not in line:
                continue
            m = NUM_RE.search(line)
            if m is None and not STATIC_RE.search(line):
                continue
            parsed += 1
            n = int(m.group(1).replace("≥", "").strip()) if m else None
            static = bool(STATIC_RE.search(line))
            if (n is not None and n >= 3) or static:
                reached.append((line.strip()[:80], n, static))
    ids = re.findall(r"^###\s*(\d+)\.", content, re.M)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if parsed == 0:
        print("[FAIL] parsed 0 topics (format mismatch) -> exit 3")
        return 3
    print("[inspect] %s" % pool_path)
    print("  topics parsed: %d | dup ids: %s" % (parsed, dup if dup else "none"))
    if reached:
        print("  WARN %d reached (trigger P2):" % len(reached))
        for title, n, static in reached:
            print("   - %s [%s]" % (title, ("n=%d" % n) if n else "static"))
    else:
        print("  OK: no reached topics")
    if dup:
        print("  WARN dup ids, trigger topic10")
        return 2
    return 0


def run_encoding_check():
    tool = ROOT / "tools" / "check_encoding.py"
    if not tool.exists():
        print("[FAIL] missing tools/check_encoding.py")
        return 1
    r = subprocess.run([sys.executable, "-X", "utf8", str(tool)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    tail = "\n".join(out.splitlines()[-5:]) if out else "(no output)"
    print("[encoding check] exit=%d" % r.returncode)
    print("  " + tail.replace("\n", "\n  "))
    return r.returncode


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_enc = "--no-encoding" in sys.argv
    target = Path(args[0]) if args else DEFAULT_POOL
    rc = inspect(target)
    if not no_enc:
        rc_enc = run_encoding_check()
        if rc == 0:
            rc = rc_enc
    sys.exit(rc)
