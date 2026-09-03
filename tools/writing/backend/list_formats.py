#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""list_formats - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'list_formats'
SYS_PROMPT = "你是列表整理专家。将文本内容整理成清晰的列表格式。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n列表类型："+(a.get("list_type","要点列表"))+"\n排序："+(a.get("sort_by","按原文顺序"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
