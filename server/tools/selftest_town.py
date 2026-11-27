# -*- coding: utf-8 -*-
"""selftest_town.py - i小镇通电探针（无限画布·i小镇域）
验收三证：events.jsonl 存在 + /api/town/state ok=true + /api/town/events 可访问
全部逻辑在 UTF-8 Python 内完成，规避 cmd 中文路径编码死结。
退出码：0=PASS 1=FAIL
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # server/
ROOT = os.path.dirname(ROOT)  # 项目根
EV = os.path.join(ROOT, "private", "记忆", "小镇", "events.jsonl")
BASE = "http://127.0.0.1:8620"
PASS = True

print("[1/3] events.jsonl check")
if os.path.isfile(EV):
    with open(EV, "rb") as f:
        lines = sum(1 for _ in f)
    print(f"  FOUND: {EV}")
    print(f"  lines={lines}")
else:
    print(f"  MISSING: {EV}")
    PASS = False

print("[2/3] GET /api/town/state")
try:
    with urllib.request.urlopen(BASE + "/api/town/state", timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    if data.get("ok") is True:
        print("  state OK")
    else:
        print(f"  state FAIL: ok={data.get('ok')}")
        PASS = False
except Exception as e:
    print(f"  state FAIL: {e}")
    PASS = False

print("[3/3] GET /api/town/events")
try:
    with urllib.request.urlopen(BASE + "/api/town/events", timeout=10) as r:
        code = r.status
    print(f"  http={code}")
    if code != 200:
        PASS = False
except Exception as e:
    print(f"  events FAIL: {e}")
    PASS = False

print("TOWN SELFTEST: PASS" if PASS else "TOWN SELFTEST: FAIL")
sys.exit(0 if PASS else 1)
