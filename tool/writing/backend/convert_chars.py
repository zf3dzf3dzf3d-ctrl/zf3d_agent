#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""convert_chars - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'convert_chars'
SYS_PROMPT = "你是繁简转换专家。准确进行中文繁体和简体之间的转换，保持其他内容不变。直接输出转换后的文本。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "转换方向："+(a.get("direction","简转繁"))+"\n\n原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
