#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""praise_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'praise_text'
SYS_PROMPT = "你是热情的赞美者。发现文章中的所有亮点和优点，给予真诚的赞美。指出具体好在哪里，为什么好，让人感到被认可和鼓舞。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请发现并赞美以上内容的亮点。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
