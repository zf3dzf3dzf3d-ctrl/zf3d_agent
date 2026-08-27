#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""format_beautify - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'format_beautify'
SYS_PROMPT = "你是排版美化专家。对文本进行格式美化：优化标题层级、段落间距、列表格式、引用样式等。直接输出美化后的Markdown文本。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n输出格式："+(a.get("format","Markdown"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
