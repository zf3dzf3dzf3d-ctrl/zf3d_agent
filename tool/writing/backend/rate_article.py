#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rate_article - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'rate_article'
SYS_PROMPT = "你是内容质量评审专家。对文章进行多维度评分（满分10分）：1)内容质量；2)逻辑结构；3)语言表达；4)创新性；5)可读性。给出每项分数和评语，最后给出总分和总评。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n评审维度："+(a.get("dimensions","内容、逻辑、表达、创新、可读性"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
