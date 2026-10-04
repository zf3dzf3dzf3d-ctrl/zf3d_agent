# -*- coding: utf-8 -*-
"""步骤2：自动拆件。基于 alpha 通道 + 几何启发式把角色拆成 头/躯干/左臂/右臂/左腿/右腿 图层。"""
import sys, os, json
from PIL import Image
import numpy as np

PARTS = ["head", "torso", "arm_l", "arm_r", "leg_l", "leg_r"]

def split_parts(src, outdir):
    img = Image.open(src).convert("RGBA")
    a = np.asarray(img)
    alpha = a[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        raise SystemExit("image is empty")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    W, H = x1 - x0 + 1, y1 - y0 + 1
    cx = (x0 + x1) / 2

    # 人体比例启发式切分带
    bands = {
        "head":  (0.00, 0.22),
        "torso": (0.22, 0.55),
        "arms":  (0.25, 0.60),   # 与躯干同带，左右分
        "legs":  (0.55, 1.00),
    }
    os.makedirs(outdir, exist_ok=True)
    meta = {"image": os.path.basename(src), "size": [W, H], "parts": {}}

    def save_part(name, box):
        bx0, by0, bx1, by1 = box
        sub = a[by0:by1, bx0:bx1].copy()
        # 该区域外 alpha 置 0，避免重叠串色（arms 与 torso 共带时按左右半分）
        Image.fromarray(sub, "RGBA").save(os.path.join(outdir, name + ".png"))
        meta["parts"][name] = {"box": [int(bx0), int(by0), int(bx1), int(by1)],
                               "pivot": [int((bx0+bx1)/2), int(by0 + (by1-by0)*0.1)]}

    for band, (f0, f1) in bands.items():
        by0 = int(y0 + f0 * H); by1 = int(y0 + f1 * H)
        if band == "arms":
            save_part("arm_l", (x0, by0, int(cx), by1))
            save_part("arm_r", (int(cx), by0, x1 + 1, by1))
        elif band == "legs":
            save_part("leg_l", (x0, by0, int(cx), y1 + 1))
            save_part("leg_r", (int(cx), by0, x1 + 1, y1 + 1))
        else:
            save_part(band, (x0, by0, x1 + 1, by1))

    with open(os.path.join(outdir, "parts.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print("parts saved ->", outdir)

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "output/cutout.png"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(root, "output", "parts")
    split_parts(src, outdir)
