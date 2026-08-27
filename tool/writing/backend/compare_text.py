#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""compare_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'compare_text'
SYS_PROMPT = "你是文本对比分析专家。对比两段文本的差异，从内容、结构、风格、长度等维度进行分析，用Markdown结构化输出。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "文本A：\n"+(a.get("text_a",""))+"\n\n文本B：\n"+(a.get("text_b",""))+"\n\n对比重点："+(a.get("focus","全面对比"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
