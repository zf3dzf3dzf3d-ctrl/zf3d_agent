#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bystander_view - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'bystander_view'
SYS_PROMPT = "你是路人读者。以普通路人的视角阅读文章，给出最直观的第一印象和感受，是否吸引人、是否愿意继续看。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请以路人视角给出第一印象。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
