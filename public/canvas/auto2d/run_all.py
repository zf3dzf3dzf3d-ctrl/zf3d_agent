# -*- coding: utf-8 -*-
"""一键全链路：抠背景 -> 拆件 -> 生成骨骼锚点
用法: python run_all.py [输入图片路径，默认 char_raw.png]
产物: char_cut.png / parts/*.png + parts.json / rig.json
查看: http://localhost:8512/auto2d/index.html  和  /auto2d/rigged.html
"""
import subprocess, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "char_raw.png")
PY = sys.executable

steps = [
    [PY, os.path.join(HERE, "cutout.py"), SRC],
    [PY, os.path.join(HERE, "split_parts.py")],
    [PY, os.path.join(HERE, "make_rig.py")],
]
for cmd in steps:
    print(">>", " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd)))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        sys.exit("步骤失败: " + cmd[1])
print("\n全部完成: char_cut.png + parts/ + rig.json")
