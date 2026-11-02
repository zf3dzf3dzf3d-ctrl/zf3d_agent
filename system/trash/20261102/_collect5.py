# -*- coding: utf-8 -*-
import json, urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/collect",
    data=json.dumps({"batch_id": "sw-1acfc18880", "wait": False}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
out = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_collect5.json", "w", encoding="utf-8") as f:
    f.write(out)
print("saved %d chars" % len(out))
