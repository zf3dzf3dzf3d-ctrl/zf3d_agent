# -*- coding: utf-8 -*-
import sys, json, os
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video')
sys.path.insert(0, r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\tools\minimal\backend')
import video_edit
OUT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video\clip_tool_result.json'
class Ctx:
    def send_json(self, d):
        with open(OUT, 'w', encoding='utf-8') as f:
            f.write(json.dumps(d, ensure_ascii=False, indent=2))
        print('RESULT_WRITTEN')
video_edit.handle({'action':'clip_select','file':r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\video\vis_test.mp4','query':'城市夜景;科技感画面','top':3,'minlen':4}, Ctx())
