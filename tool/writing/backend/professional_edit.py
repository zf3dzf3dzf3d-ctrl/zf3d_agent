#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""professional_edit - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'professional_edit'
SYS_PROMPT = "你是学术编辑专家。对文本进行专业级修饰，提升用词精准度、逻辑严密性和表达规范性，使其达到专业出版水平。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "专业领域："+(a.get("field","通用"))+"\n\n原文：\n"+t+"\n\n请进行专业级修饰。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
