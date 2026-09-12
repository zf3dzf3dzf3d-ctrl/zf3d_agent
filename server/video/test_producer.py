# -*- coding: utf-8 -*-
"""auto_producer 测试：文案两段 → TTS → 成片（无素材渐变背景）"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import auto_producer as ap

TEXT = "朱峰社区智能体，一键生成视频。\n自动配音，自动字幕，自动成片。"
r = ap.complete_video_task(TEXT, dst="produce_out.mp4", width=640, height=360, font_size=20)
print(json.dumps(r, ensure_ascii=False))
ok = r["exists"] and os.path.getsize(r["output"]) > 10000
if ok: os.remove(r["output"])
print("PRODUCER", "PASS" if ok else "FAIL")
