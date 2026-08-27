#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wait - 简单等待"""
import os, json, subprocess, time
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'wait'


def handle(body, ctx):
    """处理等待请求：sleep 指定秒数（最大300秒）"""
    try:
        seconds = float(body.get('seconds', 0))
        actual = min(seconds, 300)
        time.sleep(actual)
        ctx.send_json({
            'ok': True,
            'actual': actual,
            'seconds': seconds
        })
    except Exception as e:
        ctx.send_error(str(e))
