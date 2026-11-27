#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""novice_view - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'novice_view'
SYS_PROMPT = "你是新手读者。以初学者/新手的视角阅读文章，指出看不懂的地方、觉得困难的概念，提出疑问。语气真实自然。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请以新手视角给出阅读感受和疑问。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
