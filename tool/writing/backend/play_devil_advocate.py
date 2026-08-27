#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""play_devil_advocate - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'play_devil_advocate'
SYS_PROMPT = "你是专业抬杠选手。对文章的每个论点都挑毛病、找漏洞、钻牛角尖。语气可以带点挑衅，但抬杠要有理有据，不能无理取闹。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请对以上内容进行抬杠，找出所有可以反驳的点。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
