# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error

# 1) 拉可用模型列表
try:
    r = urllib.request.urlopen("http://127.0.0.1:8580/api/models", timeout=20)
    models_raw = r.read().decode("utf-8", "replace")
except urllib.error.HTTPError as e:
    models_raw = "ERR %s %s" % (e.code, e.read().decode("utf-8", "replace")[:300])

with open("scripts/_models_out.txt", "w", encoding="utf-8") as f:
    f.write(models_raw[:3000])
print("done")
