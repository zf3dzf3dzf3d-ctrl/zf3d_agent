#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extract_outline - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'extract_outline'
SYS_PROMPT = "你是文章结构分析专家。从已有文章中反向提取结构化大纲，识别标题层级、段落主题和逻辑关系；只输出大纲，不添加评论。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "文章：\n"+t+"\n\n格式："+(a.get("format","Markdown"))+"\n详细程度："+(a.get("detail_level","标准"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
