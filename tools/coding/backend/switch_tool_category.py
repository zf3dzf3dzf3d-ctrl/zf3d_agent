#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""switch_tool_category - 切换工具分类"""
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'switch_tool_category'

_CATEGORIES = {
    '极简': {'icon': '📄', 'desc': '基础工具集：文件读写、代码运行、搜索替换、任务管理'},
    '编程': {'icon': '💻', 'desc': '极简 + 全套开发工具：Git、调试、搜索、定时、记忆、邮件、生图生视频等'},
    '写作': {'icon': '✍️', 'desc': '极简 + 40+ AI文本工具：改写、润色、扩写、翻译、总结、分析、SEO等'},
}


def handle(body, ctx):
    category = body.get('category', '')
    if not category:
        cat_list = []
        for k, v in _CATEGORIES.items():
            cat_list.append('  - %s %s: %s' % (v['icon'], k, v['desc']))
        ctx.send_json({
            'ok': True, 'message': '可用分类:\n\n' + '\n\n'.join(cat_list),
            'category': '', 'available': list(_CATEGORIES.keys()),
            'tool': 'switch_tool_category'
        })
        return

    if category in _CATEGORIES:
        info = _CATEGORIES[category]
        ctx.send_json({
            'ok': True,
            'message': '已切换到: %s %s\n%s' % (info['icon'], category, info['desc']),
            'category': category, 'icon': info['icon'], 'desc': info['desc'],
            'tool': 'switch_tool_category'
        })
    else:
        ctx.send_json({
            'ok': False,
            'message': '分类不存在: %s\n可用: %s' % (category, ', '.join(_CATEGORIES.keys())),
            'category': '', 'available': list(_CATEGORIES.keys()),
            'tool': 'switch_tool_category'
        })
