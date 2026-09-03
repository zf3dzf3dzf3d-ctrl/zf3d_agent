#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""expand_text - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'expand_text'
SYS_PROMPT = "你是专业内容扩写专家。在保持原文主旨和风格的基础上，丰富细节、补充论据、扩展场景，使内容更加充实饱满。只输出扩写后的完整文本。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n目标长度："+(a.get("target_length","扩充一倍"))+"\n方向："+(a.get("direction","补充细节和论据"))+"\n要求：保持原文主旨，丰富内容。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
