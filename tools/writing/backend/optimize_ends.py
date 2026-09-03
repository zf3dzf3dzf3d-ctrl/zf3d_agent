#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""optimize_ends - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'optimize_ends'
SYS_PROMPT = "你是开头结尾优化专家。优化文章的开头和结尾，使其更吸引人、更有力。"
TEMPERATURE = 0.5

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n优化部分："+(a.get("part","开头和结尾"))+"\n目标效果："+(a.get("goal","开头吸引人，结尾有力"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
