# -*- coding: utf-8 -*-
"""video_edit 工具后端端到端测试（模拟智能体调用）"""
import sys, os, json, shutil, subprocess
ROOT = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2"
sys.path.insert(0, os.path.join(ROOT, "tools", "minimal", "backend"))
sys.path.insert(0, os.path.join(ROOT, "server", "video"))
os.chdir(os.path.join(ROOT, "server", "video"))

import video_edit

sent = []
class Ctx:
    def send_json(self, d): sent.append(d)

wd = os.path.abspath("_test_tool")
os.makedirs(wd, exist_ok=True)
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=15",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", os.path.join(wd, "v.mp4")],
               capture_output=True)
F = os.path.join(wd, "v.mp4")

def call(**body):
    sent.clear()
    body.setdefault("file", F)
    video_edit.handle(body, Ctx())
    r = sent[0]
    return r

print("info:", call(action="info")["ok"])
print("cut:", call(action="cut", start=0.5, end=2.0, out=os.path.join(wd, "c.mp4"))["ok"])
print("concat:", call(action="concat", files=[os.path.join(wd,"c.mp4"), os.path.join(wd,"c.mp4")],
                      out=os.path.join(wd, "cc.mp4"))["ok"])
print("analyze:", call(action="analyze", compact=True)["ok"])
print("speed:", call(action="speed", factor=2.0, out=os.path.join(wd, "s.mp4"))["ok"])
print("text:", call(action="text", text="测试水印", out=os.path.join(wd, "t.mp4"))["ok"])
print("shot:", call(action="shot", at=1, out=os.path.join(wd, "p.jpg"))["ok"])
print("gif:", call(action="gif", duration=2, out=os.path.join(wd, "g.gif"))["ok"])
# produce：文案换行分段 + 素材（media.js 风格）
print("produce:", json.dumps({k: v for k, v in call(
    action="produce",
    text="第一条口播文案。\n第二条口播文案。",
    materials=[F],
    out=os.path.join(wd, "final.mp4"),
    size=[540, 960]).items() if k != "segments"}, ensure_ascii=False))
print("produce 文件存在:", os.path.exists(os.path.join(wd, "final.mp4")))
# 错误路径
print("err(无文件):", call(action="info", file="不存在.mp4").get("ok") is False)
shutil.rmtree(wd, ignore_errors=True)
print("TOOL E2E DONE")
