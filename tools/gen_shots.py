# -*- coding: utf-8 -*-
"""promo2 AI 镜批量生成：读 storyboard_ai.json → z_image 文生图 1280x720 → wan2.2 I2V。
用法：python gen_shots.py [镜号...]   不传镜号则跑全部。
产物：promo2/shots/shot{n}.png 底图、promo2/shots/shot{n}.mp4 视频
"""
import json, os, sys, subprocess

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(BASE, "python", "python.exe")
BRIDGE = os.path.join(BASE, "tools", "comfy_bridge.py")
SB = os.path.join(BASE, "promo2", "storyboard_ai.json")
SHOTS = os.path.join(BASE, "promo2", "shots")
os.makedirs(SHOTS, exist_ok=True)

STYLE = json.load(open(SB, encoding="utf-8"))["meta"]["style_suffix"]

def run(args):
    print(">>", " ".join(args), flush=True)
    r = subprocess.run([PY, BRIDGE] + args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout[-800:] if r.stdout else "", flush=True)
    if r.returncode != 0:
        print("STDERR:", r.stderr[-800:], flush=True)
        return False
    return "DONE:" in (r.stdout or "")

def main():
    want = set(int(a) for a in sys.argv[1:] if a.isdigit())
    shots = json.load(open(SB, encoding="utf-8"))["shots"]
    for s in shots:
        n = s["no"]
        if want and n not in want:
            continue
        png = os.path.join(SHOTS, f"shot{n}.png")
        mp4 = os.path.join(SHOTS, f"shot{n}.mp4")
        # 1) 底图
        if not os.path.exists(png):
            prompt = s["prompt"] + ", " + STYLE
            ok = run(["z_image", "--prompt", prompt,
                      "--set", "74:68.width=1280", "--set", "74:68.height=720"])
            # 取最新产物
            import glob, time as _t
            cands = sorted(glob.glob(os.path.join(BASE, "public", "data", "workbench", "comfy_*.png")), key=os.path.getmtime)
            if ok and cands:
                import shutil; shutil.copy(cands[-1], png)
                print(f"shot{n} 底图 OK -> {png}", flush=True)
            else:
                print(f"shot{n} 底图失败，跳过", flush=True); continue
        # 2) I2V，≤7s
        if not os.path.exists(mp4):
            frames = min(s["frames"], 112)  # 7s @16fps
            ok = run(["i2v_wan",
                      "--image", "53", png,
                      "--prompt", f'{s["name"]}。{s["motion"]}。全程{min(s["sec"],7)}秒，16:9横幅。',
                      "--set", "77:54.width=1280", "--set", "77:54.height=720",
                      "--set", f"77:54.length={frames}"])
            import glob
            cands = sorted(glob.glob(os.path.join(BASE, "public", "data", "workbench", "comfy_*.mp4")), key=os.path.getmtime)
            if ok and cands:
                import shutil; shutil.copy(cands[-1], mp4)
                print(f"shot{n} 视频 OK -> {mp4}", flush=True)
            else:
                print(f"shot{n} 视频失败", flush=True)

if __name__ == "__main__":
    main()
