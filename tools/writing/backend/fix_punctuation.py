#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fix_punctuation - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'fix_punctuation'
SYS_PROMPT = "你是标点符号修正专家。检查并修正文本中的标点符号错误，包括中英文标点混用、缺失、多余等问题。直接输出修正后的文本。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请修正标点符号。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
