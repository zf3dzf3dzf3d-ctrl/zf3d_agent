# -*- coding: utf-8 -*-
"""test_backend_new.py - 新 action 后端端到端测试（模拟智能体调用）"""
import sys, os
_TOOLS = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\tools\minimal\backend'
sys.path.insert(0, _TOOLS)
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video')
import video_edit

D = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video'
OK = True
sent = {}

class Ctx:
    def send_json(self, obj):
        sent.clear(); sent.update(obj)

def call(body):
    video_edit.handle(body, Ctx())
    r = dict(sent)
    print(f"[{'PASS' if r.get('ok') else 'FAIL'}] {r.get('action')}: {'OK' if r.get('ok') else r.get('error')}")
    if not r.get('ok'): globals().__setitem__('OK', False)
    return r

a = os.path.join(D, 'fx_a.mp4'); b = os.path.join(D, 'fx_b.mp4'); bgm = os.path.join(D, 'fx_bgm.mp3')

call({'action': 'transition', 'file': a, 'file2': b, 'kind': 'slideleft', 'out': os.path.join(D, 'be_xfade.mp4')})
call({'action': 'fade', 'file': a, 'out': os.path.join(D, 'be_fade.mp4')})
call({'action': 'beat_sync', 'clips': [a, b], 'bgm': bgm, 'max_out': 8, 'out': os.path.join(D, 'be_beat.mp4')})
call({'action': 'auto_materials', 'texts': '夜晚的城市灯光\n海边日落风景', 'lib': D})
call({'action': 'visual_highlight', 'file': os.path.join(D, 'vis_test.mp4'), 'top': 2, 'window': 2.0, 'out': os.path.join(D, 'be_mm.mp4')})

print('\n=== ALL PASS ===' if OK else '\n=== SOME FAILED ===')
sys.exit(0 if OK else 1)
