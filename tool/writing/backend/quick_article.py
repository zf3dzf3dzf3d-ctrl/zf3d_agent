#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""quick_article - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'quick_article'
SYS_PROMPT = "你是快速写作专家。根据主题和要点快速生成一篇文章，结构完整、内容充实。直接输出文章。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "主题："+(a.get("topic",""))+"\n文章类型："+(a.get("article_type","通用"))+"\n字数："+(a.get("word_count","800"))+"\n要点："+(a.get("points",t or "无"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
