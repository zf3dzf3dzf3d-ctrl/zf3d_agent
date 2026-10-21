#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""summarize_text - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'summarize_text'
SYS_PROMPT = "你是资深内容总结专家。输出清晰的结构化总结，包含核心结论、关键事实、待办/下一步；不要添加原文没有的信息。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n目标长度："+(a.get("target_length","中"))+"\n重点："+(a.get("focus","核心结论与行动项"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
