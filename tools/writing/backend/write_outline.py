#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""write_outline - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'write_outline'
SYS_PROMPT = "你是大纲撰写专家。根据主题或要求生成结构化大纲，层次清晰、逻辑合理。直接输出大纲。"
TEMPERATURE = 0.5

def build_prompt(a, t):
    return "主题："+(a.get("topic",t))+"\n格式："+(a.get("format","Markdown"))+"\n详细程度："+(a.get("detail_level","标准"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
