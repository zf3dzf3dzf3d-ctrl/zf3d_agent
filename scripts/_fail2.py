# -*- coding: utf-8 -*-
import json, urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/status",
    data=json.dumps({"batch_id": "sw-78a51e036a", "wait": False}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
out = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
b = json.loads(out).get("batch", {})
lines = []
for t in b.get("tasks", []):
    if t.get("status") == "failed":
        lines.append("== %s ==\n%s\n" % (t.get("id"), str(t.get("output") or "")[:600]))

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_fail2.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) or "no output")
print("done")
