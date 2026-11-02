# -*- coding: utf-8 -*-
import sys, os, json

BASE_DIR = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server"
sys.path.insert(0, BASE_DIR)
import model_config as mc

cfg = mc.load_models_config(include_key=False)
lines = []
for m in cfg.get("list", []):
    lines.append("%s | modelId=%s | baseUrl=%s | usable=%s" % (
        m.get("name"), m.get("modelId"), m.get("baseUrl") or m.get("baseURL"), m.get("enabled", m.get("usable", "?"))))
d = mc.get_default_model()
lines.append("DEFAULT: %s" % ((d or {}).get("name")))

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_mcfg_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("done")
