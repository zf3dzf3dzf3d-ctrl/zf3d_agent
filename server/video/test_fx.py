# -*- coding: utf-8 -*-
"""test_fx.py - fx_cut 新功能实测：转场/淡入淡出/卡点"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fx_cut

OK = True


def check(name, r, outfile=None):
    global OK
    good = r.get('ok') and (outfile is None or (os.path.exists(outfile) and os.path.getsize(outfile) > 10000))
    print(f"[{'PASS' if good else 'FAIL'}] {name}: {r if not good else outfile}")
    if not good:
        OK = False


D = os.path.dirname(os.path.abspath(__file__))

# 造两个测试片段 + 一段BGM（正弦音）
import subprocess
def mk_test(p, color, dur=3, freq=440):
    subprocess.run(['ffmpeg', '-y', '-f', 'lavfi',
                    f'-i', f'color=c={color}:s=640x360:d={dur}:r=30',
                    '-f', 'lavfi', '-i', f'sine=frequency={freq}:duration={dur}',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', p],
                   capture_output=True)

a = os.path.join(D, 'fx_a.mp4'); b = os.path.join(D, 'fx_b.mp4')
bgm = os.path.join(D, 'fx_bgm.mp3')
mk_test(a, 'red', freq=300)
mk_test(b, 'blue', freq=600)
subprocess.run(['ffmpeg', '-y', '-f', 'lavfi',
                '-i', 'sine=frequency=200:duration=12',
                '-af', 'volume=1.0', '-b:a', '128k', bgm], capture_output=True)

out1 = os.path.join(D, 'fx_xfade_out.mp4')
check('xfade 转场', fx_cut.add_transition(a, b, out1, kind='circleopen'), out1)

out2 = os.path.join(D, 'fx_fade_out.mp4')
check('淡入淡出', fx_cut.fade_in_out(a, out2), out2)

beats = fx_cut.detect_beats(bgm)
print(f"[INFO] 节拍检测: {len(beats)} 个点 (纯音BGM可能少，正常)")

out3 = os.path.join(D, 'fx_beat_out.mp4')
check('卡点视频', fx_cut.beat_sync([a, b], bgm, out3, max_out=10), out3)

print('\n=== ALL PASS ===' if OK else '\n=== SOME FAILED ===')
sys.exit(0 if OK else 1)
