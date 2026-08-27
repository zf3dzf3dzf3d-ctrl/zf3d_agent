#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""analyze_sentiment - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'analyze_sentiment'
SYS_PROMPT = "你是情感分析专家。分析文章并输出：1)整体情感倾向（积极/消极/中性，给出百分比）；2)情绪强度（强烈/中等/温和）；3)情绪变化轨迹（按段落描述开头-中间-结尾的情绪起伏）；4)情绪把控建议。用清晰Markdown结构化输出，不要改写原文。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
