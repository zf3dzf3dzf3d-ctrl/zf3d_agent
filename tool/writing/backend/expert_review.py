#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""expert_review - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'expert_review'
SYS_PROMPT = "你是资深领域专家。以专家的视角对内容进行深度评析，指出专业性问题和改进方向。"
TEMPERATURE = 0.5

def build_prompt(a, t):
    return "领域："+(a.get("field","通用"))+"\n\n原文：\n"+t+"\n\n请以专家视角评析。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
