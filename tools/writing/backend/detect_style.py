#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""detect_style - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'detect_style'
SYS_PROMPT = "你是文风分析专家。分析文章的文风特征并输出：1)整体文风判断（正式/口语/学术/文学/新闻等）；2)用词特征（偏书面/偏口语/专业术语密度）；3)句式特征（长句为主/短句为主/句式多样）；4)改进建议。用Markdown结构化输出。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
