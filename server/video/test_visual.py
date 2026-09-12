# -*- coding: utf-8 -*-
"""test_visual.py - 多模态选片实测"""
import sys, os, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import visual_score as vs

OK = True
def check(name, cond, extra=''):
    global OK
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond: OK = False

D = os.path.dirname(os.path.abspath(__file__))
# 造测试视频：前段静止纯色，后段高频运动画面 + 声音
src = os.path.join(D, 'vis_test.mp4')
subprocess.run(['ffmpeg', '-y',
                '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:d=3:r=15',
                '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=3:r=15',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
                '-filter_complex',
                '[0:v][1:v]concat=n=2:v=1:a=0[outv];[2:a]atrim=duration=6[a]',
                '-map', '[outv]', '-map', '[a]',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', src],
               capture_output=True)
check('测试视频生成', os.path.exists(src))

scores, fps = vs.visual_scores(src)
check('视觉打分输出', len(scores) > 0, f'({len(scores)} 帧)')
# 后半段(运动)分数应高于前半段(静止)
half = len(scores) // 2
check('运动段分数更高', sum(scores[half:]) / max(1, len(scores[half:])) > sum(scores[:half]) / max(1, len(scores[:half])),
      f"({sum(scores[:half])/max(1,half):.2f} vs {sum(scores[half:])/max(1,len(scores)-half):.2f})")

tops = vs.top_segments(src, top=2)
check('视觉高光片段', len(tops) > 0, str(tops))

out = os.path.join(D, 'vis_mm_out.mp4')
r = vs.multimodal_highlight(src, out, top=2, window=2.0)
check('多模态高光输出', r.get('ok') and os.path.exists(out) and os.path.getsize(out) > 10000, str(r.get('picked')))

print('\n=== ALL PASS ===' if OK else '\n=== SOME FAILED ===')
sys.exit(0 if OK else 1)
