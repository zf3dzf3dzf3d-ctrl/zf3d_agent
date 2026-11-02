# -*- coding: utf-8 -*-
import json, urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/status",
    data=json.dumps({"batch_id": "sw-683c95c9c9", "wait": False}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
out = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
b = json.loads(out).get("batch", {})
lines = []
for t in b.get("tasks", []):
    if t.get("status") == "failed":
        lines.append("== %s ==\n%s\n" % (t.get("id"), str(t.get("output") or t.get("error") or "")[:1200]))

with open("scripts/_swarm_fail_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) or "no fail output")
print("done")
