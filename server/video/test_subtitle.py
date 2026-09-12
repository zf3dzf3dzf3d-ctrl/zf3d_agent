# -*- coding: utf-8 -*-
"""subtitle_ai 测试：edge-tts 生成中文语音 → 合成视频 → Whisper 转写 → 烧录"""
import subprocess, sys, os, json, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import edge_tts, subtitle_ai

TEXT = "大家好，欢迎来到朱峰社区，今天我们来学习视频剪辑功能。"

async def make_voice():
    c = edge_tts.Communicate(TEXT, "zh-CN-XiaoxiaoNeural")
    await c.save("tts.mp3")

asyncio.run(make_voice())
# 语音 + 测试画面 → mp4
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=640x360:rate=15",
                "-i", "tts.mp3", "-shortest", "-c:v", "libx264", "-c:a", "aac", "vtest.mp4"],
               capture_output=True)
r = subtitle_ai.transcribe("vtest.mp4", size="small", language="zh")
print(json.dumps({k: v for k, v in r.items() if k != "segments"}, ensure_ascii=False))
for s in r["segments"]:
    print(f"[{s['start']}-{s['end']}] {s['text']}")
print("SRT 内容：")
print(open(r["srt"], encoding="utf-8").read())
r2 = subtitle_ai.transcribe_and_burn("vtest.mp4", size="small", language="zh")
print("烧录输出:", r2["output"], "存在:", os.path.exists(r2["output"]), "大小:", os.path.getsize(r2["output"]))
# 清理
for f in ("tts.mp3", "vtest.mp4", "vtest.srt", "vtest_subbed.mp4"):
    if os.path.exists(f): os.remove(f)
print("SUBTITLE TEST DONE")
