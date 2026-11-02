# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error, sys

body = {"tasks": ["测试任务"], "context": "test"}
req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/submit",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
try:
    r = urllib.request.urlopen(req, timeout=60)
    out = "CODE %s\n%s" % (r.status, r.read().decode("utf-8", "replace")[:800])
except urllib.error.HTTPError as e:
    out = "ERR %s\n%s" % (e.code, e.read().decode("utf-8", "replace")[:800])

with open("scripts/_swarm_probe_out.txt", "w", encoding="utf-8") as f:
    f.write(out)
print("done")
