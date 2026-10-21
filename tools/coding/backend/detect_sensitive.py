#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""detect_sensitive - 敏感词检测"""
import os
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'detect_sensitive'

_ADS = ["最","最好","最大","最小","最多","最低","最高","最优","最强","最先进","第一","顶级","极品","绝对","万能","百分百","100%","国家级","世界级","全网第一","销量第一","排名第一","唯一","首个","首家","独家","冠军","之王","之最","巅峰","终极","完美","空前","绝后","史无前例"]
_PLATFORM = ["加微信","加V信","加q群","加QQ群","微信号","vx","VX","免费领","零成本","躺赚","日入过万","月入十万","暴利","刷单","刷销量","刷好评","代刷","特效药","包治百病","药到病除","根治"]
_POLITICAL = ["法轮功","六四","天安门事件","藏独","疆独","台独","颠覆国家","反华","辱华"]


def handle(body, ctx):
    text = body.get('text', '')
    if not text and body.get('path'):
        try:
            with open(body['path'], 'r', encoding='utf-8', errors='replace') as f:
                text = f.read(50000)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': '读取文件失败: ' + str(e), 'tool': 'detect_sensitive'})
            return

    if not text:
        ctx.send_json({'ok': False, 'error': '未提供文本内容', 'tool': 'detect_sensitive'})
        return

    cats = (body.get('categories') or '').lower()
    found = []

    def scan(word_list, cat_name):
        for w in word_list:
            idx = 0
            while True:
                idx = text.find(w, idx)
                if idx < 0:
                    break
                found.append({'word': w, 'category': cat_name, 'position': idx})
                idx += len(w)

    if not cats or '广告' in cats:
        scan(_ADS, '广告法极限词')
    if not cats or '平台' in cats:
        scan(_PLATFORM, '平台违规词')
    if not cats or '政治' in cats:
        scan(_POLITICAL, '政治敏感词')

    if not found:
        ctx.send_json({'ok': True, 'found': [], 'message': '🚨 敏感词检测：未发现敏感词。', 'tool': 'detect_sensitive'})
    else:
        lines = ['🚨 敏感词检测：发现 %d 处敏感词\n' % len(found)]
        for i, item in enumerate(found):
            lines.append('%d. [%s] "%s" — 位置 %d' % (i + 1, item['category'], item['word'], item['position']))
        ctx.send_json({'ok': True, 'found': found, 'message': '\n'.join(lines), 'tool': 'detect_sensitive'})
