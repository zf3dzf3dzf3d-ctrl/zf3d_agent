# -*- coding: utf-8 -*-
"""smart_edit 测试：生成多场景测试视频（拼接3段不同画面+语音）→ 分析/高光/粗剪"""
import subprocess, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import smart_edit as se

# 三段不同场景测试视频（颜色+文字不同，可触发场景检测）
COLORS = ["red", "blue", "green"]
parts = []
for i, c in enumerate(COLORS, 1):
    p = f"seg{i}.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi",
                    "-i", f"color={c}:size=640x360:duration=4:rate=15",
                    "-vf", f"drawtext=text='Scene {i}':fontsize=48:fontcolor=white:x=200:y=150",
                    "-c:v", "libx264", p], capture_output=True)
    parts.append(p)
subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.lst", "-c", "copy", "multi.mp4"],
               capture_output=True) if False else None
with open("concat.lst", "w") as f:
    for p in parts:
        f.write(f"file '{p}'\n")
subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", "concat.lst", "-c", "copy", "multi.mp4"],
               capture_output=True)

print("== analyze ==")
r = se.analyze("multi.mp4")
print(json.dumps({k: v for k, v in r.items() if k != "loudness_curve"}, ensure_ascii=False))

print("== highlights ==")
r2 = se.highlights("multi.mp4", top_n=2)
print(json.dumps(r2, ensure_ascii=False))

print("== extract ==")
r3 = se.extract_highlight("multi.mp4", top_n=2)
print(json.dumps(r3, ensure_ascii=False))

print("== roughcut ==")
r4 = se.rough_cut("multi.mp4")
print(json.dumps(r4, ensure_ascii=False))

ok = r["scene_count"] >= 2 and r3["exists"] and r4["exists"]
for f in ("seg1.mp4", "seg2.mp4", "seg3.mp4", "multi.mp4", "multi_roughcut.mp4", "concat.lst"):
    if os.path.exists(f): os.remove(f)
print("SMART_EDIT", "PASS" if ok else "FAIL")
