#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""proofread_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'proofread_text'
SYS_PROMPT = "你是专业校对编辑。检查文本中的错别字、语法错误、标点问题和逻辑漏洞，逐条列出问题并给出修改建议。如果没有问题，说明文本已无错误。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请逐条列出错误和修改建议。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
