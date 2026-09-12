# -*- coding: utf-8 -*-
"""smart_cut 测试：多场景+语音测试视频 → analyze / highlight / remove_silence"""
import subprocess, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import smart_cut

# 生成带场景切换和声音起伏的测试视频：3 个 testsrc 场景 + 变音量正弦
subprocess.run(["ffmpeg", "-y",
  "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
  "-f", "lavfi", "-i", "smptebars=duration=3:size=320x240:rate=15",
  "-f", "lavfi", "-i", "testsrc2=duration=3:size=320x240:rate=15",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=9",
  "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v];[3:a]volume=0.1+0.3*abs(sin(t*2)):eval=frame[a]",
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "st.mp4"], capture_output=True)

a = smart_cut.analyze("st.mp4")
print("场景数:", len(a["scenes"]) if isinstance(a["scenes"], list) else a["scenes"])
print("静音段:", a["silence_segments"], "总静音:", a["silence_total_sec"])
print("响度曲线:", a["loudness_per_sec"])
h = smart_cut.highlight("st.mp4", top_n=2, window=2.0)
print("高光:", json.dumps(h, ensure_ascii=False))
d = smart_cut.remove_silence("st.mp4")
print("去静音:", json.dumps(d, ensure_ascii=False))
for f in ("st.mp4", "st_highlight.mp4", "st_nosilence.mp4"):
    if os.path.exists(f):
        print(f, os.path.getsize(f)); os.remove(f)
print("SMART CUT DONE")
