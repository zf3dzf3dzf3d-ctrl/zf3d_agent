#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_status - 查看各视频生成渠道可用状态（2026-08 修复版）"""

import os
import sys

TOOL_NAME = 'video_status'


def handle(body, ctx):
    try:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if here not in sys.path:
            sys.path.insert(0, here)
        import video_gen_engine
        ctx.send_json(video_gen_engine.video_status())
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
