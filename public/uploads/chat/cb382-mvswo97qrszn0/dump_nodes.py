import json, os, subprocess, sys
base = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\uploads\chat\cb382-mvswo97qrszn0"
files = ["1793283524208_MINIMAX_H3___-_______________.json", "1793283526292_YZ__-MiniMax_H3-______-___.json"]
lines = []
for f in files:
    d = json.load(open(os.path.join(base, f), encoding="utf-8"))
    lines.append("==== " + f)
    for n in d["nodes"]:
        lines.append("%s %s %s" % (n.get("id"), n.get("type"), str(n.get("widgets_values"))[:150]))
out = os.path.join(base, "nodes_dump.txt")
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("WROTE", out, os.path.getsize(out))
