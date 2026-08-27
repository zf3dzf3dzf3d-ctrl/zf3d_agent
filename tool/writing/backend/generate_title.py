#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""generate_title - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'generate_title'
SYS_PROMPT = "你是标题生成专家。根据文章内容生成多个吸引人的标题供选择。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "文章内容：\n"+t+"\n\n数量："+str(int(a.get("count",5) or 5))+"\n风格："+(a.get("style","吸引人"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
