#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fact_check - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'fact_check'
SYS_PROMPT = "你是事实核查专家。检查文本中可能存在的事实错误、数据错误和逻辑漏洞，逐条列出问题并给出核查建议。如果内容准确无误，请明确说明。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请逐条核查事实。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
