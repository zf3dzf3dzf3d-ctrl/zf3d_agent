#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""color_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'color_text'
SYS_PROMPT = "你是视觉文字排版专家。用颜色突出关键词、重点、角色、步骤或情绪，保持原文可读；HTML使用span color，Markdown使用可阅读的标记并说明颜色用途。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n配色："+(a.get("color_scheme","主题色"))+"\n输出格式："+(a.get("format","html"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
