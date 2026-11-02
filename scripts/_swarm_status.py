# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error

req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/status",
    data=json.dumps({"batch_id": "sw-683c95c9c9", "wait": False}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
try:
    r = urllib.request.urlopen(req, timeout=30)
    out = r.read().decode("utf-8", "replace")
except urllib.error.HTTPError as e:
    out = "ERR %s %s" % (e.code, e.read().decode("utf-8", "replace")[:500])

b = json.loads(out).get("batch", {})
lines = ["status=%s done=%s/%s" % (b.get("status"), b.get("done_count"), len(b.get("tasks", [])))]
for t in b.get("tasks", []):
    lines.append("  %s [%s] %s" % (t.get("id"), t.get("status"), t.get("goal", "")[:40]))

with open("scripts/_swarm_status_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
