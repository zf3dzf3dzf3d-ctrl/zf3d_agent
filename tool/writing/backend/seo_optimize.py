#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""seo_optimize - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'seo_optimize'
SYS_PROMPT = "你是SEO内容优化专家。输出：1)关键词分析（3-5个目标关键词、频率、密度建议）；2)标题优化建议（2-3个SEO友好标题）；3)meta描述（80-120字含关键词）；4)结构优化建议。用Markdown结构化输出，不改写原文。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "目标关键词："+(a.get("keywords","（未指定，请自动识别）"))+"\n\n原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
