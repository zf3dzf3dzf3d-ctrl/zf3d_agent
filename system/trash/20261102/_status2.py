# -*- coding: utf-8 -*-
import json, urllib.request

lines = []
for bid in ["sw-683c95c9c9", "sw-78a51e036a"]:
    req = urllib.request.Request(
        "http://127.0.0.1:8580/api/swarm/status",
        data=json.dumps({"batch_id": bid, "wait": False}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    b = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")).get("batch", {})
    from collections import Counter
    c = Counter(t["status"] for t in b.get("tasks", []))
    lines.append(bid + " " + json.dumps(dict(c), ensure_ascii=False))

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_status2.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
