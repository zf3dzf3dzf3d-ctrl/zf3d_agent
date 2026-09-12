# -*- coding: utf-8 -*-
"""一键运行完整管线：抠图 -> 拆件 -> 骨架 -> 动画。
用法: python run_all.py [输入图片] [输出目录]
"""
import sys, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

def run(script, *args):
    print("==>", script, *args)
    r = subprocess.run([PY, os.path.join(HERE, script), *args], cwd=os.path.dirname(HERE))
    if r.returncode != 0:
        raise SystemExit(script + " failed")

if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "assets", "input.png")
    root = os.path.dirname(HERE)
    cutout = os.path.join(root, "output", "cutout.png")
    run("cutout.py", src)
    run("split_parts.py", cutout)
    run("build_rig.py")
    run("build_anim.py")
    print("\n全部完成。用浏览器打开 output/viewer.html 查看骨骼动画。")
