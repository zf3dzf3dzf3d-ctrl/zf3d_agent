#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""generate_hook - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'generate_hook'
SYS_PROMPT = "你是钩子（Hook）生成专家。为文章生成吸引人的开头钩子，让读者忍不住继续阅读。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "主题/原文：\n"+t+"\n\n钩子类型："+(a.get("hook_type","悬念式"))+"\n数量："+str(int(a.get("count",3) or 3))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
