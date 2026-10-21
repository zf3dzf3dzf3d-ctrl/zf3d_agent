#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rewrite_text - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'rewrite_text'
SYS_PROMPT = "你是专业中文写作编辑。在严格保持原意的前提下改写文本，改变句式结构和用词表达，降低与原文的重复率。只输出改写后的完整文本，不添加解释或说明。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n改写风格："+(a.get("style","自然"))+"\n改写力度："+(a.get("strength","中度"))+"\n要求：保持原意，改变表达方式，降低重复率。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
