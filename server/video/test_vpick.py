# -*- coding: utf-8 -*-
import sys, os, json, traceback
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import vision_pick as vp

out = {}
# 1) 固定 fps=0.5
try:
    out['fixed'] = vp.vision_pick(os.path.join(os.path.dirname(__file__), 'vpick_test.mp4'),
                                  fps=0.5, top_ratio=0.4)
except Exception:
    out['fixed'] = traceback.format_exc()

# 2) auto 模式（大模型自己定抽帧密度）
try:
    out['auto'] = vp.vision_pick(os.path.join(os.path.dirname(__file__), 'vpick_test.mp4'),
                                 fps='auto', top_ratio=0.4, max_frames=8)
except Exception:
    out['auto'] = traceback.format_exc()

with open(os.path.join(os.path.dirname(__file__), 'vpick_result.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print('RESULT_SAVED')
