#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ask_user - 向用户提问"""
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'ask_user'


def handle(body, ctx):
    question = body.get('question', '请补充说明：')
    fields = body.get('fields', None)
    ctx.send_json({
        'ok': False, 'pending': True,
        'question': question, 'fields': fields,
        'answer': '', 'message': '（等待用户回答…）',
        'tool': 'ask_user'
    })
