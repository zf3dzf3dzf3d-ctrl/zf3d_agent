# -*- coding: utf-8 -*-
"""步骤3：根据 parts.json 生成骨骼层级 skeleton.json（Spine 风格：bones + slots + skins）。"""
import sys, os, json

BONES = [
    {"name": "root",   "parent": None},
    {"name": "hips",   "parent": "root"},
    {"name": "spine",  "parent": "hips"},
    {"name": "head",   "parent": "spine"},
    {"name": "arm_l",  "parent": "spine"},
    {"name": "arm_r",  "parent": "spine"},
    {"name": "leg_l",  "parent": "hips"},
    {"name": "leg_r",  "parent": "hips"},
]

def build_rig(parts_json, out):
    meta = json.load(open(parts_json, encoding="utf-8"))
    slots = []
    for part in ["leg_l", "leg_r", "arm_l", "arm_r", "torso", "head"]:
        p = meta["parts"].get(part)
        if not p:
            continue
        slots.append({"name": part, "bone": part, "attachment": part + ".png",
                      "pivot": p["pivot"], "box": p["box"]})
    skel = {"skeleton": {"name": "auto_rig", "format": "zf-1.0"},
            "bones": BONES, "slots": slots}
    json.dump(skel, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("skeleton ->", out)

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pj = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "output", "parts", "parts.json")
    out = os.path.join(root, "output", "skeleton.json")
    build_rig(pj, out)
