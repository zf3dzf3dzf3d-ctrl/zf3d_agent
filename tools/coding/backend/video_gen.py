#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_gen - AI文生视频（2026-08 修复版：调用 tool/video_gen_engine 真实引擎）"""

import os
import sys
import json

TOOL_NAME = 'video_gen'


def _engine():
    """导入真实视频生成引擎"""
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # tool/
    if here not in sys.path:
        sys.path.insert(0, here)
    import video_gen_engine
    return video_gen_engine


def handle(body, ctx):
    try:
        engine = _engine()
        action = body.get('action', 'generate')
        prompt = body.get('prompt', '')
        duration = body.get('duration') or 5
        fps = body.get('fps') or 30
        size = body.get('size', '832x480')
        model = body.get('model', '')

        if action == 'status':
            ctx.send_json(engine.video_status())
            return

        if not prompt:
            ctx.send_json({'ok': False, 'error': '需要提供 prompt 参数'})
            return

        r = engine.generate_video(prompt, duration=duration, size=size, model=model, fps=fps,
                                  key=body.get('key', '') or '',
                                  negative_prompt=body.get('negative_prompt', '') or '',
                                  seed=body.get('seed'),
                                  image_url=body.get('image_url', '') or '')
        # 统一返回格式（前端期望 videos 数组）
        if r.get('ok') and r.get('url'):
            r['videos'] = [{'url': r['url'],
                            'provider': r.get('provider', ''),
                            'task_id': r.get('task_id', '')}]
        ctx.send_json(r)
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
