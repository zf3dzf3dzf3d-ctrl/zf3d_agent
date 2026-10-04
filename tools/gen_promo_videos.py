# -*- coding: utf-8 -*-
"""批量生成宣传片 9 镜视频：等待队列完成后逐镜提交（wan2.2 I2V, 1280x720, <=7s）"""
import json, os, subprocess, sys, time, urllib.request

PY = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.4.5\python\python.exe"
BRIDGE = r"tools\comfy_bridge.py"
API = "http://127.0.0.1:8188"
OUT = r"promo2\videos"
os.makedirs(OUT, exist_ok=True)

SB = json.load(open("promo2/storyboard_ai.json", encoding="utf-8"))
WF = "wan2.2图生视频"

def wait_idle():
    while True:
        try:
            q = json.loads(urllib.request.urlopen(API + "/queue", timeout=15).read())
            if not q["queue_running"] and not q["queue_pending"]:
                return
        except Exception:
            pass
        time.sleep(10)

# 只生成 1-8 镜（第9镜 LOGO 定版用后期）
for s in SB["shots"]:
    if s["no"] > 8:
        continue
    img = os.path.join("promo2", "shots", "shot%d.png" % s["no"])
    if not os.path.exists(img):
        print("缺底图", img, "跳过"); continue
    prompt = s["prompt"] + " Motion: " + s["motion"] + ". " + SB["meta"]["style_suffix"]
    frames = min(s["sec"] * 16, 112)  # <=7s @16fps
    cmd = [PY, BRIDGE, WF, "--prompt", prompt,
           "--image", "53", img,
           "--set", "77:54.width=1280", "--set", "77:54.height=720",
           "--set", "77:54.length=%d" % frames, "--set", "77:38.fps=16"]
    print("=== shot", s["no"], s["name"], frames, "frames", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout + r.stderr)[-400:]
    print(out, flush=True)
    # 收割：bridge 把成品放 data/workbench/comfy_*.mp4，挪进 promo2/videos
    if "DONE" in out:
        wait_idle()
    time.sleep(3)

print("ALL DONE")
