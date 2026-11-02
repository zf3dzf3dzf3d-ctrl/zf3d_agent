# -*- coding: utf-8 -*-
import sys

BASE = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server"
sys.path.insert(0, BASE)
import model_config as mc

lines = []
try:
    cfg = mc.load_models_config(include_key=False)
    for m in cfg.get("list", []):
        lines.append("%s | %s | %s" % (m.get("name"), m.get("modelId"), m.get("baseUrl") or m.get("baseURL")))
except Exception as e:
    lines.append("ERR %r" % e)

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_m2.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
