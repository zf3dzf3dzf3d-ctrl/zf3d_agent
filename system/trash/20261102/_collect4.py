# -*- coding: utf-8 -*-
import json, urllib.request, time

# 等待智谱批次完成并收取结果
deadline = time.time() + 420
bid = "sw-1acfc18880"
b = None
while time.time() < deadline:
    req = urllib.request.Request(
        "http://127.0.0.1:8580/api/swarm/status",
        data=json.dumps({"batch_id": bid, "wait": False}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    b = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")).get("batch", {})
    sts = [t["status"] for t in b.get("tasks", [])]
    if all(s in ("done", "failed") for s in sts):
        break
    time.sleep(20)

lines = []
from collections import Counter
lines.append(json.dumps(dict(Counter(t["status"] for t in b.get("tasks", []))), ensure_ascii=False))
for t in b.get("tasks", []):
    lines.append("\n===== %s [%s] %s =====" % (t.get("id"), t.get("status"), t.get("goal", "")[:50]))
    lines.append(str(t.get("output") or "")[:3000])

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_collect4.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
