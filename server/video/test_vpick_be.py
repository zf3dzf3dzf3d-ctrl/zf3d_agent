# -*- coding: utf-8 -*-
import sys, json, traceback, os
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2'
sys.path.insert(0, os.path.join(ROOT, 'tools', 'minimal', 'backend'))
import video_edit as ve
try:
    r = ve._dispatch('vision_pick', {'file': os.path.join(ROOT, 'server', 'video', 'vpick_test.mp4'),
                                     'fps': 1, 'top_ratio': 0.5})
except Exception:
    r = {'err': traceback.format_exc()}
with open(os.path.join(ROOT, 'server', 'video', 'vpick_be.json'), 'w', encoding='utf-8') as f:
    f.write(json.dumps(r, ensure_ascii=False, indent=2))
print('BE_TEST_DONE')
