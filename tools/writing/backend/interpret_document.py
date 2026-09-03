#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""interpret_document - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'interpret_document'
SYS_PROMPT = "你是文档解读专家。对文档进行深度解读：提炼核心观点、梳理逻辑脉络、提取关键数据、回答针对性问题。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "文档内容：\n"+t+"\n\n解读重点："+(a.get("focus","核心观点和逻辑脉络"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
