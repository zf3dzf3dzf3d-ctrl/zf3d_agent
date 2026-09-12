# -*- coding: utf-8 -*-
"""auto_produce 端到端测试：两段文案 + 素材(1视频+1图片) + BGM → 成片"""
import subprocess, sys, os, json, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import auto_produce

wd = os.path.abspath("_test_produce")
os.makedirs(wd, exist_ok=True)
# 素材：一个视频片段 + 一张图
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=10:size=540x960:rate=25",
                "-c:v", "libx264", os.path.join(wd, "mat1.mp4")], capture_output=True)
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "smptebars=size=720x480",
                "-frames:v", "1", os.path.join(wd, "mat2.png")], capture_output=True)
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=30",
                os.path.join(wd, "bgm.mp3")], capture_output=True)

script = [
    {"text": "欢迎来到朱峰社区智能体教学。", "clip": os.path.join(wd, "mat1.mp4")},
    {"text": "今天讲自动成片流水线的使用方法。", "clip": os.path.join(wd, "mat2.png")},
]
r = auto_produce.produce(script, os.path.join(wd, "final.mp4"),
                         bgm=os.path.join(wd, "bgm.mp3"), size=(540, 960))
print(json.dumps(r, ensure_ascii=False, indent=2))
info = __import__("video_tools").probe(r["output"])
print("成片:", info["duration"], "秒,", info["video"]["width"], "x", info["video"]["height"])
shutil.rmtree(wd, ignore_errors=True)
print("PRODUCE DONE")
